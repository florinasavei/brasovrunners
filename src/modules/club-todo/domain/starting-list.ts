import en from "../../../../messages/en.json";
import ro from "../../../../messages/ro.json";
import { CLUB_TODO_MAX_ITEMS, type ClubTodoItem } from "./club-todo";

/**
 * The list «De făcut» starts from, until somebody first changes it (§438).
 *
 * The owner's two messages of 2026-09-26 to the two people who run the club while he is away —
 * the Administrator's twelve steps and the Organizer's seven — in their order, each line as he
 * wrote it, with two things taken out because this repository is public: **no address** (the
 * club's Gmail is «adresa de Gmail a clubului») and **no URL** (a page is named by its path in the
 * backoffice, `/ro/admin`, never by its host — AGENTS.md §8). The lines that say "after 10
 * October" carry that day as their due date, and the Mailgun-plan line carries the date the
 * owner named for the switch to the paid plan.
 *
 * Read only while the `clubTodo` row does not exist: the first write stores this list with the
 * change on it, and from then on the row is the list — a deleted starting line never comes back.
 * The ids are fixed so a tick on a line of this list, pressed before anything was stored, finds
 * the same line in the list the write starts from.
 */

/**
 * What «pentru cine» offers before anybody types one; any other name is kept as typed. Roles, not
 * first names: the repository is public (§483), and a list is the Administrator's or the Organizer's
 * whoever holds the role this year.
 */
export const CLUB_TODO_OWNER_SUGGESTIONS: readonly string[] = ["Administrator", "Organizator"];

/** When the lists were written: the `createdAt` of every starting line. */
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
 * The lines added to the starting list after it was first written (§NNN, amending §438) — the
 * owner, 2026-09-28: «actualizează lista de TODOs pentru Administrator să facă pagina de Echipa și
 * Întrebări frecvente». Unlike the nineteen above, each one reaches a club whose list is already
 * stored: `mergeClubTodoDefaults` adds it once, by its id, and the row remembers that it did
 * (`seenDefaults`), so a line the club ticked stays ticked and a line it deleted stays deleted.
 *
 * The words are the catalogue's (`Admin.clubTodo.defaults.*`, both languages, held by the plain-words
 * test), and the stored `text` is the Romanian — the list's own language (§438). While the line
 * still says those words, the panel shows the reader's language and a link to the editor; once
 * somebody edits it, it is the club's line like any other.
 */
export type ClubTodoDefaultKey = "teamPage" | "faqPage";

type AddedDefault = {
  id: string;
  key: ClubTodoDefaultKey;
  owner: string;
  /** The editor the line sends the reader to — a backoffice path, never a host (AGENTS.md §8). */
  href: "/admin/pages/team" | "/admin/pages/faq";
  /** When the line was written: its `createdAt`. */
  since: string;
  /**
   * The §438 line this one replaces, if any: gone from the fresh pre-fill, and taken off a stored
   * list when this line arrives — only while it still says §438's words and is unticked.
   */
  replaces?: string;
};

/**
 * §438's line 11 («Pagina «Echipa»: … → «Publică»») says what `start-admin-team-page` says, with
 * the old button words. It stays in `ADMINISTRATOR`, so the ids after it keep their number and the
 * merge can recognise its unedited words, but a fresh list no longer starts with it.
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

/**
 * §438's pre-fill as it was first written: the nineteen lines a list stored before §NNN started
 * from, line 11 included — what the merge and its tests read a stored row against.
 */
export function firstClubTodo(): ClubTodoItem[] {
  const administrator = lines("Administrator", "admin", ADMINISTRATOR, 1);
  return [...administrator, ...lines("Organizator", "organizer", ORGANIZER, administrator.length + 1)];
}

const REPLACED_IDS: ReadonlySet<string> = new Set(ADDED_DEFAULTS.flatMap((entry) => (entry.replaces ? [entry.replaces] : [])));

/**
 * The twenty starting lines: the Administrator's eleven (§438's twelve without line 11, which the
 * team-page line replaces) and the two pages (§NNN), then the Organizer's seven — every id and
 * every word of the lines kept unchanged.
 */
export function startingClubTodo(): ClubTodoItem[] {
  const administrator = lines("Administrator", "admin", ADMINISTRATOR, 1).filter((item) => !REPLACED_IDS.has(item.id));
  const added = ADDED_DEFAULTS.map((entry) => addedLine(entry, 0));
  const organizer = lines("Organizator", "organizer", ORGANIZER, 1);
  return [...administrator, ...added, ...organizer].map((item, index) => ({ ...item, order: index + 1 }));
}

/**
 * What §438's pre-fill gave a stored list: the nineteen ids. One of them missing from a row written
 * before §NNN was deleted by the club, and stays deleted; only the lines added since are new to it.
 */
const FIRST_DEFAULT_IDS: readonly string[] = firstClubTodo().map((item) => item.id);

/**
 * Every starting line's id, the replaced line 11 included: what a stored row has seen once
 * `mergeClubTodoDefaults` has run on it, so a replaced line is never given to it again.
 */
export const CLUB_TODO_DEFAULT_IDS: readonly string[] = [...new Set([...FIRST_DEFAULT_IDS, ...startingClubTodo().map((item) => item.id)])];

/** A replaced §438 line is taken off only while nobody touched it: its first words, unticked. */
function untouchedFirstLine(items: readonly ClubTodoItem[], id: string): ClubTodoItem | undefined {
  const original = firstClubTodo().find((item) => item.id === id);
  if (!original) return undefined;
  return items.find((item) => item.id === id && !item.done && item.text === original.text);
}

export type ClubTodoMerge = {
  items: ClubTodoItem[];
  /** Every default id the row has now seen — what the next write stores beside the items. */
  seenDefaults: string[];
  /** The lines this merge added: none on a list that already has them, or had and lost them. */
  added: ClubTodoItem[];
  /** The §438 lines this merge took off because a line that replaces them arrived, untouched. */
  removed: ClubTodoItem[];
};

/**
 * A stored list with the defaults it has never seen added at its end, once each (§NNN). `seen` is
 * the row's `seenDefaults`, or null for a row written before it existed (read as §438's nineteen).
 * Idempotent: a line already on the list, or seen and since deleted, is never added again.
 * A list at `CLUB_TODO_MAX_ITEMS` gets nothing more (the cap the add operation holds), and a
 * default it could not take stays unseen, so it arrives once the club makes room. A default that
 * replaces a §438 line takes that line off as it arrives, only while the line is unticked and says
 * §438's words — so the two never stand side by side, and the club's own edit or tick is kept.
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
    // The line it replaces leaves as it arrives — an edited or ticked copy is the club's and stays.
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

/**
 * A default line as the reader sees it: its words in their language and the editor it opens —
 * or null for any other line, and for a default the club has edited (it is then the club's words).
 */
export function clubTodoDefaultView(
  item: Pick<ClubTodoItem, "id" | "text">,
  locale: string,
): { text: string; link: string; href: AddedDefault["href"] } | null {
  const entry = ADDED_DEFAULTS.find((candidate) => candidate.id === item.id);
  if (!entry || item.text !== DEFAULT_WORDS.ro[entry.key].text) return null;
  const words = DEFAULT_WORDS[locale === "en" ? "en" : "ro"][entry.key];
  return { text: words.text, link: words.link, href: entry.href };
}
