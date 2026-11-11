import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { isJobCause, PRESS_CAUSE_NAMES, type PressCause } from "@/modules/notifications/domain/press-causes";

/**
 * Every staff press that can send an email runs inside its email press scope (the design «telling the owner about
 * every email a staff press sends», slice 1, its sections 1 and 6): `return inEmailPress("<its cause>", async (press)
 * => { … press.by(actor.id) … })` around its whole body, so every row it queues — the person's message, the club's
 * copies, an offer to the next in line — carries its cause, one press id and who pressed. The two job routes open
 * the jobs' scopes; a public flow opens none, so its rows read «de pe site».
 *
 * Source-level, like `confirmed-actions.test.ts`: each listed action is found in its file, parsed, and must call
 * `inEmailPress` with each of its causes and name its actor — `press.by(…)` itself, through the helper it hands
 * `press` to, or through the listed press it delegates to. An action that opens a scope and is not listed fails
 * too, as does a scope opened anywhere a person is not pressing a staff button. Slice 2 adds that every press flashes
 * through the one call that reads what it sent; slice 3 that every element posting a press says its email before it is
 * pressed, through the one builder or a `MailLine` (the third `describe` below); slice 4 which presses offer «Trimite
 * emailul», read by the one parser and handed to their service (the last).
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

const REGISTRATIONS = "src/app/[locale]/admin/registrations/actions.ts";
const REGISTRATION = "src/app/[locale]/admin/registrations/[id]/actions.ts";
const INVITATIONS = "src/app/[locale]/admin/registrations/invitation-actions.ts";
const PERSON = "src/app/[locale]/admin/registrations/person/actions.ts";
const ADMIN = "src/app/[locale]/admin/actions.ts";
const VOLUNTEERS = "src/app/[locale]/admin/events/[id]/volunteer-actions.ts";
const MESSAGES = "src/app/[locale]/admin/events/[id]/mesaje/actions.ts";
const IMPORT = "src/app/[locale]/admin/events/import/actions.ts";
const NEWSLETTER = "src/app/[locale]/admin/newsletter/actions.ts";
const SHOP = "src/app/[locale]/admin/shop/actions.ts";

type Press = {
  file: string;
  causes: readonly PressCause[];
  /** How the press names who pressed: `press.by(…)` itself, a helper it hands `press` to, or the listed press it calls. */
  actor: "named" | "helper" | { delegatesTo: string };
};

