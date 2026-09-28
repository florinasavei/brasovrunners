import en from "../../../../messages/en.json";
import ro from "../../../../messages/ro.json";
import { CLUB_TODO_MAX_ITEMS, type ClubTodoItem } from "./club-todo";

/**
 * The list «De făcut» starts from until the first write stores it (§438): the Administrator's and
 * the Organizer's steps, with no address and no host in them — the repository is public (AGENTS.md
 * §8). Ids are fixed so a press made before anything was stored finds its line.
 */

/** «Pentru cine» suggestions; roles, not first names — the repository is public (§483). */
export const CLUB_TODO_OWNER_SUGGESTIONS: readonly string[] = ["Administrator", "Organizator"];

const WRITTEN_AT = "2026-09-26T12:00:00.000Z";
const AFTER_THE_TENTH = "2026-10-10";
const MAILGUN_PLAN_SWITCH = "2026-11-01";

const ADMINISTRATOR: ReadonlyArray<readonly [text: string, due?: string]> = [
  ["Intră în backoffice (/ro/admin) cu contul tău. Dacă nu merge, îmi scrii."],
  [
    "Fă-ți un cont de Gmail (dacă nu ai deja), ca să îți pot da delegare pe adresa de Gmail a clubului — fără să îți dau parola. Îmi trimiți adresa.",
  ],
  ["Ai deja o invitație trimisă de mine — trebuie doar să o accepți."],
  [
    "Mailgun (emailurile platformei): ținem costurile la minim — planul plătit (Basic, 15 $) doar între 1 și 30 noiembrie, cursa fiind pe 21. Pe 1 noiembrie: plata în contul Mailgun (îți dau accesul), apoi în backoffice → Emailuri → «Planul Mailgun» alegi «Basic»; pe 30 noiembrie înapoi la «Free».",
    MAILGUN_PLAN_SWITCH,
  ],
  [
    "Textele — le citești și le aprobi: (a) descrierile evenimentelor, copiate de pe Facebook: backoffice → Evenimente → fiecare eveniment → «Rezumat» și «Descrierea evenimentului», română și engleză → «Salvează»; (b) textele legale din backoffice → Legal (termeni, nota de confidențialitate, declarațiile) — scrise cu AI, notează ce ți se pare greșit; ideal, un avocat citește paragraful de răspundere și §5 din termeni; (c) după release-ul de azi (îți scriu când e gata): aprobi cele cinci texte noi, într-o singură ședință: backoffice → Legal → «Versiune nouă» → «Pornește de la șablon» → completezi cele patru date ale clubului → «Aprobă». De cinci ori: termeni, nota de confidențialitate, declarația de cursă, declarația pentru asfalt, declarația pentru trail. Până atunci lista publică de participanți arată doar confirmații.",
  ],
  [
    "Poze pentru Happy Monday, Running Up That Hill și Crosul Aniversar: pun eu ceva acum; tu le poți înlocui oricând (backoffice → eveniment → «Rezumat» → butonul de poză din editor; la încărcare alege «Calitate: Medie»).",
  ],
  [
    "Crosul Aniversar: scrie textele (se poate și mai târziu); evenimentul e deocamdată fără locație, se completează când știm. Decidem împreună când dăm drumul la înscrieri și câte locuri.",
  ],
  ["(bonus) Refă seria Happy Monday și pe Facebook."],
  [
    "Anunță site-ul pe Facebook/Instagram: primim feedback, evenimentele recurente și Crosul Aniversar (doar data) sunt create, avem calendar (butonul «Adaugă în calendar» de pe fiecare eveniment).",
  ],
  [
    "Newsletter: abonarea e pe pagina de contact (buton → pop-up cu subiecte). Când avem abonați, scrii primul mesaj din backoffice → Emailuri → «Scrie abonaților».",
  ],
  [
    "Pagina «Echipa»: backoffice → Pagini → Echipa → pune cardurile cu noi și cu voluntarii care vor să apară (poză, nume, rol) → «Publică».",
  ],
  [
    "După 10 octombrie: voluntarii de la masă (scanează QR-ul și dau kitul) — Organizatorul îți dă numele și emailurile lor; le faci conturile din backoffice → Echipa → «Adaugă» (primesc invitația pe email).",
    AFTER_THE_TENTH,
  ],
];

