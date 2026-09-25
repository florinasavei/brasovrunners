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
import { type BoxProps, type LanguageEntry, SettingsReadOnly } from "./box-kit";

/** The box's own constraints, read off `fields.ts`, as `TextField` takes them (§315). */
function box(field: EventFieldName, extra: Record<string, unknown> = {}) {
  return textFieldConstraints(eventInputConstraints(field), extra);
}

/**
 * "Cost" (§343, §356, §394, §398, §NNN): its own card, where the page draws its own row — after the
 * course, before who may enter and the button (`page-sections.ts`). It was the top of "Participare
 * și înscrieri" and moved whole: the same select, the same names, the same `CostFields`, the same
 * discount-note strip. The owner, 2026-09-25: "am nevoie de mai multe căsuțe la editor ca să văd
 * exact ce flow am în pagină".
 *
 * On every type: the empty option is "not stated", a real answer the page shows by omitting the
 * row. `CostFields` and the discount note read the type and mode selects by name (`useSelectedValue`),
 * wherever those sit on the form, so the move needs nothing of them.
 *
 * **A new event starts free** (§398; the owner: "by default toate evenimentele sunt gratuite"): the
 * select preselects `FREE` only when `event === null` (the create page); an edited event, unstated
 * cost included, keeps exactly what it has. Because the select always posts — folded or not,
 * `<details>` still submits what is inside it — a save that never opened this card on the create
 * page still writes `FREE`.
 *
 * **A words-only reader** (Redactor, §103) sees the heading and the line; on an `EXTERNAL` + `PAID`
 * event they still own the club's discount note (§394), so the card opens onto that strip alone,
 * gated on the stored mode and cost rather than the live select they cannot change.
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
  // A new event starts on "Gratuit" (§398, `initialCostTypeOf`); an existing one keeps what it has.
  const initialCostType = initialCostTypeOf(event);
  // "Cu taxă, 50 lei", "Donație": the kind in the select's own words, and the amount beside a kind
  // that has one (§343) — what the page will say, on the card's closed line. `initialCostType`
  // rather than `event?.costType` so the create page's own "Gratuit" default reads here too.
  const costAmount = initialCostType === "PAID" || initialCostType === "DONATION" ? (event?.costAmount ?? "").trim() : "";
  // "cu reducere" (§394): the closed line names the club's discount when the event is `EXTERNAL` +
  // `PAID` and at least one language carries a note — read off the strip's own rows.
  const hasDiscountNote = languages.some((entry) => isWrittenText(entry.translation.discountNote));
  const discounted = event ? costPaidToExternalOrganizer(event) && hasDiscountNote : false;
  // Whether the note may be typed by a reader without the settings (§394): the stored mode and cost.
  const discountNoteApplies = event !== null && costPaidToExternalOrganizer(event);
  const costLabel = initialCostType
    ? `${t(`editor.costValues.${initialCostType}`)}${costAmount ? `, ${costAmount}` : ""}${discounted ? `, ${t("editor.discountSummary")}` : ""}`
    : null;
  const card = { id: "box-cost", title: heading ?? t("editor.boxes.cost.title"), aside: costLabel ?? t("editor.notStated") } as const;

  // One strip, used inside `CostFields` for a settings editor and on its own for a words-only reader.
  const discountNotePanels = (
    <LocaleTabPanels
      idPrefix="discount-note"
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
    // Heading and line, nothing to open — unless the discount note is theirs to write (§394).
    if (!discountNoteApplies) return <Panel {...card} />;
    return (
      <Panel collapsible {...card}>
        <Stack spacing={2}>
          <SettingsReadOnly />
          {discountNotePanels}
        </Stack>
      </Panel>
    );
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

        {/*
          "Suma" and "Unde se plătește" for a paid event, "Link pentru donație" and "Suma sugerată"
          for a donation (§343; the owner: "Cu taxă" showed no box for the money, and usually nothing
          is paid — the exception is Wings for Life, where a donation is made on another site). One
          pair of columns, relabelled by `CostFields` rather than posted twice; shown only while the
          chosen kind needs one of them, values kept otherwise.
        */}
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
