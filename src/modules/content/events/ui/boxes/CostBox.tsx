import Stack from "@mui/material/Stack";
import { getTranslations } from "next-intl/server";
import { costPaidToExternalOrganizer, EVENT_COST_TYPES } from "@/modules/events/domain/cost";
import { identicalInBothLanguages, isWrittenText } from "@/shared/forms/both-languages";
import { textFieldConstraints } from "@/shared/forms/constraints";
import LocaleTabPanels from "@/shared/ui/LocaleTabPanels";
import Panel from "@/shared/ui/Panel";
import { type EventFieldName, eventInputConstraints } from "../../constraints";
import { initialCostTypeOf } from "../box-summaries";
import CostFields from "../CostFields";
import GlyphSelect from "../GlyphSelect";
import { DiscountNoteFields } from "../TranslationFields";
import { type BoxProps, type LanguageEntry } from "./box-kit";

/** The box's own constraints, read off `fields.ts`, as `TextField` takes them (§315). */
function box(field: EventFieldName, extra: Record<string, unknown> = {}) {
  return textFieldConstraints(eventInputConstraints(field), extra);
}

/** The cost's closed line («Cu taxă, 50 lei, cu reducere», «Gratuit», …), also part of `KindBox`'s (§466). */
export async function costLine(event: BoxProps["event"], languages: readonly LanguageEntry[]): Promise<string> {
  const t = await getTranslations("Admin");
  // Not `event?.costType`: the create page's "Gratuit" default must read here too.
  const initialCostType = initialCostTypeOf(event);
  // The kind in the select's words, with the amount beside a kind that has one (§343).
  const costAmount = initialCostType === "PAID" || initialCostType === "DONATION" ? (event?.costAmount ?? "").trim() : "";
  // "cu reducere" (§394): an `EXTERNAL` + `PAID` event with a discount note in some language.
  const hasDiscountNote = languages.some((entry) => isWrittenText(entry.translation.discountNote));
  const discounted = event ? costPaidToExternalOrganizer(event) && hasDiscountNote : false;
  return initialCostType
    ? `${t(`editor.costValues.${initialCostType}`)}${costAmount ? `, ${costAmount}` : ""}${discounted ? `, ${t("editor.discountSummary")}` : ""}`
    : t("editor.notStated");
}

/**
 * "Cost" (§343, §394, §466): a named card inside «Ce fel de eveniment», id `box-cost` so a deep
 * link still opens it (`openFoldsAround`), with no number or map chip. The empty option is "not
 * stated", which the page shows by omitting the row. A new event starts on `FREE` (§398); an
 * edited one keeps what it has, and since the select always posts (even folded) a create that
 * never opens the card still writes `FREE`. A words-only reader (Redactor, §103) sees heading and
 * line, and on an `EXTERNAL` + `PAID` event the discount note strip, which is theirs (§394).
 */
export default async function CostBox({
  event,
  mayEditSettings,
  heading,
  languages,
}: BoxProps & {
  /** Every language's row, for the discount note's own strip (§394). */
  languages: readonly LanguageEntry[];
}) {
  const t = await getTranslations("Admin");
  const initialMode = event?.registrationMode ?? "NONE";
  // A new event starts on "Gratuit" (§398, `initialCostTypeOf`).
  const initialCostType = initialCostTypeOf(event);
  // Whether a reader without settings may type the note (§394): by the stored mode and cost.
  const discountNoteApplies = event !== null && costPaidToExternalOrganizer(event);
  const costLabel = await costLine(event, languages);
  const card = { id: "box-cost", glyph: "cost", level: 3, title: heading ?? t("editor.boxes.cost.title"), aside: costLabel } as const;

  // One strip, used inside `CostFields` for a settings editor and on its own for a words-only reader.
  const discountNotePanels = (
    <LocaleTabPanels
      idPrefix="discount-note"
      translateCard
      panels={languages.map((entry) => ({
        locale: entry.translation.locale,
        label: entry.label,
        content: <DiscountNoteFields translation={entry.translation} mayEdit={entry.mayEdit} />,
      }))}
      identical={{
        names: ["discountNote"],
        warning: t("editor.identical.warning"),
        mark: t("editor.identical.tab"),
        initial: (() => {
          const [first, ...rest] = languages;
          return first ? rest.some((entry) => identicalInBothLanguages(first.translation.discountNote, entry.translation.discountNote)) : false;
        })(),
      }}
    />
  );

  if (!mayEditSettings) {
    // Heading and line only, unless the discount note is theirs to write (§394). The "no settings
    // rights" sentence is already said once (`RegistrationBox`).
    if (!discountNoteApplies) return <Panel {...card} />;
    return <Panel collapsible {...card}>{discountNotePanels}</Panel>;
  }

  return (
    <Panel collapsible {...card}>
      <Stack spacing={2}>
        <GlyphSelect
          name="event.costType"
          label={t("editor.fields.costType")}
          helperText={t("editor.costHelp")}
          defaultValue={initialCostType}
          options={[
            { value: "", label: t("editor.notStated") },
            ...EVENT_COST_TYPES.map((value) => ({ value, label: t(`editor.costValues.${value}`), glyph: `cost:${value}` as const })),
          ]}
        />

        {/* One pair of columns, relabelled by `CostFields` for PAID or DONATION (§343). */}
        <CostFields
          initialCostType={initialCostType}
          initialMode={initialMode}
          costAmount={{ defaultValue: event?.costAmount ?? "", box: box("costAmount") }}
          costUrl={{ defaultValue: event?.costUrl ?? "", box: box("costUrl", { inputMode: "url" }) }}
          labels={{
            paidAmount: t("editor.costAmount"),
            paidAmountHelp: t("editor.costAmountHelp"),
            paidUrl: t("editor.costPaidUrl"),
            paidUrlHelp: t("editor.costPaidUrlHelp"),
            donationUrl: t("editor.costDonationUrl"),
            donationUrlHelp: t("editor.costDonationUrlHelp"),
            donationAmount: t("editor.costDonationAmount"),
            donationAmountHelp: t("editor.costDonationAmountHelp"),
          }}
        >
          {discountNotePanels}
        </CostFields>
      </Stack>
    </Panel>
  );
}
