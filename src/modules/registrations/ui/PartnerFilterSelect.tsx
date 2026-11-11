"use client";

import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { useState } from "react";
import { ACTION_ICONS } from "@/shared/ui/action-icons";

/** «De la parteneri»'s glyph, the partners' handshake, from the one registry by name (§694). */
const HandshakeIcon = ACTION_ICONS.sponsors;

/** What the select holds: no filter, any partner, or one partner by name. */
const ANY = "any";
const ONE = "name:";

/**
 * The registrations list's filter by partner (the list's column «Partener»), where the tick «De la parteneri» was: one select —
 * every registration, the rows from any partner, or one partner of the chosen event. A small island only because the three
 * post under two names: «de la orice partener» posts `partner=1`, exactly what the tick posted, so every link written before
 * still means the same; a partner posts its name under a parameter of its own (`PARTNER_FILTER_PARAM`), which the server
 * validates against the event's partners and otherwise ignores. «Toate înscrierile» posts neither. Strings in, plain inputs out: nothing of the
 * label's module crosses here. The names list is empty with every event listed — a partner is chosen within one event.
 */
export default function PartnerFilterSelect({
  label,
  help,
  allLabel,
  anyLabel,
  partners,
  chosen,
  anyChosen,
  anyName,
  oneName,
}: {
  label: string;
  help: string;
  allLabel: string;
  anyLabel: string;
  /** The chosen event's partners, each once; empty with every event listed. */
  partners: readonly string[];
  /** The partner the list is filtered to now, as the server validated it, or null. */
  chosen: string | null;
  /** Whether the list is filtered to any partner now (`partner=1`). */
  anyChosen: boolean;
  /** The two parameters' names: `partner` (posted `1`) and the one partner's. */
  anyName: string;
  oneName: string;
}) {
  const [value, setValue] = useState(chosen !== null ? `${ONE}${chosen}` : anyChosen ? ANY : "");
  return (
    <>
      <TextField
        select
        label={label}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        helperText={help}
        slotProps={{
          select: { displayEmpty: true },
          inputLabel: { shrink: true },
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <HandshakeIcon aria-hidden fontSize="small" data-testid="registrations-filter-partner-glyph" />
              </InputAdornment>
            ),
          },
        }}
        // As wide as its frame (at most 320 px, never the screen): a long partner's name is cut by the select's own ellipsis.
        fullWidth
        data-testid="registrations-filter-partner-select"
      >
        <MenuItem value="">{allLabel}</MenuItem>
        <MenuItem value={ANY}>{anyLabel}</MenuItem>
        {partners.map((name) => (
          <MenuItem key={name} value={`${ONE}${name}`} sx={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>
            {name}
          </MenuItem>
        ))}
      </TextField>
      {value === ANY && <input type="hidden" name={anyName} value="1" />}
      {value.startsWith(ONE) && <input type="hidden" name={oneName} value={value.slice(ONE.length)} />}
    </>
  );
}
