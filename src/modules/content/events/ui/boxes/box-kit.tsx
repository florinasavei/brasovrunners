import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { ReactElement } from "react";
import { routing } from "@/i18n/routing";
import type { EditableEvent } from "../../repository";
import type { SummaryWords } from "../box-summaries";
import { CardRequiredLine } from "../PublishCheck";
import { type CardGapWords, missingForPublish, type PublishGapBox, storedPublishReader } from "../publish-check";
import type { TranslationDraft } from "../TranslationFields";

/**
 * What every box of the event editor is handed (§350). One set of props for the create page and
 * the editor, so the two are the same page: `event` is null on create, and a box that needs a
 * saved event says so by rendering nothing of that part.
 */
export type BoxProps = {
  /** The event being edited, or null on the create form. */
  event: EditableEvent | null;
  /** Whether the reader may change the event row (`canEditEventFields`); the server asks again. */
  mayEditSettings: boolean;
  /** The people a change here reaches, when the box is one that reaches them (§350). */
  risk?: RiskMark | null;
  /**
   * The approved group-run declaration in force for each surface, or null (§393): the rules card's
   * "Declarație opțională" is disabled for a surface without one, and names the version of one that
   * has it (§NNN). Absent: none.
   */
  groupRunDeclarations?: Record<"ASPHALT" | "TRAIL", { version: number } | null>;
  /**
   * The card's heading as the page's section it writes (§406): "4 · Data și ora — apare pe
   * pagină", from `pageFlow`. Absent: the card's own name alone.
   */
  heading?: string;
};

/**
 * A card's required line (§406): «lipsesc: Titlu (RO, EN) · Rezumat (RO)» or «complet», for a
 * card that holds a box publication needs — first from what the card was drawn with (the saved
 * event, or the blank create form), then as the form is typed (`PublishCheckProvider`). The one
 * check the Publicare list and "Publică" run (`missingForPublish`), filtered to this card.
 *
 * A function the box awaits rather than a component it nests, so the element it hands the heading
 * is ready when the box is (a string renderer cannot wait for an async component inside a tree).
 */
export async function requiredLine(
  box: PublishGapBox,
  event: Pick<EditableEvent, "locationName" | "locationToBeAnnounced"> | null,
  languages: readonly LanguageEntry[],
): Promise<ReactElement> {
  const read = storedPublishReader(
    event ?? { locationName: null, locationToBeAnnounced: false },
    languages.map((entry) => entry.translation),
  );
  const initial = missingForPublish(read, routing.locales).filter((gap) => gap.box === box);
  return <CardRequiredLine box={box} initial={initial} words={await cardGapWords()} />;
}

/** The words of a card's required line, from the catalogue. */
export async function cardGapWords(): Promise<CardGapWords> {
  const t = await getTranslations("Admin");
  return {
    missing: t.raw("editor.required.missing") as string,
    complete: t("editor.required.complete"),
    fields: {
      title: t("editor.fields.title"),
      excerpt: t("editor.boxes.summaryLabel"),
      locationName: t("editor.fields.locationName"),
      slug: t("editor.fields.slug"),
    },
  };
}

/**
 * A box whose change reaches people who registered: its amber outline and its own sentence about
 * what a change does to them — only on the editor, only with at least one real registration (a
 * test row is counted nowhere the club looks, `AGENTS.md` §12.6).
 *
 * The number itself is said once, on the line under the page map (`RegisteredLine`, §408; the
 * owner: "informația «3 înscriși» se repetă de prea multe ori pe fiecare card"), never on a box:
 * the outline is the mark, the line is the count.
 */
export type RiskMark = { count: number };

/** One language of a per-language box: the text, whether the reader may write it, its name. */
export type LanguageEntry = { translation: TranslationDraft; mayEdit: boolean; label: string };

/**
 * The catalogue's summary templates, for `box-summaries.ts`. The dates in them are written by
 * `src/i18n/dates.ts` in the reader's language (§350 weekday on every date), so no weekday words
 * travel with them.
 */
export async function summaryWords(): Promise<{ words: SummaryWords }> {
  const t = await getTranslations("Admin");
  return { words: t.raw("editor.boxes.summary") as SummaryWords };
}

/** The risk mark for a count of real registrations, or null when there are none. */
export function riskMark(count: number): RiskMark | null {
  return count > 0 ? { count } : null;
}

/** The first line inside a box that reaches people: what a change here does to them. */
export function RiskLine({ children }: { children: string }) {
  return (
    <Alert severity="warning" sx={{ mb: 2 }} data-testid="risk-line">
      {children}
    </Alert>
  );
}

/** The line a role without settings rights reads inside a settings box, instead of its inputs. */
export async function SettingsReadOnly() {
  const t = await getTranslations("Admin");
  return (
    <Typography variant="body2" color="text.secondary">
      {t("editor.boxes.settingsReadOnly")}
    </Typography>
  );
}

/** A plain sentence under a field or in place of a group of fields. */
export function BoxNote({ children, testId }: { children: string; testId?: string }) {
  return (
    <Typography variant="body2" color="text.secondary" data-testid={testId}>
      {children}
    </Typography>
  );
}
