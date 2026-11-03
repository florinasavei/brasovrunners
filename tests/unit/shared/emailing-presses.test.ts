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
 * too, as does a scope opened anywhere a person is not pressing a staff button. Later slices add here what each
 * press must say before (its dialog's email line) and which presses offer «Trimite emailul».
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
    else if (press.actor === "helper") expect(body, `${name} hands the press to the helper that names the actor`).toMatch(/,\s*press\)/);
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

  it("opens no scope on a public flow: only the backoffice's presses, the two job routes and the drains do", () => {
    const allowed = (file: string) =>
      file.startsWith("src/app/[locale]/admin/") ||
      file.startsWith("src/app/api/internal/jobs/") ||
      file === "src/modules/notifications/press.ts" ||
      file === "src/modules/notifications/drain.ts";
    const opened = sourceFiles("src").filter((file) => OPENS.test(read(file)) && !allowed(file));
    expect(opened).toEqual([]);
  });
});