/** Every emailing press of the design's section 6, by its Server Action, with its cause. */
export const EMAILING_PRESSES: Readonly<Record<string, Press>> = {
  // Registrations.
  resendRegistrationEmailAction: { file: REGISTRATION, causes: ["registrations.resend", "registrations.reminder"], actor: "named" },
  resendFamilyEmailAction: { file: REGISTRATION, causes: ["registrations.familyResend"], actor: "named" },
  givePlaceNowAction: { file: REGISTRATIONS, causes: ["registrations.givePlaceNow"], actor: "named" },
  offerPlaceAction: { file: REGISTRATIONS, causes: ["registrations.offer"], actor: "named" },
  confirmRegistrationNowAction: { file: REGISTRATIONS, causes: ["registrations.confirmPaper"], actor: "named" },
  promoteRegistrationAction: { file: REGISTRATIONS, causes: ["registrations.givePlace"], actor: "named" },
  setBibNumberAction: { file: REGISTRATIONS, causes: ["registrations.setBib"], actor: "named" },
  setOutsideCapacityAction: { file: REGISTRATIONS, causes: ["registrations.specialGuests"], actor: "named" },
  changeRegistrationAddressAction: { file: REGISTRATIONS, causes: ["registrations.changeAddress"], actor: "named" },
  cancelRegistrationAction: { file: REGISTRATIONS, causes: ["registrations.cancel"], actor: "named" },
  cancelRegistrationFromRowAction: { file: REGISTRATIONS, causes: ["registrations.cancel"], actor: { delegatesTo: "cancelRegistrationAction" } },
  bulkCancelRegistrationsAction: { file: REGISTRATIONS, causes: ["registrations.bulkCancel"], actor: "named" },
  deleteRegistrationAction: { file: REGISTRATIONS, causes: ["registrations.erase"], actor: "named" },
  eraseRegistrationFromListAction: { file: REGISTRATIONS, causes: ["registrations.erase"], actor: "named" },
  bulkDeleteRegistrationsAction: { file: REGISTRATIONS, causes: ["registrations.bulkErase"], actor: "named" },
  createRegistrationAction: { file: REGISTRATIONS, causes: ["registrations.create"], actor: "named" },
  addToWaitlistAction: { file: REGISTRATIONS, causes: ["registrations.waitlistAdd", "registrations.offerNow"], actor: "named" },
  moveReserveEntryAction: { file: REGISTRATIONS, causes: ["registrations.reserveMove"], actor: "named" },
  inviteAction: { file: INVITATIONS, causes: ["registrations.invite"], actor: "named" },
  resendInvitationAction: { file: INVITATIONS, causes: ["registrations.invitationResend"], actor: "named" },
  withdrawInvitationAction: { file: INVITATIONS, causes: ["registrations.invitationWithdraw"], actor: "named" },
  eraseEventInvitationsAction: { file: PERSON, causes: ["registrations.invitationsErase"], actor: "helper" },
  // Events.
  saveEventAndTranslationsAction: { file: ADMIN, causes: ["events.save"], actor: "named" },
  sendEventThanksAction: { file: ADMIN, causes: ["events.thanks"], actor: "named" },
  resendDeclarationToAllAction: { file: ADMIN, causes: ["events.declarationResendAll"], actor: "named" },
  addTestRegistrationsAction: { file: ADMIN, causes: ["events.testRegistrations"], actor: "named" },
  sendParticipantMessageAction: { file: MESSAGES, causes: ["events.participantMessage"], actor: "named" },
  importEventOverAction: { file: IMPORT, causes: ["events.importOver"], actor: "named" },
  // Volunteers.
  addVolunteerAction: { file: VOLUNTEERS, causes: ["volunteers.add"], actor: "helper" },
  editVolunteerAction: { file: VOLUNTEERS, causes: ["volunteers.edit"], actor: "helper" },
  setVolunteerStateAction: { file: VOLUNTEERS, causes: ["volunteers.state"], actor: "helper" },
  assignVolunteerAction: { file: VOLUNTEERS, causes: ["volunteers.assign"], actor: "helper" },
  unassignVolunteerAction: { file: VOLUNTEERS, causes: ["volunteers.unassign"], actor: "helper" },
  requestVolunteerAgreementAction: { file: VOLUNTEERS, causes: ["volunteers.agreementLink"], actor: "named" },
  recordPaperVolunteerAgreementAction: { file: VOLUNTEERS, causes: ["volunteers.agreementPaper"], actor: "named" },
  requestVolunteerGuardianAction: { file: VOLUNTEERS, causes: ["volunteers.guardianLink"], actor: "named" },
  recordPaperVolunteerGuardianAction: { file: VOLUNTEERS, causes: ["volunteers.guardianPaper"], actor: "named" },
  sendVolunteerInvitationsAction: { file: VOLUNTEERS, causes: ["volunteers.invite"], actor: "named" },
  resendVolunteerInvitationAction: { file: VOLUNTEERS, causes: ["volunteers.invitationResend"], actor: "named" },
  // The club.
  sendNewsletterAction: { file: NEWSLETTER, causes: ["club.newsletter"], actor: "named" },
  inviteStaffAction: { file: ADMIN, causes: ["club.staffInvite"], actor: "named" },
  inviteMembersAction: { file: ADMIN, causes: ["club.membersInvite"], actor: "named" },
  resendStaffInviteAction: { file: ADMIN, causes: ["club.staffReinvite"], actor: "named" },
  moveShopOrderAction: { file: SHOP, causes: ["club.shopPaid"], actor: "named" },
  placeOrderForMemberAction: { file: SHOP, causes: ["club.shopOrderForMember"], actor: "named" },
};

/**
 * Presses that touch email but queue nothing themselves, so they open no scope (the design's section 6): «Trimite
 * acum» sends what is already queued; publishing wakes the job, which queues under its own scope; Zitadel sends the
 * password link itself; the settings change when or by which road mail leaves.
 */
