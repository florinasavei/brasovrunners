import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { countForm } from "@/i18n/count-form";
import { hoursPhrase, minutesPhrase } from "@/modules/deadlines/domain/duration-words";

/**
 * The outage grace's two Administrators' emails (§657), in both languages: «Site-ul nu se găsește după
 * nume» while a `dns` window is open, and «Ceasul termenelor a stat pe loc» once a window is over and its
 * deadlines have moved.
 *
 * The window's facts — its instants, what it gave back, the club's cap, the counts, from the payload
 * the job wrote (`registrations/outage-grace.ts`) — are the message's bold line, and under it one link
 * per claim the window did not revive (the person's name, the event, the backoffice page), resolved at
 * the send from the ids the payload carries (`render.ts`): the staff see names, the outbox keeps none.
 * The paragraphs are the platform's sentences alone, chosen by the case (how it was seen, whether the
 * moving is off, whether any claim was not revived), so the club's own wording of them (§247, §359)
 * never stores a date, a count or a name.
 */
export type NotRevivedLine = { kind: NotRevivedKind; name: string | null; event: string; url: string };
export type NotRevivedKind = "offer" | "familyReservation" | "invitation" | "placeHold" | "declarationHold" | "emailLink";
const NOT_REVIVED_KINDS: readonly NotRevivedKind[] = ["offer", "familyReservation", "invitation", "placeHold", "declarationHold", "emailLink"];

export type UnreachableWindowFacts = {
  startedAt: string;
  endedAt: string | null;
  source: string;
  grantedMinutes: number | null;
  maxHours: number;
  moved: number;
  notRevived: number;
  /** The claims not revived, named — filled at the send; empty in the payload itself. */
  claims: NotRevivedLine[];
};

type Lang = "ro" | "en";
type Forms = Record<"one" | "few" | "other", string>;

function at(iso: string | null, locale: Lang): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : formatDay(date, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" });
}

const MOVED: Record<Lang, Forms> = {
  ro: { one: "un termen mutat", few: "{n} termene mutate", other: "{n} de termene mutate" },
  en: { one: "one deadline moved", few: "{n} deadlines moved", other: "{n} deadlines moved" },
};
const NOT_REVIVED: Record<Lang, Forms> = {
  ro: { one: "o cerere nereluată", few: "{n} cereri nereluate", other: "{n} de cereri nereluate" },
  en: { one: "one claim not revived", few: "{n} claims not revived", other: "{n} claims not revived" },
};

/** What each claim was, in the link's label. */
const KIND_WORDS: Record<Lang, Record<NotRevivedKind, string>> = {
  ro: {
    offer: "ofertă",
    familyReservation: "rezervare de familie",
    invitation: "invitație",
    placeHold: "loc ținut pentru un formular de familie",
    declarationHold: "loc ținut pentru declarație",
    emailLink: "link de confirmare a adresei",
  },
  en: {
    offer: "offer",
    familyReservation: "family reservation",
    invitation: "invitation",
    placeHold: "place held for a family form",
    declarationHold: "place held for the declaration",
    emailLink: "address confirmation link",
  },
};

/** One claim's link label: who (when the claim has a person), the event, and what it was. */
export function notRevivedLabel(locale: Lang, line: NotRevivedLine): string {
  const what = KIND_WORDS[locale][line.kind];
  return line.name ? `${line.name} — ${line.event} (${what})` : `${line.event} (${what})`;
}

function counted(words: Record<Lang, Forms>, locale: Lang, n: number): string {
  return words[locale][countForm(n, locale)].replace("{n}", String(n));
}

/** «Site-ul nu se găsește după nume»'s bold line: since when, and the club's cap on what is given back. */
export function windowOpenedFactsLine(locale: Lang, facts: UnreachableWindowFacts): string {
  if (facts.maxHours <= 0) {
    return locale === "en"
      ? `Not found since ${at(facts.startedAt, locale)} · moving the deadlines is switched off`
      : `Negăsit din ${at(facts.startedAt, locale)} · mutarea termenelor e oprită`;
  }
  const max = hoursPhrase(locale, facts.maxHours);
  return locale === "en"
    ? `Not found since ${at(facts.startedAt, locale)} · the clock stands still for at most ${max}`
    : `Negăsit din ${at(facts.startedAt, locale)} · ceasul stă pe loc cel mult ${max}`;
}

/** The claims a window did not revive, one link each under the bold line: name, event, what it was, its backoffice page. */
export function notRevivedLinks(locale: Lang, facts: UnreachableWindowFacts): { label: string; url: string }[] {
  return facts.claims.map((line) => ({ label: notRevivedLabel(locale, line), url: line.url }));
}

