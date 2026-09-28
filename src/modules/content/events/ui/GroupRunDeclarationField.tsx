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
 * "Declarație opțională pe propria răspundere" (§393, §448): whether this group run's page offers
 * the self-declaration of its surface. Client, to follow the type and surface selects (the
 * `OnlyForType` observer); shown only for a group run. Until ticked by hand it follows the surface
 * — on for trail, off for asphalt — while a saved run keeps its stored answer until the surface
 * changes. Disabled (posts nothing) without an approved text of that kind, since the page could
 * not draw the button.
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
  words: {
    label: string;
    help: string;
    notGroupSurface: string;
    missing: Record<DeclarationSurface, string>;
    /** "Textul în vigoare pentru trail: …, v2." — only for a surface with an approved text (§448). */
    inForce: Partial<Record<DeclarationSurface, string>>;
    /** "Suprafața, din cardul «Traseul»: Trail" — one line per value of the surface select, blank included. */
    surfaceLines: Record<string, string>;
  };
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
  const inForce = known !== null && available ? words.inForce[known] : undefined;
  return (
    <Box data-testid="group-run-declaration-field">
      <Typography variant="body2" data-testid="group-run-declaration-surface">
        {words.surfaceLines[surface] ?? words.surfaceLines[""]}
      </Typography>
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
      {inForce && (
        <Typography variant="body2" data-testid="group-run-declaration-in-force">
          {inForce}
        </Typography>
      )}
      <Typography variant="body2" color="text.secondary">
        {note}
      </Typography>
    </Box>
  );
}