const ORGANIZER: ReadonlyArray<readonly [text: string, due?: string]> = [
  ["Intră în backoffice (/ro/admin) cu contul tău → «Înscrieri». Dacă nu merge sau nu vezi lista, îmi scrii."],
  [
    "Confirmă datele evenimentelor de pe site (/ro/evenimente): zilele, orele, locurile de întâlnire, traseele — Happy Monday, Running Up That Hill, Crosul Aniversar. Ce e greșit îi spui Administratorului, care corectează în backoffice.",
  ],
  [
    "Test complet pe QA (site-ul de test, nu cel real): pe QA → /ro/evenimente → «Crosul de toamnă» → «Înscrie-te». Completează formularul cu numele și emailul tău → primești un email cu link → confirmi → semnezi declarația pe telefon → primești PDF-ul și codul QR. Apoi intră în backoffice-ul de pe QA (/ro/admin) → «Înscrieri» și verifică că apari «Confirmat».",
  ],
  [
    "Tot pe QA, testul de familie (îți scriu când e gata pe QA): trimite formularul încă o dată, de pe același email, cu numele și data de naștere ale altei persoane (de exemplu un copil). Primești un email cu lista înscrierilor tale și butonul «Confirm că înscriu altă persoană» → apeși → a doua persoană e înscrisă (maximum 4 pe același email). Dacă ceva nu merge la orice pas, fă o poză și trimite-mi-o.",
  ],
  [
    "Tot pe QA, masa de la cursă: backoffice → Evenimente → «Crosul de toamnă» → «Masa». Scanează codul QR de pe telefonul tău (sau scrie codul) → «Check-in». Încearcă și «Înscrie la fața locului» și, când îți scriu că e gata, «Numere de rezervă» (tipărești bib-uri goale cu număr, scrii numele cu markerul).",
  ],
  [
    "Descarcă numerele de concurs (bib-urile): backoffice → Evenimente → cursa → «Numere de concurs» → «Descarcă foaia» (A4, două pe pagină). Verifică că se tipăresc bine.",
  ],
  [
    "După 10 octombrie, împreună cu Administratorul: dăm drumul la înscrieri pentru Crosul Aniversar și decidem postările pe social media; îi dai Administratorului numele și emailurile voluntarilor de la masă (el le face conturile), iar tu le faci un instructaj scurt cu pașii de la punctul 5.",
    AFTER_THE_TENTH,
  ],
];

/**
 * Lines added after §438 (§538), which also reach an already-stored list: `mergeClubTodoDefaults`
 * adds each once and records it in `seenDefaults`. Words from `Admin.clubTodo.defaults.*`, stored
 * in Romanian; shown in the reader's language with a link until somebody edits them.
 */
export type ClubTodoDefaultKey = "teamPage" | "faqPage";

type AddedDefault = {
  id: string;
  key: ClubTodoDefaultKey;
  owner: string;
  /** A backoffice path, never a host (AGENTS.md §8). */
  href: "/admin/pages/team" | "/admin/pages/faq";
  /** Its `createdAt`. */
  since: string;
  /** A §438 line this replaces: dropped from a fresh list, and from a stored one while untouched. */
  replaces?: string;
};

/**
 * Superseded by `start-admin-team-page`; kept in `ADMINISTRATOR` so later ids keep their numbers
 * and the merge recognises its unedited words.
 */
const OLD_TEAM_PAGE_ID = "start-admin-11";

const ADDED_DEFAULTS: readonly AddedDefault[] = [
  {
    id: "start-admin-team-page",
    key: "teamPage",
    owner: "Administrator",
    href: "/admin/pages/team",
    since: "2026-09-28T12:00:00.000Z",
    replaces: OLD_TEAM_PAGE_ID,
  },
  { id: "start-admin-faq-page", key: "faqPage", owner: "Administrator", href: "/admin/pages/faq", since: "2026-09-28T12:00:00.000Z" },
];

const DEFAULT_WORDS: Record<"ro" | "en", Record<ClubTodoDefaultKey, { text: string; link: string }>> = {
  ro: ro.Admin.clubTodo.defaults,
  en: en.Admin.clubTodo.defaults,
};

function lines(owner: string, prefix: string, source: typeof ADMINISTRATOR, firstOrder: number): ClubTodoItem[] {
  return source.map(([text, due], index) => ({
    id: `start-${prefix}-${String(index + 1).padStart(2, "0")}`,
    text,
    owner,
    done: false,
    doneAt: null,
    by: null,
    createdAt: WRITTEN_AT,
    due: due ?? null,
    order: firstOrder + index,
  }));
}