const NO_SCOPE: Readonly<Record<string, string>> = {
  sendOutboxNowAction: REGISTRATIONS,
  transitionEventAction: ADMIN,
  createEventAction: ADMIN,
  bulkPublishEventsAction: ADMIN,
  sendStaffPasswordResetAction: ADMIN,
  sendOutboxNowFromEmailsAction: "src/app/[locale]/admin/settings/emails/actions.ts",
  retryFailedEmailsFromEmailsAction: "src/app/[locale]/admin/settings/emails/actions.ts",
  updateDeliveryTimingFromEmailsAction: "src/app/[locale]/admin/settings/emails/actions.ts",
  updateEmailTransportAction: "src/app/[locale]/admin/settings/emails/actions.ts",
};

/** The exported functions of a file, by name, with their source text. */
function exportedFunctions(file: string): Map<string, string> {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const functions = new Map<string, string>();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      functions.set(statement.name.text, statement.getText(source));
    }
  }
  return functions;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(path.join(ROOT, directory)).flatMap((entry) => {
    const relative = `${directory}/${entry}`;
    if (statSync(path.join(ROOT, relative)).isDirectory()) return sourceFiles(relative);
    return /\.tsx?$/.test(entry) ? [relative] : [];
  });
}

const OPENS = /\binEmailPress\(/;

describe("every emailing press runs inside its email press scope", () => {
  it.each(Object.entries(EMAILING_PRESSES))("%s opens its scope with its cause and names who pressed", (name, press) => {
    const body = exportedFunctions(press.file).get(name);
    expect(body, `${name} in ${press.file}`).toBeDefined();
    expect(body).toMatch(OPENS);
    for (const cause of press.causes) expect(body, `${name}: "${cause}"`).toContain(`"${cause}"`);
    if (press.actor === "named") expect(body, `${name} names its actor`).toMatch(/\bpress\.by\(\s*\w+(\.actor)?\.id\s*\)/);
    // The helper may take «Trimite emailul» after the press (slice 4): `runVolunteer(request, press, sendEmail)`.
    else if (press.actor === "helper") expect(body, `${name} hands the press to the helper that names the actor`).toMatch(/,\s*press(?:,\s*sendEmail)?\)/);
    else expect(body, `${name} delegates`).toContain(`${press.actor.delegatesTo}(`);
  });

  it("opens no scope in an action that is not listed — a new emailing press is classified before it ships", () => {
    const listed = new Set(Object.keys(EMAILING_PRESSES));
    const stray: string[] = [];
    for (const file of sourceFiles("src/app").filter((candidate) => candidate.endsWith(".ts") && !candidate.includes("/api/"))) {
      for (const [name, body] of exportedFunctions(file)) if (OPENS.test(body) && !listed.has(name)) stray.push(`${file}#${name}`);
    }
    expect(stray).toEqual([]);
  });

  it("gives every staff press cause a press, and leaves the presses that queue nothing themselves without one", () => {
    const used = new Set(Object.values(EMAILING_PRESSES).flatMap((press) => press.causes));
    expect(PRESS_CAUSE_NAMES.filter((cause) => !isJobCause(cause) && !used.has(cause))).toEqual([]);
    for (const [name, file] of Object.entries(NO_SCOPE)) {
      const body = exportedFunctions(file).get(name);
      expect(body, `${name} in ${file}`).toBeDefined();
      expect(body, name).not.toMatch(OPENS);
    }
  });

  it("opens the jobs' scopes in their two routes and in the drains that do the outbox job's work early", () => {
    expect(read("src/app/api/internal/jobs/registration-maintenance/route.ts")).toContain('inEmailPress("job.registrationMaintenance"');
    expect(read("src/app/api/internal/jobs/email-outbox/route.ts")).toContain('inEmailPress("job.emailOutbox"');
    const drain = read("src/modules/notifications/drain.ts");
    expect(drain).toContain('inEmailPress("job.emailOutbox"');
    expect([...drain.matchAll(/after\(\(\) => asTheOutboxJob\(/g)]).toHaveLength(3);
  });

  it("tells every emailing press's toast what it sent: through `flashOutcome` or `withPressMail`, never the bare `flash` (slice 2)", () => {
    // The receipt is read where the toast is flashed (`shared/feedback/flash.ts#withPressMail`): a press that flashed
    // its notice itself would toast what it did and never what it emailed. The volunteers' card returns through its helper.
    const FLASHED_BY: Readonly<Record<string, string>> = { [VOLUNTEERS]: "src/app/[locale]/admin/events/[id]/volunteer-return.ts" };
    for (const file of new Set(Object.values(EMAILING_PRESSES).map((press) => press.file))) {
      expect(read(FLASHED_BY[file] ?? file), file).toMatch(/\b(flashOutcome|withPressMail)\(/);
    }
    for (const [name, press] of Object.entries(EMAILING_PRESSES)) {
      expect(exportedFunctions(press.file).get(name), name).not.toMatch(/\bawait flash\(/);
    }
  });

  it("opens no scope on a public flow: only the backoffice's presses, the two job routes and the drains do", () => {
    const allowed = (file: string) =>
      file.startsWith("src/app/[locale]/admin/") ||
      file.startsWith("src/app/api/internal/jobs/") ||
      file === "src/modules/notifications/press.ts" ||
      file === "src/modules/notifications/drain.ts" ||
      // The deadline's release (§914): its own automatic cause wherever it runs — a public form can reach the deadline
      // first — and never another cause in that file.
      (file === "src/modules/registrations/repository.ts" &&
        [...read(file).matchAll(/\binEmailPress\(([^,]*),/g)].every((call) => call[1] === '"job.deadlineRelease"'));
    const opened = sourceFiles("src").filter((file) => OPENS.test(read(file)) && !allowed(file));
    expect(opened).toEqual([]);
    expect(read("src/modules/registrations/repository.ts")).toContain('inEmailPress("job.deadlineRelease", releaseLapsed)');
  });
});

/*
  Slice 3, «Before» (the design's sections 2 and 6): every emailing press says its email before it is pressed — the person
  named, or the count and whom, and the email by its name — through the one builder (`confirmWords().mail`, `mailCount`,
  `noMail`, `noMailMany`) in the question the press asks, or, for the presses that come quickly one after another or sit
  inside a data-entry form, a `MailLine` in the same form, beside its button.

  Source-level, like `confirmed-actions.test.ts`: every `.tsx` under `src/` is parsed, and every JSX attribute
  `action={…}` / `formAction={…}` whose expression names a press — by the name it was imported under from the press's own
  file, or by the prop a page hands it down under, followed into the component that receives it — is a posting. Each
  posting must:

  - carry the builder's words in one of its own props (`confirm`, `mail`, an island's `words`): the expression, or a
    value the expression names in the same file, calls `….mail(`, `….mailCount(`, `….noMail(` or `….noMailMany(`;
  - or hold, among its children, a `ConfirmSubmitButton` with no `formAction` of its own (the form's own verb) whose
    props do;
  - or hold a `<MailLine` among its children;
  - or — for the role buttons alone (`BESIDE`), a row of quick presses that share one line — sit in a JSX block of its own
    (up to the helper that draws it) that holds the `<MailLine`.

  A press posted from code rather than a form (`CALLED_IN_CODE`) is held to its island's own line. Every press must be found
  posted at least once, so a verb that moved to a bare form, or to a name this scan cannot follow, fails here first.
*/

/** A call of the one builder's email words. */
const BUILDER = /\.(?:mail|mailCount|noMail|noMailMany)\(/;

/**
 * The presses whose before-notice is a `MailLine` beside a row of buttons rather than inside each form (the design's section 2).
 * Since slice 4 a volunteer's roles block is one form holding its line and its «Trimite emailul»: «Dă-i rolul …» posts the
 * form's own action, so its line is inside its form; «Ia-i rolul …» posts its own button's `formAction` in the same form, the
 * one press still found beside the line.
 */
const BESIDE: ReadonlySet<string> = new Set(["unassignVolunteerAction"]);

/** The presses an island calls in code: the file, and what it must draw before the call. */
const CALLED_IN_CODE: Readonly<Record<string, { file: string; before: RegExp }>> = {
  // The import's differences screen says what applying may email, from the diff, before «Aplică peste eveniment».
  importEventOverAction: { file: "src/modules/content/events/transfer/ui/EventImportPanel.tsx", before: /<MailLine\b/ },
};

type Posting = { press: string; file: string; line: number; verdict: string | null };

function tsxFiles(directory: string): string[] {
  return sourceFiles(directory).filter((file) => file.endsWith(".tsx"));
}

/** The repository file an import names, or null for a package. */
function moduleFile(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/") ? `src/${specifier.slice(2)}` : specifier.startsWith(".") ? path.posix.join(path.posix.dirname(from), specifier) : null;
  if (base === null) return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    try {
      if (statSync(path.join(ROOT, candidate)).isFile()) return candidate;
    } catch {
      // Not this one.
    }
  }
  return null;
}

/** The local names a file imports, each with the file it comes from and the name it is exported under. */
function importsOf(source: ts.SourceFile, file: string): Map<string, { from: string; name: string }> {
  const names = new Map<string, { from: string; name: string }>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.importClause) continue;
    const from = moduleFile(file, statement.moduleSpecifier.text);
    if (!from) continue;
    const clause = statement.importClause;
    if (clause.name) names.set(clause.name.text, { from, name: "default" });
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) names.set(element.name.text, { from, name: (element.propertyName ?? element.name).text });
    }
  }
  return names;
}

/** The identifiers an expression mentions, by name. */
function identifiersIn(node: ts.Node): string[] {
  const found: string[] = [];
  const walk = (child: ts.Node) => {
    if (ts.isIdentifier(child)) found.push(child.text);
    ts.forEachChild(child, walk);
  };
  walk(node);
  return found;
}

/** The text of an expression, with the same-file values it names written out (a few levels deep): what the prop really carries. */
function expanded(node: ts.Node, source: ts.SourceFile, depth = 4, seen = new Set<string>()): string {
  let text = node.getText(source);
  if (depth === 0) return text;
  for (const name of new Set(identifiersIn(node))) {
    if (seen.has(name)) continue;
    seen.add(name);
    const declaration = declarationOf(source, name);
    if (declaration) text += `\n${expanded(declaration, source, depth - 1, seen)}`;
  }
  return text;
}

/** A `const`/`let` value or a function of this name declared anywhere in the file. */
function declarationOf(source: ts.SourceFile, name: string): ts.Node | null {
  let found: ts.Node | null = null;
  const walk = (node: ts.Node) => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) found = node.initializer;
    else if (ts.isFunctionDeclaration(node) && node.name?.text === name && node.body) found = node.body;
    else ts.forEachChild(node, walk);
  };
  walk(source);
  return found;
}

