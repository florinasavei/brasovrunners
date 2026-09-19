import { COUNTRY_CODES } from "./countries";

/**
 * Telephone numbers, stored the one way a phone can dial them (`DECISIONS.md` §84).
 *
 * The form used to accept any three characters, so "asdasdasdas" was a phone number and the
 * organizer found out on race morning. Now the form asks for the country and the number
 * separately, and this module turns the two into E.164 — `+40712345678` — or refuses.
 *
 * Deliberately not a per-country format check. ITU's national numbering plans are hundreds of
 * rules that change, and a runner from anywhere may enter: refusing a valid foreign number is
 * a worse failure than storing one nobody rings. What is checked is what is always true —
 * digits only after the prefix, four to fourteen of them, fifteen in all — plus the one
 * habit that produces an undialable number: the national trunk "0" typed before a Romanian
 * mobile, which is dropped.
 */

/**
 * ITU E.164 country calling codes by ISO 3166-1 alpha-2, for every code the nationality
 * select offers. Shared codes are shared here too (`+1` for the North American plan, `+7` for
 * Russia and Kazakhstan, `+44` for the Crown dependencies); the three uninhabited territories
 * that have no code are absent, and the select leaves them out.
 */
export const DIALING_CODES: Readonly<Record<string, string>> = {
  AD: "376", AE: "971", AF: "93", AG: "1", AI: "1", AL: "355", AM: "374", AO: "244", AQ: "672",
  AR: "54", AS: "1", AT: "43", AU: "61", AW: "297", AX: "358", AZ: "994", BA: "387", BB: "1",
  BD: "880", BE: "32", BF: "226", BG: "359", BH: "973", BI: "257", BJ: "229", BL: "590", BM: "1",
  BN: "673", BO: "591", BQ: "599", BR: "55", BS: "1", BT: "975", BW: "267", BY: "375", BZ: "501",
  CA: "1", CC: "61", CD: "243", CF: "236", CG: "242", CH: "41", CI: "225", CK: "682", CL: "56",
  CM: "237", CN: "86", CO: "57", CR: "506", CU: "53", CV: "238", CW: "599", CX: "61", CY: "357",
  CZ: "420", DE: "49", DJ: "253", DK: "45", DM: "1", DO: "1", DZ: "213", EC: "593", EE: "372",
  EG: "20", EH: "212", ER: "291", ES: "34", ET: "251", FI: "358", FJ: "679", FK: "500", FM: "691",
  FO: "298", FR: "33", GA: "241", GB: "44", GD: "1", GE: "995", GF: "594", GG: "44", GH: "233",
  GI: "350", GL: "299", GM: "220", GN: "224", GP: "590", GQ: "240", GR: "30", GS: "500", GT: "502",
  GU: "1", GW: "245", GY: "592", HK: "852", HN: "504", HR: "385", HT: "509", HU: "36", ID: "62",
  IE: "353", IL: "972", IM: "44", IN: "91", IO: "246", IQ: "964", IR: "98", IS: "354", IT: "39",
  JE: "44", JM: "1", JO: "962", JP: "81", KE: "254", KG: "996", KH: "855", KI: "686", KM: "269",
  KN: "1", KP: "850", KR: "82", KW: "965", KY: "1", KZ: "7", LA: "856", LB: "961", LC: "1",
  LI: "423", LK: "94", LR: "231", LS: "266", LT: "370", LU: "352", LV: "371", LY: "218", MA: "212",
  MC: "377", MD: "373", ME: "382", MF: "590", MG: "261", MH: "692", MK: "389", ML: "223", MM: "95",
  MN: "976", MO: "853", MP: "1", MQ: "596", MR: "222", MS: "1", MT: "356", MU: "230", MV: "960",
  MW: "265", MX: "52", MY: "60", MZ: "258", NA: "264", NC: "687", NE: "227", NF: "672", NG: "234",
  NI: "505", NL: "31", NO: "47", NP: "977", NR: "674", NU: "683", NZ: "64", OM: "968", PA: "507",
  PE: "51", PF: "689", PG: "675", PH: "63", PK: "92", PL: "48", PM: "508", PN: "64", PR: "1",
  PS: "970", PT: "351", PW: "680", PY: "595", QA: "974", RE: "262", RO: "40", RS: "381", RU: "7",
  RW: "250", SA: "966", SB: "677", SC: "248", SD: "249", SE: "46", SG: "65", SH: "290", SI: "386",
  SJ: "47", SK: "421", SL: "232", SM: "378", SN: "221", SO: "252", SR: "597", SS: "211", ST: "239",
  SV: "503", SX: "1", SY: "963", SZ: "268", TC: "1", TD: "235", TG: "228", TH: "66", TJ: "992",
  TK: "690", TL: "670", TM: "993", TN: "216", TO: "676", TR: "90", TT: "1", TV: "688", TW: "886",
  TZ: "255", UA: "380", UG: "256", UM: "1", US: "1", UY: "598", UZ: "998", VA: "39", VC: "1",
  VE: "58", VG: "1", VI: "1", VN: "84", VU: "678", WF: "681", WS: "685", YE: "967", YT: "262",
  ZA: "27", ZM: "260", ZW: "263",
};

