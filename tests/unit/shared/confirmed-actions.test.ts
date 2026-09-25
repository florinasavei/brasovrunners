import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * `DECISIONS.md` §NNN — every irreversible or outward-facing staff action asks first.
 *
 * The rule: an action of class (a) — publish, take off the site, archive, cancel an event, tell
 * the participants, resend, cancel / erase / rename a registration, give a place, set a number,
 * check in, approve or withdraw a legal version, add or remove a colleague, delete an album or a
 * picture, drain the outbox, change a plan, a limit, an interval, the contact recipients — is
 * posted through a form that asks: an `ActionForm` with `confirm`, or, where one form carries
 * several verbs, a `ConfirmSubmitButton` (which draws the same `ConfirmDialog`). A plain `<form>`
 * counts only when a `ConfirmSubmitButton` is among its children. The two verbs guarded by a
 * typed phrase, name or title (`hardDeleteEventAction`, `eraseRegistrationFromListAction`,
 * `deleteApprovedLegalVersionAction`, the bulk erase's typed count) ask through the typing and
 * are not listed here.
 *
 * Source-level, like `server-element-props.test.ts`: every `.tsx` under `src/` is parsed, every
 * JSX attribute `action={…}` / `formAction={…}` whose expression names one of the actions — by
 * its own name, or by the prop a page hands it down under — is found, and its element judged.
 * Each action has to be found at least once, so a verb that quietly moved to a bare form fails
 * here rather than on the owner's phone. The server never relies on any of it (BR-REQ-060-01).
 */
const ROOT = path.resolve(__dirname, "../../..");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx$/.test(entry) ? [full] : [];
  });
}

/** The (a) actions, each with the names a page may post it under besides its own. */
export const CONFIRMED_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  // Events.
  transitionEventAction: [],
  bulkPublishEventsAction: ["publish", "publish.action"],
  bulkArchiveEventsAction: ["archive"],
  bulkDeleteEventsAction: ["remove"],
  setRepeatPublishAction: ["autoPublish.action"],
  stopRepeatAction: ["actions.stopRepeat"],
  repeatEventAction: [],
  duplicateEventAction: [],
  deleteEventAction: [],
  removeTestRegistrationsAction: [],
  withdrawInterestAction: [],
  assignBibNumbersAction: ["assignAction"],
  sendEventThanksAction: [],
  sendParticipantMessageAction: [],
  // Registrations.
  confirmRegistrationNowAction: [],
  promoteRegistrationAction: [],
  setBibNumberAction: [],
  checkInAction: [],
  createRegistrationAction: [],
  correctRegisteredNameAction: [],
  cancelRegistrationAction: [],
  cancelRegistrationFromRowAction: [],
  withdrawConsentAction: [],
  deleteRegistrationAction: [],
  bulkCancelRegistrationsAction: [],
  bulkDeleteRegistrationsAction: [],
  resendRegistrationEmailAction: [],
  sendOutboxNowAction: [],
  sendOutboxNowFromEmailsAction: [],
  // Legal.
  approvePlatformTemplatesAction: [],
  approveLegalVersionAction: [],
  deleteLegalVersionAction: [],
  withdrawLegalVersionAction: [],
  // Gallery and pages.
  transitionAlbumAction: [],
  deletePhotoAction: [],
  deleteAlbumAction: [],
  deletePictureAction: [],
  transitionPageAction: [],
  deletePageAction: [],
  // The team.
  inviteStaffAction: [],
  changeStaffRoleAction: [],
  resendStaffInviteAction: [],
  sendStaffPasswordResetAction: [],
  setStaffAccountActiveAction: [],
  revokeStaffAction: [],
  // Settings that face outward.
  updateEmailPlanAction: [],
  updateContactRecipientsAction: [],
  updateBotCheckAction: [],
  updateJobCadenceAction: [],
  updateNeonLimitsAction: [],
};

type Site = { file: string; line: number; expression: string; verdict: "asks" | "bare"; why: string };

function tagName(name: ts.JsxTagNameExpression): string {
  return name.getText();
}

function hasAttribute(element: ts.JsxOpeningLikeElement, name: string): boolean {
  return element.attributes.properties.some((property) => ts.isJsxAttribute(property) && property.name.getText() === name);
}

function attributeText(element: ts.JsxOpeningLikeElement, name: string): string | null {
  const found = element.attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.getText() === name);
  if (!found || !ts.isJsxAttribute(found) || !found.initializer) return null;
  return ts.isJsxExpression(found.initializer) && found.initializer.expression ? found.initializer.expression.getText() : found.initializer.getText();
}

