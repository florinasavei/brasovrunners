import { eq } from "drizzle-orm";
import { z } from "zod";
import { platformSettings } from "@/db/schema/platform-settings";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { type AuditAction, recordAuditEvent } from "@/modules/audit/repository";
import { type RichTextDoc, richTextSchema, richTextToPlainText } from "@/modules/content/rich-text/domain/schema";
import { normalizeTeamText, resolveRichPair, richTextBox, storedTeamDoc } from "@/modules/content/team/fields";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canEditMembersPage, canPublishMembersPage } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";

/**
 * The members' pages (§524): «Beneficiile membrilor», the public page that says what a member of
 * the club gets and carries the sign-in button, and the members' zone behind that sign-in — one
 * page of the club's words for its members alone.
 *
 * One `platform_settings` row, «Echipa»'s shape (§459): `status` is DRAFT until an Administrator
 * publishes the public page — both languages at once (§28) — and each of the two texts is the
 * club's, Romanian **and** English or neither (§352), written in the editor every page uses. The
 * members' zone does not wait for the public page: a member signed in reads it whatever the
 * public page's state, because it is behind the sign-in either way.
 *
 * **The zone's words never reach a public read.** `readPublicMembersPage` returns the status and
 * the benefits alone; the zone's text is read per request, by `readMembersZone`, only for a
 * signed-in account (`app/[locale]/members-area/page.tsx`), and never through the public cache.
 *
 * A row this code cannot read is a DRAFT page with no words — the safe answer: nothing is shown
 * that nobody decided to show.
 */

export const MEMBERS_PAGE_SETTING_KEY = "membersPage";
/**
 * `audit_logs.entity_id` for this setting, one fixed id per key, never reused (§164's rule). Far
 * from the …e0NN run the sibling settings count up through, so a branch added beside this one
 * cannot take the same id by counting.
 */
export const MEMBERS_PAGE_SETTING_ENTITY_ID = "00000000-0000-4000-8000-00000000e0c1";

/** Each text's words, counted as the page reads them (`richTextToPlainText`). */
export const MEMBERS_TEXT_MAX = 8000;

export type MembersPageStatus = "DRAFT" | "PUBLISHED";

/**
 * The page's state and its two texts. `*Json` is the document the editor wrote; the plain twin
 * keeps its words, for the page's description and so a reader of the row sees what it says.
 */
export type MembersPageSettings = {
  status: MembersPageStatus;
  benefitsRo: string | null;
  benefitsEn: string | null;
  benefitsRoJson: RichTextDoc | null;
  benefitsEnJson: RichTextDoc | null;
  zoneRo: string | null;
  zoneEn: string | null;
  zoneRoJson: RichTextDoc | null;
  zoneEnJson: RichTextDoc | null;
};

export const DEFAULT_MEMBERS_PAGE: MembersPageSettings = {
  status: "DRAFT",
  benefitsRo: null,
  benefitsEn: null,
  benefitsRoJson: null,
  benefitsEnJson: null,
  zoneRo: null,
  zoneEn: null,
  zoneRoJson: null,
  zoneEnJson: null,
};

/** The two texts, by the name the forms, the audit and the editor use. */
export const MEMBERS_TEXTS = ["benefits", "zone"] as const;
export type MembersText = (typeof MEMBERS_TEXTS)[number];

const storedDoc = z
  .unknown()
  .optional()
  .transform((value) => {
    if (value === undefined || value === null) return null;
    const parsed = richTextSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  });

const storedPlain = z.string().nullable().optional().transform((value) => value ?? null);

const storedSchema = z.object({
  status: z.enum(["DRAFT", "PUBLISHED"]),
  benefitsRo: storedPlain,
  benefitsEn: storedPlain,
  benefitsRoJson: storedDoc,
  benefitsEnJson: storedDoc,
  zoneRo: storedPlain,
  zoneEn: storedPlain,
  zoneRoJson: storedDoc,
  zoneEnJson: storedDoc,
});

/** A plain box of the form, absent reading as empty — the editor posts a document instead. */
const plainBox = z.string().optional().default("").transform(normalizeTeamText).pipe(z.string().max(MEMBERS_TEXT_MAX));

/** One text's two languages as posted: `<text>RoBody` and `<text>EnBody`, both or neither (§352). */
function textSchema(text: MembersText) {
  return z
    .object({ ro: plainBox, en: plainBox, roBody: richTextBox, enBody: richTextBox })
    .transform((fields, ctx) => {
      const pair = resolveRichPair(
        ctx,
        { ro: { plain: fields.ro, body: fields.roBody }, en: { plain: fields.en, body: fields.enBody } },
        // The names the form posts, so a refusal lands on the box that was typed in (§315).
        { ro: { plain: `${text}Ro`, body: `${text}RoBody` }, en: { plain: `${text}En`, body: `${text}EnBody` } },
        // A page's own column: a table fits, as on a standing page and «Echipa»'s introduction.
        { max: MEMBERS_TEXT_MAX, tables: true, what: text === "benefits" ? "the benefits" : "the members' zone" },
      );
      return { ro: pair.ro, en: pair.en };
    });
}

type Actor = Pick<StaffUser, "id" | "role">;

export async function readMembersPageSettings<T extends Record<string, unknown>>(db: Database<T>): Promise<MembersPageSettings> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, MEMBERS_PAGE_SETTING_KEY)).limit(1);
  if (!row) return DEFAULT_MEMBERS_PAGE;
  const parsed = storedSchema.safeParse(row.value);
  return parsed.success ? parsed.data : DEFAULT_MEMBERS_PAGE;
}

