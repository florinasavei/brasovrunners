import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { ReactElement } from "react";
import { routing } from "@/i18n/routing";
import QuietHelp from "@/shared/ui/QuietHelp";
import type { EditableEvent } from "../../repository";
import type { SummaryWords } from "../box-summaries";
import { CardRequiredLine } from "../PublishCheck";
import { type CardGapWords, missingForPublish, type PublishGapBox, storedPublishReader } from "../publish-check";
import type { TranslationDraft } from "../TranslationFields";

/**
 * What every editor box is handed (§350), the same on the create page and the editor: `event` is
 * null on create, and a part that needs a saved event renders nothing.
 */
export type BoxProps = {
  /** The event being edited, or null on the create form. */
  event: EditableEvent | null;
  /** Whether the reader may change the event row (`canEditEventFields`); the server asks again. */
  mayEditSettings: boolean;
  /** The people a change here reaches, when the box is one that reaches them (§350). */
  risk?: RiskMark | null;
  /**
   * The approved group-run declaration in force per surface, or null (§393, §448): the rules card
   * disables the option without one and names the version otherwise.
   */
  groupRunDeclarations?: Record<"ASPHALT" | "TRAIL", { version: number } | null>;
  /** The card's heading as its page section (§406), from `pageFlow`; absent, the card's own name. */
  heading?: string;
};

/**
 * A card's required line (§406): «lipsesc: Titlu (RO, EN) · …» or «complet», from what the card
 * was drawn with and then as the form is typed (`PublishCheckProvider`) — the same
 * `missingForPublish` check as Publicare, filtered to this card. A function the box awaits, not a
 * nested component, so the element is ready when the box is.
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
 * A box whose change reaches the registered: its amber outline and sentence, on the editor only,
 * with at least one real registration (`AGENTS.md` §12.6). The count itself is said once by
 * `RegisteredLine` (§408).
 */
export type RiskMark = { count: number };

/** One language of a per-language box: the text, whether the reader may write it, its name. */
export type LanguageEntry = { translation: TranslationDraft; mayEdit: boolean; label: string };

/**
 * The catalogue's summary templates for `box-summaries.ts`. Dates are written by
 * `src/i18n/dates.ts` in the reader's language, so no weekday words travel with them.
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

/** A plain one-sentence note under a field; anything more goes behind the «?» as `more` (§511). */
export function BoxNote({ children, testId, more }: { children: string; testId?: string; more?: string }) {
  return (
    <Typography variant="body2" color="text.secondary" data-testid={testId}>
      {children}
      {more ? <QuietHelp text={more} /> : null}
    </Typography>
  );
}