function addedLine(entry: AddedDefault, order: number): ClubTodoItem {
  return {
    id: entry.id,
    text: DEFAULT_WORDS.ro[entry.key].text,
    owner: entry.owner,
    done: false,
    doneAt: null,
    by: null,
    createdAt: entry.since,
    due: null,
    order,
  };
}

/** §438's original nineteen lines, line 11 included — what a pre-§538 row is read against. */
export function firstClubTodo(): ClubTodoItem[] {
  const administrator = lines("Administrator", "admin", ADMINISTRATOR, 1);
  return [...administrator, ...lines("Organizator", "organizer", ORGANIZER, administrator.length + 1)];
}

const REPLACED_IDS: ReadonlySet<string> = new Set(ADDED_DEFAULTS.flatMap((entry) => (entry.replaces ? [entry.replaces] : [])));

/** The fresh list: the Administrator's lines minus replaced ones, the §538 lines, then the Organizer's. */
export function startingClubTodo(): ClubTodoItem[] {
  const administrator = lines("Administrator", "admin", ADMINISTRATOR, 1).filter((item) => !REPLACED_IDS.has(item.id));
  const added = ADDED_DEFAULTS.map((entry) => addedLine(entry, 0));
  const organizer = lines("Organizator", "organizer", ORGANIZER, 1);
  return [...administrator, ...added, ...organizer].map((item, index) => ({ ...item, order: index + 1 }));
}

/** A pre-§538 row missing one of these ids had it deleted by the club; it stays deleted. */
const FIRST_DEFAULT_IDS: readonly string[] = firstClubTodo().map((item) => item.id);

/** Every starting id, replaced ones included: a merged row's `seenDefaults`. */
export const CLUB_TODO_DEFAULT_IDS: readonly string[] = [...new Set([...FIRST_DEFAULT_IDS, ...startingClubTodo().map((item) => item.id)])];

/** A replaced §438 line is taken off only while nobody touched it: its first words, unticked. */
function untouchedFirstLine(items: readonly ClubTodoItem[], id: string): ClubTodoItem | undefined {
  const original = firstClubTodo().find((item) => item.id === id);
  if (!original) return undefined;
  return items.find((item) => item.id === id && !item.done && item.text === original.text);
}

export type ClubTodoMerge = {
  items: ClubTodoItem[];
  /** Stored by the next write. */
  seenDefaults: string[];
  added: ClubTodoItem[];
  removed: ClubTodoItem[];
};

/**
 * Appends the defaults a stored list has never seen, once each (§538); `seen` null means §438's
 * nineteen. Idempotent. At `CLUB_TODO_MAX_ITEMS` a default stays unseen until there is room. A
 * replacing default removes its old line only while that line is unticked and unedited.
 */
export function mergeClubTodoDefaults(items: readonly ClubTodoItem[], seen: readonly string[] | null): ClubTodoMerge {
  const known = new Set(seen ?? FIRST_DEFAULT_IDS);
  const present = new Set(items.map((item) => item.id));
  let highest = items.reduce((max, item) => Math.max(max, item.order), 0);
  let kept: ClubTodoItem[] = [...items];
  const added: ClubTodoItem[] = [];
  const removed: ClubTodoItem[] = [];
  const unadded = new Set<string>();
  for (const entry of ADDED_DEFAULTS) {
    if (known.has(entry.id) || present.has(entry.id)) continue;
    const replaced = entry.replaces ? untouchedFirstLine(kept, entry.replaces) : undefined;
    if (kept.length - (replaced ? 1 : 0) + added.length >= CLUB_TODO_MAX_ITEMS) {
      unadded.add(entry.id);
      continue;
    }
    if (replaced) {
      kept = kept.filter((item) => item !== replaced);
      removed.push(replaced);
    }
    highest += 1;
    added.push(addedLine(entry, highest));
  }
  const seenDefaults = [...new Set([...known, ...CLUB_TODO_DEFAULT_IDS])].filter((id) => !unadded.has(id));
  return { items: [...kept, ...added], seenDefaults, added, removed };
}

/** A §538 default in the reader's language with its editor link; null for other or edited lines. */
export function clubTodoDefaultView(
  item: Pick<ClubTodoItem, "id" | "text">,
  locale: string,
): { text: string; link: string; href: AddedDefault["href"] } | null {
  const entry = ADDED_DEFAULTS.find((candidate) => candidate.id === item.id);
  if (!entry || item.text !== DEFAULT_WORDS.ro[entry.key].text) return null;
  const words = DEFAULT_WORDS[locale === "en" ? "en" : "ro"][entry.key];
  return { text: words.text, link: words.link, href: entry.href };
}
