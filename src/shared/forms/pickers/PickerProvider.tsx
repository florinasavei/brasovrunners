"use client";

import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { roRO } from "@mui/x-date-pickers/locales";
import "dayjs/locale/en-gb";
import "dayjs/locale/ro";
import { useLocale } from "next-intl";
import type { ReactNode } from "react";

/** The Romanian words of the pickers — "Selectați data", "Luna următoare", the ZZ.LL.AAAA placeholder. */
const ROMANIAN = roRO.components.MuiLocalizationProvider.defaultProps.localeText;

/**
 * The date and time pickers' one provider, mounted once, by the backoffice's layout
 * (`DECISIONS.md` §NNN) — and nowhere a visitor goes: no public page asks for a date the club
 * types, and `tests/unit/shared/pickers-backoffice-only.test.ts` fails if one ever reaches this.
 *
 * **Romanian** is Day.js's `ro` (months, weekdays, the week starting on Monday) with MUI's own
 * Romanian labels. **English** is Day.js's `en-gb`, not `en`: the same Monday-first week and
 * English month and day names, with MUI's built-in English labels. The *format* is not the
 * language's in either — every box passes `DD.MM.YYYY` and `HH:mm` itself (`wall-values.ts`), so
 * an English backoffice still reads `30.09.2026` and `19:00`: the club's dates, whoever reads them.
 */
export default function PickerProvider({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const romanian = locale === "ro";
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={romanian ? "ro" : "en-gb"} localeText={romanian ? ROMANIAN : undefined}>
      {children}
    </LocalizationProvider>
  );
}
