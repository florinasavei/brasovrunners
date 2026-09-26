import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * `DECISIONS.md` §384 — every irreversible or outward-facing staff action asks first.
 *
 * The rule: an action of class (a) — publish, take off the site, archive, cancel an event, tell
 * the participants, resend, cancel / erase / rename a registration, give a place, set a number,
 * approve or withdraw a legal version, add or remove a colleague, delete an album or a picture,
 * drain the outbox, change a plan, a limit, an interval, the club's deadlines, the contact
 * recipients, the club's copies, an email's wording back to the platform's — is
 * posted through a form that asks: an `ActionForm` with `confirm`, or, where one form carries
 * several verbs, a `ConfirmSubmitButton` (which draws the same `ConfirmDialog`). A plain `<form>`
 * counts only when a `ConfirmSubmitButton` is among its children. A form whose question has
 * `when` conditions asks only for the press that matches them — the event save when it tells
 * the participants or cancels, the create only for "Creează și publică" — and counts as asking.
 *
 * Every other Server Action of the backoffice is in `NOT_CONFIRMED`, each with its reason, and
 * the last test insists every exported action is in one list or the other: a new verb has to be
 * classified before it ships, rather than asking nothing by default.
 *
 * Source-level, like `server-element-props.test.ts`: every `.tsx` under `src/` is parsed, every
 * JSX attribute `action={…}` / `formAction={…}` whose expression names one of the actions — by
 * its own name, or by the prop a page hands it down under — is found, and its element judged.
 * Each action has to be found at least once, so a verb that quietly moved to a bare form fails
 * here rather than on the owner's phone. The server never relies on any of it (BR-REQ-060-01).
 */
const ROOT = path.resolve(__dirname, "../../..");

function actionFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return actionFiles(full);
    return entry === "actions.ts" ? [full] : [];
  });
}

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
  // The list's "Publică automat de acum" and the editor's switch, which asks only when turned on.
  setRepeatPublishAction: ["autoPublish.action", "actions.setRepeatPublish"],
  stopRepeatAction: ["actions.stopRepeat"],
  repeatEventAction: [],
  duplicateEventAction: [],
  deleteEventAction: [],
  removeTestRegistrationsAction: [],
  withdrawInterestAction: [],
  // A group run's self-declaration erased (§393), from its fold: handed to the panel as `eraseAction`.
  eraseGroupRunDeclarationAction: ["eraseAction"],
  assignBibNumbersAction: ["assignAction"],
  sendEventThanksAction: [],
  sendParticipantMessageAction: [],
  // The newsletter (§NNN): the send asks per topic, naming how many receive it; removing an
  // address at someone's request asks too, and cannot be undone.
  sendNewsletterAction: [],
  withdrawNewsletterAddressAction: [],
  // Asks only when the press faces outward: the notice ticked, the status set to cancelled.
  saveEventAndTranslationsAction: [],
  // Asks only for the publish submitter (`then=publish`); the plain create is a draft nobody sees.
  createEventAction: [],
  // Registrations.
  confirmRegistrationNowAction: [],
  promoteRegistrationAction: [],
  setBibNumberAction: [],
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
  // Who receives the signed declarations and the confirmations, with personal data in them.
  updateClubNoticesAction: [],
  // Asks for "Revino la textul platformei" (`reset=1`) only; saving the wording is an editorial save.
  updateEmailCopyAction: [],
  updateNeonPlanAction: [],
  updateBotCheckAction: [],
  updateJobCadenceAction: [],
  updateNeonLimitsAction: [],
  // "Termene" (§377): every hold, offer and link given from now on takes the new numbers.
  updateDeadlinesAction: [],
  // "Maxim de înscrieri pe o adresă" (§389): a limit every public submission meets from now on.
  updateAddressCapAction: [],
};

/**
 * The backoffice's Server Actions that ask nothing, each with why. A toast still says each one
 * worked; the server asserts every rule as before (BR-REQ-060-01).
 */
export const NOT_CONFIRMED: Readonly<Record<string, string>> = {
  checkInAction: "emails nobody and is undone from the same row; a dialog per runner would double the desk's taps on race morning",
  createAlbumAction: "an editorial save: a draft album nobody sees until its own publish, which asks",
  saveAlbumAction: "an editorial save, like a page's; publishing and deleting ask",
  setCoverAction: "picks the album's cover, undone by picking another",
  createPageAction: "an editorial save: a draft page nobody sees until its own publish, which asks",
  savePageAction: "an editorial save, like the event's without a notice; publishing and deleting ask",
  movePageAction: "reorders the pages, undone by moving back",
  createLegalVersionAction: "a draft, never in force until approved, which asks",
  updateLegalVersionAction: "a draft, never in force until approved, which asks",
  markBibsPrintedAction: "a mark for the club's own pile of bibs, undone by the same button",
  setBibPrintedAction: "a mark for the club's own pile of bibs, undone by the same button",
  addTestRegistrationsAction: "test rows, counted nowhere and absent from production, removed by a verb that asks",
  hardDeleteEventAction: "guarded by the event's title, typed: the typing is the question",
  eraseRegistrationFromListAction: "guarded by the registered name, typed: the typing is the question",
  deleteApprovedLegalVersionAction: "guarded by a typed phrase: the typing is the question",
  previewParticipantMessageAction: "a preview; sends nothing",
  previewNewsletterAction: "the newsletter composer's preview (§NNN); sends nothing, stores nothing",
  lookUpPersonAction: "reads; changes nothing",
  signInAsDevIdentityAction: "the development sign-in: a session, not data",
  signOutAction: "a session, not data",
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

describe("§384 every irreversible or outward-facing staff action asks first", () => {
  it("is posted somewhere — a verb that moved to a bare form fails here, not on a phone", () => {
    const unseen = [...SITES].filter(([, sites]) => sites.length === 0).map(([name]) => name);
    expect(unseen, "actions never found behind action={…} or formAction={…}").toEqual([]);
  });

  it("asks at every site: an ActionForm with confirm, or a ConfirmSubmitButton where one form carries several verbs", () => {
    const bare = [...SITES].flatMap(([name, sites]) => sites.filter((site) => site.verdict === "bare").map((site) => `${name} at ${site.file}:${site.line} (${site.expression}) — ${site.why}`));
    expect(bare, "posted without a question").toEqual([]);
  });

  it("classifies every Server Action of the backoffice: it asks, or it is listed with why it does not", () => {
    const exported = actionFiles(path.join(ROOT, "src/app/[locale]/admin")).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/export async function (\w+Action)\b/g)].map((match) => match[1]),
    );
    expect(exported.length).toBeGreaterThan(60);
    const unclassified = exported.filter((name) => !(name in CONFIRMED_ACTIONS) && !(name in NOT_CONFIRMED));
    expect(unclassified, "a new action: add it to CONFIRMED_ACTIONS, or to NOT_CONFIRMED with its reason").toEqual([]);
    const both = Object.keys(NOT_CONFIRMED).filter((name) => name in CONFIRMED_ACTIONS);
    expect(both).toEqual([]);
    const stale = Object.keys(NOT_CONFIRMED).filter((name) => !exported.includes(name));
    expect(stale, "listed in NOT_CONFIRMED but no longer exported").toEqual([]);
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
