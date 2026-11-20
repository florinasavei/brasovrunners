import { and, desc, eq, isNull, lte, type SQL, sql } from "drizzle-orm";
import { legalDocuments } from "@/db/schema/legal-documents";
import { staffTeamAgreementAcceptances, staffTeamAgreementSignInAcceptances } from "@/db/schema/staff-team-agreement-acceptances";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { recordAuditEvent } from "@/modules/audit/repository";
import { isLegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { TEAM_AGREEMENT_KEY } from "@/modules/legal-documents/domain/keys";
import { traceColumns, type SignatureTrace } from "@/modules/legal-documents/domain/signature-trace";
import { signedTextHash } from "@/modules/legal-documents/domain/signed-text";
import { type CurrentLegalDocument, findCurrentApprovedDocument } from "@/modules/legal-documents/repository";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { mustAcceptTeamAgreement } from "./domain/roles";
import { teamAgreementName, teamAgreementOwedThisSession } from "./domain/team-agreement";

/**
 * The team's undertaking at sign-in (§1006; the owner, 2026-11-19: «Voluntarii trebuie să semneze acordul GDPR când intră în
 * platformă»): what the gate reads (`session.ts`), what `/admin/acord` writes, and what «Echipa» and «Sarcini» show.
 *
 * **In force** is what every legal text's «in force» is (`findCurrentApprovedVersionId`): the highest version of
 * `STAFF_DATA_AGREEMENT` that is approved, not withdrawn and whose `effective_at` has passed. While there is none, nobody is
 * asked — a text the club has not approved binds nobody — and «Sarcini» carries the club's row.
 *
 * **Owed at every sign-in since §1026** (amending §1006, which asked it once per account and version): a session owes the version in
 * force unless the account accepted it at or after the moment the session was signed in, or an acceptance names that very sign-in
 * (`teamAgreementOwedThisSession`). Every acceptance is kept, with the sign-in it answers (`staff_team_agreement_sign_in_acceptances`);
 * the acceptances made once per account under §1006 (`staff_team_agreement_acceptances`) stay where they are, for «Echipa» and as
 * reliances on their version, and answer no sign-in. A new version in force is asked at the next request, as before.
 */

/** The version of the undertaking in force — its id and its number — or null. */
export type TeamAgreementVersion = { id: string; version: number };

/** The undertaking's version in force, for nobody in particular: «Sarcini»'s row, «Echipa»'s states. */
export async function findTeamAgreementInForce<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<TeamAgreementVersion | null> {
  const [row] = await db
    .select({ id: legalDocuments.id, version: legalDocuments.version })
    .from(legalDocuments)
    .where(inForce(now))
    .orderBy(desc(legalDocuments.version))
    .limit(1);
  return row ?? null;
}

/** Whether a version of the undertaking is in force (§1006): «Sarcini»'s row is done once one is. */
export async function teamAgreementInForce<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<boolean> {
  return (await findTeamAgreementInForce(db, now)) !== null;
}

function inForce(now: Date) {
  return and(
    eq(legalDocuments.key, TEAM_AGREEMENT_KEY),
    eq(legalDocuments.isApproved, true),
    isNull(legalDocuments.withdrawnAt),
    lte(legalDocuments.effectiveAt, now),
  );
}

/**
 * The version in force this session owes, or null — the gate's one question, one query (§1026: owed at every sign-in). `signedInAt`
 * is the moment the session was signed in, null for a session signed in before §1026; the rule is `teamAgreementOwedThisSession`'s.
 * A role that is not asked (`mustAcceptTeamAgreement`) is answered with no query: an Administrator's request reads nothing more.
 * The session asks it once per request however many doors ask (`session.ts`, React's `cache`).
 */
export async function outstandingTeamAgreement<T extends Record<string, unknown>>(
  db: Database<T>,
  account: { id: string; role: StaffUser["role"] },
  signedInAt: Date | null,
  now: Date,
): Promise<TeamAgreementVersion | null> {
  if (!mustAcceptTeamAgreement(account.role)) return null;
  const accepted = staffTeamAgreementSignInAcceptances;
  /*
    A join, never a correlated `exists` in the selection: with one table in its FROM, Drizzle writes a selection's columns bare,
    and a bare `"id"` inside the subquery would be the acceptance's own. The version in force comes first and, beside it, the
    account's acceptances of it in the per-sign-in record, folded into two facts — the newest moment (null when there is none),
    and whether one of them names this very sign-in, which answers it whatever the two servers' clocks wrote (§1026).
  */
  const [row] = await db
    .select({
      id: legalDocuments.id,
      version: legalDocuments.version,
      // A Date through the column's own reader; null — never read — when the account has no acceptance of it.
      lastAcceptedAt: sql`max(${accepted.acceptedAt})`.mapWith(accepted.acceptedAt) as SQL<Date | null>,
      acceptedThisSignIn:
        signedInAt === null ? sql<boolean>`false` : sql<boolean>`coalesce(bool_or(${eq(accepted.signedInAt, signedInAt)}), false)`,
    })
    .from(legalDocuments)
    .leftJoin(accepted, and(eq(accepted.legalDocumentId, legalDocuments.id), eq(accepted.staffUserId, account.id)))
    .where(inForce(now))
    .groupBy(legalDocuments.id, legalDocuments.version)
    .orderBy(desc(legalDocuments.version))
    .limit(1);
  if (!row) return null;
  const owed = teamAgreementOwedThisSession({
    subject: account.role,
    inForce: true,
    signedInAt,
    lastAcceptedAt: row.lastAcceptedAt,
    acceptedThisSignIn: row.acceptedThisSignIn,
  });
  return owed ? { id: row.id, version: row.version } : null;
}

/** The text a colleague reads on `/admin/acord`: the version in force in the page's language, or undefined. */
export async function findTeamAgreementText<T extends Record<string, unknown>>(
  db: Database<T>,
  locale: Locale,
  now: Date,
): Promise<CurrentLegalDocument | undefined> {
  return findCurrentApprovedDocument(db, TEAM_AGREEMENT_KEY, locale, now);
}

export type TeamAgreementAcceptanceInput = {
  /** The version the page showed (`documentId`): a version that stopped being the one in force since is refused. */
  documentId: string;
  /** The full name as typed; trimmed and its spaces collapsed before it is kept. */
  fullName: string;
  /** «Am citit și accept angajamentul», the page's own tick. */
  accepted: boolean;
  /** The page's language: the text read, and the language of the hash. */
  locale: Locale;
  /** The sign-in this acceptance answers (§1026): the moment the press's session was signed in, null for one from before §1026. */
  signedInAt: Date | null;
  /** The press's IP address and browser (§771). */
  trace?: SignatureTrace;
};

/** What a press on «Accept și intru» did: a new acceptance, one already there, or nothing to accept at all. */
export type TeamAgreementOutcome = "accepted" | "already" | "notRequired";

/**
 * «Accept și intru» (§1006, §1026): the acceptance of the version in force at this sign-in, **every one kept** — a row of
 * `staff_team_agreement_sign_in_acceptances` per account, version and sign-in, so the club can show the colleague accepted at each
 * sign-in — with the declarations' proof (§556, §771): the version and its own hash, the language, the name typed, the SHA-256 of
 * the exact text read in that language (`signedTextHash`, the title and every paragraph; the text has no blanks), the moment, the IP
 * address and browser, and the sign-in it answers (`signedInAt`); and the trail's row `staff.team_agreement_accepted`, which names
 * the version and that sign-in and never the name typed.
 *
 * Refused, with nothing written: a name empty or over 200 characters (`fullName`), the tick missing (`accepted`), a version that
 * is not the one in force any more (`CONFLICT` — the page reloads on the new text). A second press for the same sign-in finds the
 * first row and writes nothing (`already`), so a double tap on a phone is one acceptance and one trail row; the next sign-in is a
 * new row. A role that is not asked, or a press while no version is in force, writes nothing either (`notRequired`): the page sends
 * them on.
 */
export async function acceptTeamAgreement<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  input: TeamAgreementAcceptanceInput,
  now: Date,
): Promise<TeamAgreementOutcome> {
  if (!mustAcceptTeamAgreement(actor)) return "notRequired";
  const document = await findTeamAgreementText(db, input.locale, now);
  if (!document) return "notRequired";
  if (!isUuid(input.documentId) || input.documentId !== document.id) {
    throw new DomainError("CONFLICT", "the team's undertaking in force is not the version the page showed");
  }
  const typedName = teamAgreementName(input.fullName);
  const missing = [...(typedName === null ? ["fullName"] : []), ...(input.accepted ? [] : ["accepted"])];
  if (typedName === null || !input.accepted) {
    throw new DomainError("VALIDATION_ERROR", "the team's undertaking needs the full name and the tick", missing);
  }
  const trace = traceColumns(input.trace, true);
  const textHash = signedTextHash({ title: document.title, body: isLegalDocumentBody(document.body) ? document.body : { sections: [] }, values: {} });

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(staffTeamAgreementSignInAcceptances)
      .values({
        staffUserId: actor.id,
        legalDocumentId: document.id,
        documentVersion: document.version,
        contentSha256: document.contentSha256,
        locale: input.locale,
        typedName,
        textHash,
        ip: trace.ip,
        userAgent: trace.userAgent,
        signedInAt: input.signedInAt,
        acceptedAt: now,
      })
      // Once per account, version and sign-in (`staff_team_agreement_sign_in_acceptances_once`, NULLS NOT DISTINCT).
      .onConflictDoNothing({
        target: [
          staffTeamAgreementSignInAcceptances.staffUserId,
          staffTeamAgreementSignInAcceptances.legalDocumentId,
          staffTeamAgreementSignInAcceptances.signedInAt,
        ],
      })
      .returning({ id: staffTeamAgreementSignInAcceptances.id });
    if (!row) return "already";
    // The trail: who (the actor and the row), which version, which language, which sign-in — never the name typed (§12.12).
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "staff.team_agreement_accepted",
      entityType: "staff_user",
      entityId: actor.id,
      metadata: {
        legalDocumentId: document.id,
        version: document.version,
        locale: input.locale,
        acceptanceId: row.id,
        signedInAt: input.signedInAt?.toISOString() ?? null,
      },
      now,
    });
    return "accepted";
  });
}