function attributesOf(element: ts.JsxOpeningLikeElement): ts.JsxAttribute[] {
  return element.attributes.properties.filter((property): property is ts.JsxAttribute => ts.isJsxAttribute(property));
}

function tagOf(element: ts.JsxOpeningLikeElement): string {
  return element.tagName.getText();
}

/** The JSX elements under a node, opening and self-closing. */
function jsxUnder(node: ts.Node): ts.JsxOpeningLikeElement[] {
  const found: ts.JsxOpeningLikeElement[] = [];
  const walk = (child: ts.Node) => {
    if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) found.push(child);
    ts.forEachChild(child, walk);
  };
  ts.forEachChild(node, walk);
  return found;
}

/** Whether a prop of the element, other than the action itself, carries the builder's words. */
function carriesBuilder(element: ts.JsxOpeningLikeElement, source: ts.SourceFile): boolean {
  return attributesOf(element).some((attribute) => {
    const name = attribute.name.getText();
    if (name === "action" || name === "formAction" || !attribute.initializer) return false;
    return BUILDER.test(expanded(attribute.initializer, source));
  });
}

/**
 * The block a posting sits in: up through the JSX around it, the conditions and the `.map` callbacks that draw it, to the
 * first function that is not such a callback — the helper or the component that draws the block.
 */
