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
 * The date picker's provider, mounted once by the backoffice layout and never on a public page
 * (§345; `tests/unit/shared/pickers-backoffice-only.test.ts`). English uses Day.js `en-gb` for a
 * Monday-first week; the display format is `DateField`'s own, so both languages read `30.09.2026`.
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
