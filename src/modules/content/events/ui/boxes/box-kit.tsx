import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { countForm } from "@/i18n/count-form";
import type { EditableEvent } from "../../repository";
import type { SummaryWords } from "../box-summaries";
import type { TranslationDraft } from "../TranslationFields";

/**
 * What every box of the event editor is handed (§NNN). One set of props for the create page and
 * the editor, so the two are the same page: `event` is null on create, and a box that needs a
 * saved event says so by rendering nothing of that part.
 */
export type BoxProps = {
  /** The event being edited, or null on the create form. */
  event: EditableEvent | null;
  /** Whether the reader may change the event row (`canEditEventFields`); the server asks again. */
  mayEditSettings: boolean;
  /** The people a change here reaches, when the box is one that reaches them (§NNN). */
  risk?: RiskMark | null;
};

/**
 * "23 înscriși", and the box's own sentence about what a change does to them — only on the
 * editor, only with at least one real registration (a test row is counted nowhere the club looks,
 * `AGENTS.md` §12.6).
 */
export type RiskMark = { count: number; chip: string };

/** One language of a per-language box: the text, whether the reader may write it, its name. */
export type LanguageEntry = { translation: TranslationDraft; mayEdit: boolean; label: string };

/** The catalogue's summary templates and the weekdays' two letters, for `box-summaries.ts`. */
export async function summaryWords(): Promise<{ words: SummaryWords; weekdays: Record<string, string> }> {
  const t = await getTranslations("Admin");
  return {
    words: t.raw("editor.boxes.summary") as SummaryWords,
    weekdays: t.raw("editor.weekdays") as Record<string, string>,
  };
}

/** The risk mark for a count of real registrations, or null when there are none. */
export async function riskMark(count: number, locale: string): Promise<RiskMark | null> {
  if (count <= 0) return null;
  const t = await getTranslations("Admin");
  return { count, chip: t(`editor.risk.chip.${countForm(count, locale)}`, { count }) };
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