/** «Ceasul termenelor a stat pe loc»'s bold line: from when to when, how it was seen, what was given back and the counts. */
export function windowClosedFactsLine(locale: Lang, facts: UnreachableWindowFacts): string {
  const granted = minutesPhrase(locale, facts.grantedMinutes ?? 0);
  const seen =
    facts.source === "pings"
      ? locale === "en"
        ? "no scheduled call"
        : "nicio verificare programată"
      : locale === "en"
        ? "the name not found"
        : "numele negăsit";
  const parts = [
    `${at(facts.startedAt, locale)} – ${at(facts.endedAt, locale)} (${seen})`,
    locale === "en" ? `given back ${granted}` : `dat înapoi ${granted}`,
    counted(MOVED, locale, facts.moved),
    ...(facts.notRevived > 0 ? [counted(NOT_REVIVED, locale, facts.notRevived)] : []),
  ];
  return parts.join(" · ");
}

export function windowOpenedBody(locale: Lang, facts?: UnreachableWindowFacts): string[] {
  const off = (facts?.maxHours ?? 1) <= 0;
  if (locale === "en") {
    return [
      "The site's name no longer resolves: nobody can open the site, the backoffice or an email's links by it.",
      off
        ? "«Deadlines» has the moving switched off: the deadlines keep running and lapse as usual; the outage is still recorded."
        : "While it stays so nothing lapses: no address link, held place, offer, invitation or family form.",
      off
        ? "Once the name answers again, a second email says how long it lasted."
        : "Once the name answers again, the deadlines that were running move later by as long as it lasted, at most what «Deadlines» says.",
      "Check the domain at the registrar: the account, the contact verification emails, the renewal.",
    ];
  }
  return [
    "Numele site-ului nu se mai găsește: nimeni nu poate deschide site-ul, backoffice-ul sau linkurile din emailuri.",
    off
      ? "«Termene» are mutarea oprită: termenele curg și expiră ca de obicei; întreruperea se înregistrează totuși."
      : "Cât timp e așa nu expiră nimic: niciun link de confirmare, loc ținut, ofertă, invitație sau formular de familie.",
    off
      ? "Când numele răspunde din nou, un al doilea email spune cât a durat."
      : "Când numele răspunde din nou, termenele care curgeau se mută mai târziu cu cât a durat, cel mult cât spune «Termene».",
    "Verifică domeniul la registrar: contul, emailurile de verificare a datelor de contact, reînnoirea.",
  ];
}

/**
 * What an Administrator can do for each kind of claim not revived — one sentence per kind present in
 * the email, both languages, each under 200 characters — naming only the verbs that exist for the
 * state the claim is in now (§657): a lapsed offer, declaration hold or address link is an `EXPIRED`
 * registration, which no verb seats, so the person registers again (or the staff adds the registration)
 * and «Trimite-i oferta» seats them once they wait; a cleared family reservation still waits for its
 * address, which «Dă-i un loc acum» is for; an expired invitation cannot be re-sent («Retrimite» is for
 * an open one), so a new one goes to the same address; a family form's held place is nobody's yet.
 */
type RemedyGroup = "registerAgain" | "familyReservation" | "invitation" | "placeHold";
const REMEDY_GROUP: Record<NotRevivedKind, RemedyGroup> = {
  offer: "registerAgain",
  declarationHold: "registerAgain",
  emailLink: "registerAgain",
  familyReservation: "familyReservation",
  invitation: "invitation",
  placeHold: "placeHold",
};
const REMEDY_ORDER: readonly RemedyGroup[] = ["registerAgain", "familyReservation", "invitation", "placeHold"];
export const REMEDY_WORDS: Record<Lang, Record<RemedyGroup, string>> = {
  ro: {
    registerAgain:
      "Ofertă, loc pentru declarație sau link expirat: persoana se înscrie din nou (sau «Adaugă înscrierea»); cât așteaptă, «Trimite-i oferta» o așază.",
    familyReservation:
      "Rezervare de familie: adresa e încă neconfirmată, deci «Dă-i un loc acum» pe înscrierea ei o așază, cu un loc suplimentar confirmat dacă nu e niciunul liber.",
    invitation:
      "Invitație expirată: nu se mai poate retrimite; trimite una nouă la aceeași adresă din «Trimite invitații», cu un loc suplimentar confirmat dacă nu e niciunul liber.",
    placeHold: "Loc ținut pentru un formular de familie: nu e încă înscrierea nimănui; persoana completează formularul din nou.",
  },
  en: {
    registerAgain:
      "A lapsed offer, declaration hold or address link: the person registers again (or «Add the registration»); once they wait, «Send them the offer» seats them.",
    familyReservation:
      "A family reservation: the address is still unconfirmed, so «Give them a place now» on its registration seats them, with one confirmed extra place if none is free.",
    invitation:
      "An expired invitation cannot be re-sent: send a new one to the same address from «Send invitations», with one confirmed extra place if none is free.",
    placeHold: "A place held for a family form is nobody's registration yet: the person fills in the form again.",
  },
};

/** The remedy sentences for the kinds named above, in a fixed order, each once. */
export function remedyLines(locale: Lang, kinds: readonly NotRevivedKind[]): string[] {
  const present = new Set(kinds.map((kind) => REMEDY_GROUP[kind]));
  return REMEDY_ORDER.filter((group) => present.has(group)).map((group) => REMEDY_WORDS[locale][group]);
}