/** The country codes a phone prefix can be chosen for: every nationality that has one. */
export const PHONE_COUNTRY_CODES: readonly string[] = COUNTRY_CODES.filter((code) => code in DIALING_CODES);

/** E.164: a plus, then at most fifteen digits. Exported for the field schema. */
export const E164_PHONE = /^\+[1-9]\d{3,14}$/;
const E164 = E164_PHONE;

/**
 * Countries whose national numbers keep their leading zero in international form. Italy is
 * the one a Romanian club will meet; everywhere else a leading zero is the trunk prefix that
 * must go.
 */
const KEEPS_LEADING_ZERO = new Set(["IT", "VA", "SM"]);

/**
 * Compose an international number from the country chosen and the digits typed, or return
 * null when what was typed cannot be a number. Tolerant of what people type — spaces, dots,
 * dashes, parentheses, a leading `+<code>` repeated, a `00` international prefix — and strict
 * about the one thing that matters: what remains is four to fourteen digits.
 */
export function composePhone(countryCode: string, typed: string): string | null {
  const dialing = DIALING_CODES[countryCode.toUpperCase()];
  if (!dialing) return null;

  let digits = typed.replace(/[\s().\-]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith(dialing) && digits.length > dialing.length + 6) {
    // Typed with the country code and no plus, as some people copy it from a contact card.
  } else if (!/^\d+$/.test(digits)) {
    return null;
  } else {
    if (!KEEPS_LEADING_ZERO.has(countryCode.toUpperCase())) digits = digits.replace(/^0+/, "");
    const candidate = `+${dialing}${digits}`;
    return E164.test(candidate) && digits.length >= 4 ? candidate : null;
  }

  // The international form was typed: it must start with the chosen country's code.
  if (!/^\d+$/.test(digits) || !digits.startsWith(dialing)) return null;
  const candidate = `+${digits}`;
  return E164.test(candidate) && digits.length - dialing.length >= 4 ? candidate : null;
}

/**
 * Split a stored E.164 number back into the country and the national part for a form —
 * the longest dialing code that matches wins, and a shared code (`+1`, `+44`) falls back to
 * the first country carrying it in ISO order, which for `+1` is Antigua and for `+44` Great
 * Britain: good enough for a prefill, and the person corrects the country in one tap.
 */
export function splitPhone(stored: string | null | undefined, fallbackCountry = "RO"): { countryCode: string; national: string } {
  if (!stored || !stored.startsWith("+")) return { countryCode: fallbackCountry, national: stored ?? "" };
  const digits = stored.slice(1);
  let best: { countryCode: string; dialing: string } | undefined;
  for (const [countryCode, dialing] of Object.entries(DIALING_CODES)) {
    if (digits.startsWith(dialing) && (!best || dialing.length > best.dialing.length)) {
      best = { countryCode, dialing };
    }
  }
  // Prefer the fallback country when its code is one of the matches (Romania over the rest of +40? none share it; +1 and +44 do).
  if (best && DIALING_CODES[fallbackCountry] === best.dialing) best = { countryCode: fallbackCountry, dialing: best.dialing };
  if (!best) return { countryCode: fallbackCountry, national: stored };
  return { countryCode: best.countryCode, national: digits.slice(best.dialing.length) };
}

/** `+40 712 345 678`-ish for reading: the plus and the code, then the rest in groups of three. */
export function formatPhone(stored: string | null | undefined): string {
  if (!stored || !stored.startsWith("+")) return stored ?? "";
  const { countryCode, national } = splitPhone(stored);
  const dialing = DIALING_CODES[countryCode] ?? "";
  return `+${dialing} ${national.replace(/(\d{3})(?=\d)/g, "$1 ")}`.trim();
}
