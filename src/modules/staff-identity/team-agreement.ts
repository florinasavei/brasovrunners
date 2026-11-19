import { and, desc, eq, isNull, lte } from "drizzle-orm";
import { legalDocuments } from "@/db/schema/legal-documents";
import { staffTeamAgreementAcceptances } from "@/db/schema/staff-team-agreement-acceptances";
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
import { teamAgreementName } from "./domain/team-agreement";

/**
 * The team's undertaking at sign-in (§1006; the owner, 2026-11-19: «Voluntarii trebuie să semneze acordul GDPR când intră în
 * platformă»): what the gate reads (`session.ts`), what `/admin/acord` writes, and what «Echipa» and «Sarcini» show.
 *
 * **In force** is what every legal text's «in force» is (`findCurrentApprovedVersionId`): the highest version of
 * `STAFF_DATA_AGREEMENT` that is approved, not withdrawn and whose `effective_at` has passed. While there is none, nobody is
 * asked — a text the club has not approved binds nobody — and «Sarcini» carries the club's row. A new version in force is asked
 * once more, at the next request, of every colleague who has not accepted *it*.
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
 * The version in force this account has not accepted, or null — the gate's one question, one query. Asked only of a role that
 * must accept (`mustAcceptTeamAgreement`): the session never reads it for an Administrator, and asks it once per request however
 * many doors ask (`session.ts`, React's `cache`).
 */
export async function outstandingTeamAgreement<T extends Record<string, unknown>>(
  db: Database<T>,
  staffUserId: string,
  now: Date,
): Promise<TeamAgreementVersion | null> {
  /*
    A join, never a correlated `exists` in the selection: with one table in its FROM, Drizzle writes a selection's columns bare,
    and a bare `"id"` inside the subquery would be the acceptance's own. At most one row joins — one acceptance per account and
    version (`staff_team_agreement_acceptances_once`).
  */
  const [row] = await db
    .select({ id: legalDocuments.id, version: legalDocuments.version, acceptanceId: staffTeamAgreementAcceptances.id })
    .from(legalDocuments)
    .leftJoin(
      staffTeamAgreementAcceptances,
      and(eq(staffTeamAgreementAcceptances.legalDocumentId, legalDocuments.id), eq(staffTeamAgreementAcceptances.staffUserId, staffUserId)),
    )
    .where(inForce(now))
    .orderBy(desc(legalDocuments.version))
    .limit(1);
  return row && row.acceptanceId === null ? { id: row.id, version: row.version } : null;
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
  /** The press's IP address and browser (§771). */
  trace?: SignatureTrace;
};

/** What a press on «Accept și intru» did: a new acceptance, one already there, or nothing to accept at all. */
export type TeamAgreementOutcome = "accepted" | "already" | "notRequired";

/**
 * «Accept și intru» (§1006): the acceptance of the version in force, once per account and version, with the declarations' proof
 * (§556, §771) — the version and its own hash, the language, the name typed, the SHA-256 of the exact text read in that language
 * (`signedTextHash`, the title and every paragraph; the text has no blanks), the moment, the IP address and browser — and the
 * trail's row `staff.team_agreement_accepted`, which names the version and never the name typed.
 *
 * Refused, with nothing written: a name empty or over 200 characters (`fullName`), the tick missing (`accepted`), a version that
 * is not the one in force any more (`CONFLICT` — the page reloads on the new text). A second press finds the first row and writes
 * nothing (`already`), so a double tap on a phone is one acceptance and one trail row. A role that is not asked, or a press while
 * no version is in force, writes nothing either (`notRequired`): the page sends them on.
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
      .insert(staffTeamAgreementAcceptances)
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
        acceptedAt: now,
      })
      .onConflictDoNothing({ target: [staffTeamAgreementAcceptances.staffUserId, staffTeamAgreementAcceptances.legalDocumentId] })
      .returning({ id: staffTeamAgreementAcceptances.id });
    if (!row) return "already";
    // The trail: who (the actor and the row), which version, which language — never the name typed (§12.12).
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "staff.team_agreement_accepted",
      entityType: "staff_user",
      entityId: actor.id,
      metadata: { legalDocumentId: document.id, version: document.version, locale: input.locale, acceptanceId: row.id },
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
 * «Acceptat» with the version in force it accepted, its moment and the name typed — or, while a version is in force that they
 * have not accepted, «Neacceptat». While nothing is in force, the newest version a colleague ever accepted still says so, and a
 * colleague who never accepted one reads «Neacceptat». One query of the acceptances, the team's handful.
 */
export async function teamAgreementStates<T extends Record<string, unknown>>(
  db: Database<T>,
  team: ReadonlyArray<{ id: string; role: StaffUser["role"] }>,
  now: Date,
): Promise<Map<string, TeamAgreementState>> {
  const current = await findTeamAgreementInForce(db, now);
  const rows = await db
    .select({
      staffUserId: staffTeamAgreementAcceptances.staffUserId,
      legalDocumentId: staffTeamAgreementAcceptances.legalDocumentId,
      version: staffTeamAgreementAcceptances.documentVersion,
      acceptedAt: staffTeamAgreementAcceptances.acceptedAt,
      typedName: staffTeamAgreementAcceptances.typedName,
    })
    .from(staffTeamAgreementAcceptances)
    .orderBy(desc(staffTeamAgreementAcceptances.documentVersion), desc(staffTeamAgreementAcceptances.acceptedAt));

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