function blockOf(element: ts.Node): ts.Node {
  let block: ts.Node = element;
  let node: ts.Node | undefined = element.parent;
  while (node && !ts.isSourceFile(node)) {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) block = node;
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) {
      let up: ts.Node = node.parent;
      while (ts.isParenthesizedExpression(up)) up = up.parent;
      if (!ts.isCallExpression(up)) break;
    }
    node = node.parent;
  }
  return block;
}

/** The before-notice of one posting, or null when it says nothing. */
function noticeOf(element: ts.JsxOpeningLikeElement, source: ts.SourceFile, press: string): string | null {
  if (carriesBuilder(element, source)) return "the builder, in its props";
  const holder = ts.isJsxOpeningElement(element) ? element.parent : null;
  if (holder) {
    const inside = jsxUnder(holder);
    if (inside.some((child) => tagOf(child) === "ConfirmSubmitButton" && !attributesOf(child).some((one) => one.name.getText() === "formAction") && carriesBuilder(child, source))) {
      return "a ConfirmSubmitButton with the builder";
    }
    if (inside.some((child) => tagOf(child) === "MailLine")) return "a MailLine inside";
  }
  if (BESIDE.has(press) && jsxUnder(blockOf(element)).some((child) => tagOf(child) === "MailLine")) return "a MailLine beside";
  return null;
}