/** One text's two sides as the editor opens them: the stored document, or the plain words as paragraphs. */
export function membersTextDocs(settings: MembersPageSettings, text: MembersText): { ro: RichTextDoc | null; en: RichTextDoc | null } {
  return text === "benefits"
    ? { ro: storedTeamDoc(settings.benefitsRoJson, settings.benefitsRo), en: storedTeamDoc(settings.benefitsEnJson, settings.benefitsEn) }
    : { ro: storedTeamDoc(settings.zoneRoJson, settings.zoneRo), en: storedTeamDoc(settings.zoneEnJson, settings.zoneEn) };
}

/**
 * One text in this language — the document, and its words for a description — or nulls unless both
 * sides are written (§352, §354): a pair with one side is none on both pages.
 */
export function membersTextFor(locale: string, settings: MembersPageSettings, text: MembersText): { doc: RichTextDoc | null; words: string | null } {
  const docs = membersTextDocs(settings, text);
  if (!docs.ro || !docs.en) return { doc: null, words: null };
  const doc = locale === "en" ? docs.en : docs.ro;
  const words = richTextToPlainText(doc).replace(/\s+/g, " ").trim();
  return { doc, words: words === "" ? null : words };
}

/** What a visitor may read of the members' pages: whether the public page is on, and its benefits. Never the zone. */
export type PublicMembersPage = { published: boolean; benefits: RichTextDoc | null; benefitsText: string | null };

/**
 * Whether «Membri» is in the menu and the sitemap (§524): the page published **and** its benefits
 * written — both languages, since `benefits` is null for a text written in one (§352). A published
 * page with no words would put the platform's placeholder sentence in every visitor's menu; the
 * address itself still answers, for the link the club has already shared. «Echipa»'s rule (§459):
 * in the menu only while there is something to read.
 */
export function offersMembersEntry(page: Pick<PublicMembersPage, "published" | "benefits">): boolean {
  return page.published && page.benefits !== null;
}

export async function readPublicMembersPage<T extends Record<string, unknown>>(db: Database<T>, locale: Locale): Promise<PublicMembersPage> {
  const settings = await readMembersPageSettings(db);
  if (settings.status !== "PUBLISHED") return { published: false, benefits: null, benefitsText: null };
  const benefits = membersTextFor(locale, settings, "benefits");
  return { published: true, benefits: benefits.doc, benefitsText: benefits.words };
}

/** The members' zone's words in this language, or null — for a signed-in account alone (the page asserts it). */
export async function readMembersZone<T extends Record<string, unknown>>(db: Database<T>, locale: Locale): Promise<RichTextDoc | null> {
  return membersTextFor(locale, await readMembersPageSettings(db), "zone").doc;
}

async function writeSettings<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  next: MembersPageSettings,
  audit: { action: AuditAction; metadata: Record<string, unknown> },
  now: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: MEMBERS_PAGE_SETTING_KEY, value: next, updatedAt: now, updatedByStaffUserId: actor.id })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: next, updatedAt: now, updatedByStaffUserId: actor.id } });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: audit.action,
      entityType: "platform_setting",
      entityId: MEMBERS_PAGE_SETTING_ENTITY_ID,
      metadata: audit.metadata,
      now,
    });
  });
  // The page, the header's entry and the sitemap read the public part from the public cache under
  // `pages` (§333), as «Echipa» does. The zone is never cached, so nothing else is to expire.
  revalidatePublicContent("pages");
}

/**
 * One of the two texts, both languages or neither — the Redactor's and the Administrator's
 * (`canEditMembersPage`). `fields` carries `<text>RoBody` / `<text>EnBody` as the editor posts them.
 */
export async function saveMembersText<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; text: MembersText; fields: Record<string, unknown>; now?: Date },
): Promise<MembersPageSettings> {
  if (!canEditMembersPage(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not edit the members' pages`);
  }
  const { text } = input;
  const parsed = textSchema(text).safeParse({
    ro: input.fields[`${text}Ro`],
    en: input.fields[`${text}En`],
    roBody: input.fields[`${text}RoBody`],
    enBody: input.fields[`${text}EnBody`],
  });
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))],
    );
  }
  const before = await readMembersPageSettings(db);
  const { ro, en } = parsed.data;
  const next: MembersPageSettings =
    text === "benefits"
      ? { ...before, benefitsRo: ro.plain, benefitsEn: en.plain, benefitsRoJson: ro.doc, benefitsEnJson: en.doc }
      : { ...before, zoneRo: ro.plain, zoneEn: en.plain, zoneRoJson: ro.doc, zoneEnJson: en.doc };
  await writeSettings(
    db,
    input.actor,
    next,
    // The shape of the change, never the words (§12.12).
    { action: "members_page.text_saved", metadata: { text, written: ro.doc !== null } },
    input.now ?? new Date(),
  );
  return next;
}

/**
 * Put «Beneficiile membrilor» on the site in both languages, or take it off — the Administrator's,
 * the threshold of every other crossing into public view (§201). The zone is not switched by it.
 */
export async function setMembersPagePublished<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; published: boolean; now?: Date },
): Promise<MembersPageSettings> {
  if (!canPublishMembersPage(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not publish the members' page`);
  }
  const before = await readMembersPageSettings(db);
  const next: MembersPageSettings = { ...before, status: input.published ? "PUBLISHED" : "DRAFT" };
  await writeSettings(
    db,
    input.actor,
    next,
    { action: input.published ? "members_page.published" : "members_page.unpublished", metadata: { from: before.status, to: next.status } },
    input.now ?? new Date(),
  );
  return next;
}