/** Whether a `ConfirmSubmitButton` is drawn anywhere inside this element. */
function holdsConfirmButton(node: ts.Node): boolean {
  let found = false;
  const walk = (child: ts.Node) => {
    if (found) return;
    if ((ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) && tagName(child.tagName) === "ConfirmSubmitButton") found = true;
    else ts.forEachChild(child, walk);
  };
  ts.forEachChild(node, walk);
  return found;
}

function judge(element: ts.JsxOpeningLikeElement, attribute: string): { verdict: Site["verdict"]; why: string } {
  const tag = tagName(element.tagName);
  if (attribute === "formAction") {
    return tag === "ConfirmSubmitButton" ? { verdict: "asks", why: "ConfirmSubmitButton" } : { verdict: "bare", why: `formAction on <${tag}>` };
  }
  if (tag === "ActionForm") {
    return hasAttribute(element, "confirm") ? { verdict: "asks", why: "ActionForm confirm" } : { verdict: "bare", why: "ActionForm without confirm" };
  }
  const isForm = tag === "form" || (tag === "Box" && attributeText(element, "component") === '"form"');
  if (isForm) {
    const parent = element.parent;
    return ts.isJsxElement(parent) && holdsConfirmButton(parent)
      ? { verdict: "asks", why: "form with ConfirmSubmitButton" }
      : { verdict: "bare", why: `<${tag}> with no ConfirmSubmitButton` };
  }
  return { verdict: "bare", why: `posted from <${tag}>` };
}

const SITES = new Map<string, Site[]>();
for (const name of Object.keys(CONFIRMED_ACTIONS)) SITES.set(name, []);
const byExpression = new Map<string, string>();
for (const [name, aliases] of Object.entries(CONFIRMED_ACTIONS)) {
  byExpression.set(name, name);
  for (const alias of aliases) byExpression.set(alias, name);
}

/** The backoffice: its routes and the modules that draw them. The public site keeps its own verbs. */
const isBackoffice = (relative: string) => relative.startsWith("src/app/[locale]/admin/") || relative.startsWith("src/modules/");

for (const file of sourceFiles(path.join(ROOT, "src"))) {
  const relative = path.relative(ROOT, file).split(path.sep).join("/");
  if (!isBackoffice(relative)) continue;
  const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const walk = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
      const attribute = node.name.getText();
      if (attribute === "action" || attribute === "formAction") {
        const expression = node.initializer.expression.getText();
        const action = byExpression.get(expression);
        const element = node.parent.parent;
        if (action && (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element))) {
          const { verdict, why } = judge(element, attribute);
          SITES.get(action)?.push({ file: relative, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, expression, verdict, why });
        }
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(source);
}

describe("§NNN every irreversible or outward-facing staff action asks first", () => {
  it("is posted somewhere — a verb that moved to a bare form fails here, not on a phone", () => {
    const unseen = [...SITES].filter(([, sites]) => sites.length === 0).map(([name]) => name);
    expect(unseen, "actions never found behind action={…} or formAction={…}").toEqual([]);
  });

  it("asks at every site: an ActionForm with confirm, or a ConfirmSubmitButton where one form carries several verbs", () => {
    const bare = [...SITES].flatMap(([name, sites]) => sites.filter((site) => site.verdict === "bare").map((site) => `${name} at ${site.file}:${site.line} (${site.expression}) — ${site.why}`));
    expect(bare, "posted without a question").toEqual([]);
  });

  it("never asks twice: a ConfirmSubmitButton sits in no ActionForm that has its own confirm", () => {
    const doubled: string[] = [];
    for (const file of sourceFiles(path.join(ROOT, "src"))) {
      const relative = path.relative(ROOT, file).split(path.sep).join("/");
      const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
      const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const walk = (node: ts.Node, inConfirmedForm: boolean) => {
        let inside = inConfirmedForm;
        if (ts.isJsxElement(node) && tagName(node.openingElement.tagName) === "ActionForm" && hasAttribute(node.openingElement, "confirm")) inside = true;
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && tagName(node.tagName) === "ConfirmSubmitButton" && inside) {
          doubled.push(`${relative}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        }
        ts.forEachChild(node, (child) => walk(child, inside));
      };
      walk(source, false);
    }
    expect(doubled).toEqual([]);
  });
});