/** Every posting of every emailing press: imported under its own file's name, or handed down as a prop and followed. */
function postings(): Posting[] {
  const found: Posting[] = [];
  const pressOf = new Map(Object.entries(EMAILING_PRESSES).map(([name, press]) => [`${press.file}#${name}`, name]));
  // Props a component receives a press under, by the component's file: `src/…/QueuePanel.tsx` → { offerAction: "offerPlaceAction" }.
  const handed = new Map<string, Map<string, string>>();
  const scan = (file: string, bound: ReadonlyMap<string, string>) => {
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const imports = importsOf(source, file);
    const walk = (node: ts.Node) => {
      if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        const presses = new Set(identifiersIn(node.initializer.expression).flatMap((name) => (bound.has(name) ? [bound.get(name) as string] : [])));
        const element = node.parent.parent;
        if (presses.size > 0 && (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element))) {
          const attribute = node.name.getText();
          for (const press of presses) {
            if (attribute === "action" || attribute === "formAction") {
              found.push({ press, file, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, verdict: noticeOf(element, source, press) });
            } else {
              const component = imports.get(tagOf(element));
              if (component && component.from.endsWith(".tsx")) {
                const props = handed.get(component.from) ?? new Map<string, string>();
                if (props.get(attribute) !== press) {
                  props.set(attribute, press);
                  handed.set(component.from, props);
                  scan(component.from, new Map([[attribute, press]]));
                }
              }
            }
          }
        }
      }
      ts.forEachChild(node, walk);
    };
    walk(source);
  };
  for (const file of tsxFiles("src")) {
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const bound = new Map<string, string>();
    for (const [local, imported] of importsOf(source, file)) {
      const press = pressOf.get(`${imported.from}#${imported.name}`);
      if (press) bound.set(local, press);
    }
    if (bound.size > 0) scan(file, bound);
  }
  return found;
}

