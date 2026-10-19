import type { TextFieldProps } from "@mui/material/TextField";
import RecallField from "@/shared/forms/recall";

/** A level as the select needs it: the id it posts, its name in the page's language, and whether the club hid it. */
export type TierChoice = { id: string; name: string; hidden: boolean };

/**
 * «Nivel» (§811, §817): the one select of a club member's level on «Echipa» — the same options and words wherever it is
 * drawn: on each member's row, in «Adaugă mai mulți membri» (one level for every row added) and in «Adaugă o persoană»
 * (under the role «Membru»). A native select posting `tierId`; «—» (the empty value) is no level.
 *
 * It offers the levels the club still gives, in the club's order, and — with `keepId` — the one level a member already
 * holds even if hidden since, marked by `hiddenOption`, so saving that row does not clear what the member has. The caller
 * decides whether to draw it at all (nothing to choose while the club named no level); every other prop goes to the box,
 * which is a `RecallField`, so a refused press brings the choice back and the refusal marks it.
 *
 * A label and its benefits, never a permission: no choice here opens or refuses anything.
 */
export default function MemberTierSelect({
  tiers,
  noneLabel,
  hiddenOption,
  keepId,
  ...box
}: Omit<TextFieldProps, "name" | "select" | "children" | "slotProps"> & {
  tiers: readonly TierChoice[];
  /** «—»: the option that means no level. */
  noneLabel: string;
  /** «{name} (ascuns)»: how a hidden level that is still offered is worded. */
  hiddenOption: (name: string) => string;
  /** The id of the level the person already holds, offered even if hidden. */
  keepId?: string | null;
}) {
  return (
    <RecallField name="tierId" select slotProps={{ select: { native: true }, inputLabel: { shrink: true } }} {...box}>
      <option value="">{noneLabel}</option>
      {tiers
        .filter((tier) => !tier.hidden || tier.id === keepId)
        .map((tier) => (
          <option key={tier.id} value={tier.id}>
            {tier.hidden ? hiddenOption(tier.name) : tier.name}
          </option>
        ))}
    </RecallField>
  );
}
