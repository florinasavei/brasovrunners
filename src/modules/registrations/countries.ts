/**
 * ISO 3166-1 alpha-2 codes (BR-REQ-031-04).
 *
 * Codes only. The names come from `Intl.DisplayNames` at render time (`names.ts#countryName`),
 * which is why this is 249 short strings rather than 249 pairs in two languages that would be
 * wrong the day a country renames itself, and why adding a third locale costs nothing here.
 *
 * There is no platform API that enumerates region codes, so the list itself has to exist
 * somewhere; keeping it to codes is the smallest honest version of it.
 */
export const COUNTRY_CODES: readonly string[] = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS",
  "BT", "BV", "BW", "BY", "BZ", "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN",
  "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE",
  "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD", "GE", "GF",
  "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY", "HK", "HM",
  "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT", "JE", "JM",
  "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC",
  "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK",
  "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA",
  "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF", "PG",
  "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS",
  "ST", "SV", "SX", "SY", "SZ", "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO",
  "TR", "TT", "TV", "TW", "TZ", "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI",
  "VN", "VU", "WF", "WS", "YE", "YT", "ZA", "ZM", "ZW",
];

/**
 * The club is in Brașov and most entrants will be Romanian, so `RO` is offered first and the
 * rest follow in the reader's own alphabetical order — a Romanian reader should not scroll past
 * two hundred countries to find their own, and an Austrian should still find Österreich under Ö.
 */
export function countryOptions(locale: "ro" | "en", name: (code: string) => string) {
  const rest = COUNTRY_CODES.filter((code) => code !== "RO")
    .map((code) => ({ code, label: name(code) }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));

  return [{ code: "RO", label: name("RO") }, ...rest];
}

/**
 * The flag for a country code (§171; the owner: "și la cetățenie pune steaguri man").
 *
 * Two regional indicator symbols — `RO` becomes 🇷🇴 — which is the platform's own answer and
 * costs nothing: no icon package, no 249 SVGs to ship, no hostname to fetch from. Every code in
 * `COUNTRY_CODES` is two ASCII letters, so the arithmetic is total.
 *
 * **It degrades to letters on Windows**, which draws the two indicators as boxed capitals
 * instead of a flag, and that is accepted: the country's name is the label and this is the mark
 * beside it, so the row reads correctly either way. Shipping flag images to fix a rendering
 * choice one desktop platform makes is not worth a megabyte on every phone.
 */
export function countryFlag(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "";
  const BASE = 0x1f1e6; // 🇦, the regional indicator for "A"
  return String.fromCodePoint(...[...code.toUpperCase()].map((letter) => BASE + letter.charCodeAt(0) - 65));
}