describe("every emailing press says its email before it is pressed (slice 3)", () => {
  const all = postings();

  it("is posted somewhere this scan can follow — or called by an island held to its own line", () => {
    const posted = new Set(all.map((posting) => posting.press));
    const unseen = Object.keys(EMAILING_PRESSES).filter((name) => !posted.has(name) && !(name in CALLED_IN_CODE));
    expect(unseen, "emailing presses never found behind action={…} or formAction={…}").toEqual([]);
  });

  it("names its email at every posting: the builder in its question, a ConfirmSubmitButton with it, or a MailLine in the form", () => {
    const silent = all.filter((posting) => posting.verdict === null).map((posting) => `${posting.press} at ${posting.file}:${posting.line}`);
    expect(silent, "an emailing press posted without its before-notice").toEqual([]);
  });

  it("keeps the MailLine beside the buttons for the role presses alone, and the island's line before its call", () => {
    const beside = all.filter((posting) => posting.verdict === "a MailLine beside").map((posting) => posting.press);
    expect(new Set(beside)).toEqual(new Set(BESIDE));
    for (const [name, island] of Object.entries(CALLED_IN_CODE)) {
      const text = read(island.file);
      expect(text, `${island.file} calls ${name}`).toMatch(new RegExp(`\\b${name}\\(`));
      expect(text, `${island.file} draws its before-notice`).toMatch(island.before);
    }
  });

  it("pairs no road by hand: the builder derives it from the email it names", () => {
    // The old sentence and its road were two calls a page could pair wrongly (the map's «Dă-i un loc acum» said the
    // confirmations' road for the links' email); `road: words.road(…)` beside an email line is that pairing again.
    const byHand = tsxFiles("src").filter((file) => /\broad:\s*(?:words|dialog)\.road\(/.test(read(file)));
    expect(byHand).toEqual([]);
  });
});

/**
 * Slice 4 — «Trimite emailul» (the design's section 4, as its Critic corrections and the owner's call amend it): the presses
 * that offer the box, each reading it through the one parser (`shared/forms/send-email.ts#sendEmailOf`) and handing it to
 * its service, which keeps back only the person's own email — never the offer to the next in line, the club's archive or
 * notices. No other action reads the box: not a resend, an offer, a declaration to sign, the copy of a document the person
 * signed (the desk's paper confirmation, the volunteer's paper contract), an invitation to an event or the newsletter.
 */
const OPT_OUT_PRESSES: Readonly<Record<string, { file: string; passes: RegExp }>> = {
  setBibNumberAction: { file: REGISTRATIONS, passes: /setBibNumberByStaff\([^;]*\{ sendEmail \}\)/ },
  cancelRegistrationAction: { file: REGISTRATIONS, passes: /cancelRegistrationByStaff\([^;]*\bsendEmail,/ },
  bulkCancelRegistrationsAction: { file: REGISTRATIONS, passes: /bulkCancelRegistrationsByStaff\([^;]*\{ sendEmail \}\)/ },
  // The editor's window: its own field, apart from the save's other emails.
  saveEventAndTranslationsAction: { file: ADMIN, passes: /windowSendEmail: sendEmailOf\(form, WINDOW_SEND_EMAIL_FIELD\)/ },
  // «Anunță abonații newsletterului»: the publications, which mark the event seen for the job's alert.
  transitionEventAction: { file: ADMIN, passes: /publishEvent\(getDb\(\), \{ \.\.\.move, announce \}\)/ },
  createEventAction: { file: ADMIN, passes: /publish: text\(form, THEN_FIELD\) === THEN_PUBLISH,\s*announce,/ },
  bulkPublishEventsAction: { file: ADMIN, passes: /if \(!announce\) await skipNewEventAlert\(/ },
  addVolunteerAction: { file: VOLUNTEERS, passes: /runVolunteer\([^;]*, press, sendEmail\)/ },
  editVolunteerAction: { file: VOLUNTEERS, passes: /runVolunteer\([^;]*, press, sendEmail\)/ },
  setVolunteerStateAction: { file: VOLUNTEERS, passes: /runVolunteer\([^;]*, press, sendEmail\)/ },
  assignVolunteerAction: { file: VOLUNTEERS, passes: /runVolunteer\([^;]*, press, sendEmail\)/ },
  unassignVolunteerAction: { file: VOLUNTEERS, passes: /runVolunteer\([^;]*, press, sendEmail\)/ },
  recordPaperVolunteerGuardianAction: { file: VOLUNTEERS, passes: /recordPaperVolunteerGuardian\([^;]*\{ sendEmail \},?\s*\)/ },
  inviteStaffAction: { file: ADMIN, passes: /\{ tierId: [^}]*, sendEmail \}/ },
  inviteMembersAction: { file: ADMIN, passes: /inviteMembers\([^;]*\bsendEmail,/ },
  moveShopOrderAction: { file: SHOP, passes: /moveOrderByClub\(getDb\(\), \{ actor, orderId, verb, sendEmail \}\)/ },
};

/** The parser, called: `sendEmailOf(form)` or `sendEmailOf(form, WINDOW_SEND_EMAIL_FIELD)`. */
const READS_BOX = /\bsendEmailOf\(/;

describe("«Trimite emailul» reaches only the presses that offer it, and their service (slice 4)", () => {
  it.each(Object.entries(OPT_OUT_PRESSES))("%s reads the box through the one parser and hands it to its service", (name, press) => {
    const body = exportedFunctions(press.file).get(name);
    expect(body, `${name} in ${press.file}`).toBeDefined();
    expect(body).toMatch(READS_BOX);
    expect(body).toMatch(press.passes);
  });

  it("is read by no other action — never a resend, an offer, a declaration to sign or a signed document's copy", () => {
    const listed = new Set(Object.keys(OPT_OUT_PRESSES));
    const stray: string[] = [];
    for (const file of sourceFiles("src/app").filter((candidate) => candidate.endsWith(".ts"))) {
      for (const [name, body] of exportedFunctions(file)) if (READS_BOX.test(body) && !listed.has(name)) stray.push(`${file}#${name}`);
    }
    expect(stray).toEqual([]);
    for (const never of ["confirmRegistrationNowAction", "promoteRegistrationAction", "recordPaperVolunteerAgreementAction", "offerPlaceAction", "givePlaceNowAction"]) {
      expect(listed.has(never), never).toBe(false);
    }
  });
});