/** One colleague's state on «Echipa» (§1006): not asked, not accepted, or accepted — which version, when, under which name. */
export type TeamAgreementState =
  | { kind: "notRequired" }
  | { kind: "notAccepted" }
  | { kind: "accepted"; version: number; acceptedAt: Date; typedName: string };

/**
 * Every colleague's state at once, for «Echipa», by account id: a role that is not asked reads «Nu e cerut»; a role that is reads
 * «Acceptat» with the version in force it accepted — its **newest** acceptance (§1026: one at every sign-in), its moment and the
 * name typed — or, while a version is in force that they have not accepted, «Neacceptat». While nothing is in force, the newest
 * version a colleague ever accepted still says so, and a colleague who never accepted one reads «Neacceptat». The acceptances made
 * once per account under §1006 count here as well: they are acceptances, though they answer no sign-in. Two queries of the
 * acceptances, the team's handful each.
 */
export async function teamAgreementStates<T extends Record<string, unknown>>(
  db: Database<T>,
  team: ReadonlyArray<{ id: string; role: StaffUser["role"] }>,
  now: Date,
): Promise<Map<string, TeamAgreementState>> {
  const current = await findTeamAgreementInForce(db, now);
  const columnsOf = (table: typeof staffTeamAgreementAcceptances | typeof staffTeamAgreementSignInAcceptances) => ({
    staffUserId: table.staffUserId,
    legalDocumentId: table.legalDocumentId,
    version: table.documentVersion,
    acceptedAt: table.acceptedAt,
    typedName: table.typedName,
  });
  const rows = [
    ...(await db.select(columnsOf(staffTeamAgreementSignInAcceptances)).from(staffTeamAgreementSignInAcceptances)),
    ...(await db.select(columnsOf(staffTeamAgreementAcceptances)).from(staffTeamAgreementAcceptances)),
  ].sort((a, b) => b.version - a.version || b.acceptedAt.getTime() - a.acceptedAt.getTime());

  const states = new Map<string, TeamAgreementState>();
  for (const member of team) {
    if (!mustAcceptTeamAgreement(member.role)) {
      states.set(member.id, { kind: "notRequired" });
      continue;
    }
    const mine = rows.filter((row) => row.staffUserId === member.id);
    const shown = current ? mine.find((row) => row.legalDocumentId === current.id) : mine[0];
    states.set(member.id, shown ? { kind: "accepted", version: shown.version, acceptedAt: shown.acceptedAt, typedName: shown.typedName } : { kind: "notAccepted" });
  }
  return states;
}
