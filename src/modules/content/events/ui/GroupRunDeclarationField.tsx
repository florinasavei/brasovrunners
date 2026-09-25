"use client";

import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { useRecall } from "@/shared/forms/recall";
import { CHECKBOX_TAP_TARGET } from "@/shared/ui/tap-target";
import { useSelectedValue } from "./OnlyForType";

/** The two surfaces a group run's self-declaration is written for (§393). */
type DeclarationSurface = "ASPHALT" | "TRAIL";

const SURFACES: readonly string[] = ["ASPHALT", "TRAIL"];

/**
 * "Declarație opțională pe propria răspundere" (§393), in "Traseul": whether this group run's page
 * offers the self-declaration of its surface.
 *
 * A client island because the answer follows two selects of the same form — the type (§111: only a
 * group run) and the surface (asphalt or trail: which text) — read with the observer `OnlyForType`
 * uses. Shown only for a group run; nothing is posted otherwise, which the service reads as "not
 * offered", as it would anyway (`groupRunDeclarationKeyFor`).
 *
 * **On by default for a trail group run** (the owner, 2026-09-25: the mountain rescue asks for a
 * signed declaration on the Tâmpa run) and off for asphalt. "Default" means: until somebody ticks or
 * unticks it, the box follows the surface — choosing Trail ticks it, choosing Asfalt unticks it. On
 * the editor the stored answer stands until the surface changes, so opening a saved run never
 * changes what it offers.
 *
 * **Disabled without an approved text** of the chosen kind, with a line naming the text to approve
 * in "Documente legale": a checked box with nothing to sign would promise the runner a button the
 * page cannot draw. A disabled box posts nothing — "not offered".
 */
export default function GroupRunDeclarationField({
  initialType,
  initialSurface,
  initialChecked,
  approved,
  words,
}: {
  initialType: string;
  initialSurface: string;
  /** The stored answer on the editor; on the create form, whether the defaults already say trail. */
  initialChecked: boolean;
  /** Whether the club has an approved version in force of each surface's text. */
  approved: Record<DeclarationSurface, boolean>;
  words: { label: string; help: string; notGroupSurface: string; missing: Record<DeclarationSurface, string> };
}) {
  const recall = useRecall();
  const type = useSelectedValue("event.type", initialType);
  const surface = useSelectedValue("event.surface", initialSurface);
  // Ticked or unticked by hand: from then on the box keeps what the person chose.
  const [manual, setManual] = useState<boolean | null>(null);

  if (type !== "GROUP_RUN") return null;
  const known = SURFACES.includes(surface) ? (surface as DeclarationSurface) : null;
  const available = known !== null && approved[known];
  // After a refused save, what was posted (§315): an unticked box posts nothing.
  const recalled = recall.has ? (recall.all("event.offersGroupRunDeclaration")?.includes("on") ?? false) : null;
  const followsSurface = surface !== initialSurface || type !== initialType;
  const checked = available && (manual ?? recalled ?? (followsSurface ? surface === "TRAIL" : initialChecked));

  const note = known === null ? words.notGroupSurface : available ? words.help : words.missing[known];
  return (
    <Box data-testid="group-run-declaration-field">
      <FormControlLabel
        control={
          <Checkbox
            name="event.offersGroupRunDeclaration"
            checked={checked}
            disabled={!available}
            onChange={(event) => setManual(event.target.checked)}
            sx={CHECKBOX_TAP_TARGET}
          />
        }
        label={words.label}
      />
      <Typography variant="body2" color="text.secondary">
        {note}
      </Typography>
    </Box>
  );
}