/**
 * «Ceasul termenelor a stat pe loc»'s paragraphs: how it was seen, what moved (or that the moving is
 * off), the claims not revived and what can re-seat each kind of them — only when there are any — and
 * what the reader should do, one fixed sentence per case (`pings` or `dns`; none left, or some).
 */
export function windowClosedBody(locale: Lang, facts?: UnreachableWindowFacts): string[] {
  const pings = facts?.source === "pings";
  const off = (facts?.maxHours ?? 1) <= 0 || (facts?.grantedMinutes ?? 1) <= 0;
  const left = (facts?.notRevived ?? 0) > 0;
  const remedies = remedyLines(locale, (facts?.claims ?? []).map((claim) => claim.kind));
  if (locale === "en") {
    return [
      pings
        ? "No scheduled call reached the platform in the stretch above for longer than the monitors allow: the site may not have been reachable."
        : "The site's name did not resolve in the stretch above: nobody could open the site, the backoffice or an email's links by it.",
      off
        ? "«Deadlines» has the moving switched off: no deadline moved. The outage is recorded on «Tasks»."
        : "The participants' deadlines that were running then moved later by the time above, at most what «Deadlines» says.",
      ...(left
        ? [
            "The claims listed above lapsed while the site could not be reached, and their place was given meanwhile or they had already ended: they were not revived.",
            "The platform seats nobody beyond the advertised places. An administrator may, with the verb that fits the claim's state now, confirmed and audited:",
            ...remedies,
          ]
        : []),
      "Nobody was emailed about it: the new deadline is on the person's own page and in each registration's history.",
      pings
        ? left
          ? "Check that the hours above look right, then decide for each person above, once they are back where a verb applies."
          : "Nothing to do, unless the hours above look wrong: then check that the monitors call the site."
        : left
          ? "Check at the registrar why the name was gone, then decide for each person above, once they are back where a verb applies."
          : "Nothing to do for the participants. Check at the registrar why the name was gone, so it does not happen again.",
    ];
  }
  return [
    pings
      ? "Nicio verificare programată nu a ajuns la platformă în intervalul de mai sus mai mult decât permit monitoarele: site-ul poate să nu fi răspuns."
      : "Numele site-ului nu se găsea în intervalul de mai sus: nimeni nu putea deschide site-ul, backoffice-ul sau linkurile din emailuri.",
    off
      ? "«Termene» are mutarea oprită: niciun termen nu s-a mutat. Întreruperea e înregistrată în «Sarcini»."
      : "Termenele participanților care curgeau atunci s-au mutat mai târziu cu timpul de mai sus, cel mult cât spune «Termene».",
    ...(left
      ? [
          "Cererile de mai sus expiraseră cât site-ul nu putea fi accesat, iar locul lor fusese dat între timp sau se încheiaseră deja: nu au fost reluate.",
          "Platforma nu așază pe nimeni peste locurile anunțate. Un administrator poate, cu verbul potrivit stării de acum a cererii, confirmat și scris în jurnal:",
          ...remedies,
        ]
      : []),
    "Participanților nu li s-a trimis nimic: termenul nou e în pagina lor și în istoricul fiecărei înscrieri.",
    pings
      ? left
        ? "Verifică dacă orele de mai sus par corecte, apoi decide pentru fiecare persoană de mai sus, când e din nou acolo unde un verb se aplică."
        : "Nimic de făcut, doar dacă orele de mai sus par greșite: atunci verifică dacă monitoarele apelează site-ul."
      : left
        ? "Verifică la registrar de ce lipsea numele, apoi decide pentru fiecare persoană de mai sus, când e din nou acolo unde un verb se aplică."
        : "Nimic de făcut pentru participanți. Verifică la registrar de ce lipsea numele, ca să nu se repete.",
  ];
}

/** The payload as the job wrote it, read leniently: a field it cannot read is the empty one. The claims are filled at the send. */
export function readUnreachableWindowFacts(payload: unknown): UnreachableWindowFacts {
  const value = (payload ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof value[key] === "string" ? (value[key] as string) : null);
  const whole = (key: string) => (typeof value[key] === "number" && Number.isInteger(value[key]) ? (value[key] as number) : null);
  return {
    startedAt: text("startedAt") ?? "",
    endedAt: text("endedAt"),
    source: text("source") ?? "dns",
    grantedMinutes: whole("grantedMinutes"),
    maxHours: whole("maxHours") ?? 0,
    moved: whole("moved") ?? 0,
    notRevived: whole("notRevived") ?? 0,
    claims: [],
  };
}

/** The claims' ids the payload carries (`registrations/outage-grace.ts`), read leniently: anything unreadable is left out. */
export function readNotRevivedRefs(payload: unknown): { kind: NotRevivedKind; id: string; eventId: string }[] {
  const claims = ((payload ?? {}) as { claims?: unknown }).claims;
  if (!Array.isArray(claims)) return [];
  return claims.flatMap((claim) => {
    const item = (claim ?? {}) as Record<string, unknown>;
    const kind = NOT_REVIVED_KINDS.find((known) => known === item.kind);
    return kind && typeof item.id === "string" && typeof item.eventId === "string" ? [{ kind, id: item.id, eventId: item.eventId }] : [];
  });
}
