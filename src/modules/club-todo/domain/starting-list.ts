import type { ClubTodoItem } from "./club-todo";

/**
 * The list «De făcut» starts from, until somebody first changes it (§NNN).
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

/** The names «pentru cine» offers before anybody types one; any other name is kept as typed. */
export const CLUB_TODO_OWNER_SUGGESTIONS: readonly string[] = ["Amalia", "Dani", "Florin"];

/** When the lists were written: the `createdAt` of every starting line. */
const WRITTEN_AT = "2026-09-26T12:00:00.000Z";
const AFTER_THE_TENTH = "2026-10-10";
const MAILGUN_PLAN_SWITCH = "2026-11-01";

const AMALIA: ReadonlyArray<readonly [text: string, due?: string]> = [
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
    "Textele — le citești și le aprobi: (a) descrierile evenimentelor, copiate de pe Facebook: backoffice → Evenimente → fiecare eveniment → «Rezumat» și «Descrierea evenimentului», română și engleză → «Salvează»; (b) textele legale din backoffice → Legal (termeni, nota de confidențialitate, declarațiile) — scrise cu AI, notează ce ți se pare greșit; ideal, un avocat citește paragraful de răspundere și §5 din termeni; (c) după release-ul de azi (îți scriu când e gata): aprobi cele cinci texte noi, într-o singură ședință: backoffice → Legal → «Versiune nouă» → «pornește de la textul platformei» → completezi cele patru date ale clubului → «Aprobă». De cinci ori: termeni, nota de confidențialitate, declarația de cursă, declarația pentru asfalt, declarația pentru trail. Până atunci lista publică de participanți arată doar confirmații.",
  ],
  [
    "Poze pentru Happy Monday, Running Up That Hill și Crosul Aniversar: pun eu ceva acum; tu le poți înlocui oricând (backoffice → eveniment → «Rezumat» → butonul de poză din editor; la încărcare alege «Calitate: Normală»).",
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
    "După 10 octombrie: voluntarii de la masă (scanează QR-ul și dau kitul) — Dani îți dă numele și emailurile lor; le faci conturile din backoffice → Echipa → «Adaugă» (primesc invitația pe email).",
    AFTER_THE_TENTH,
  ],
];

const DANI: ReadonlyArray<readonly [text: string, due?: string]> = [
  ["Intră în backoffice (/ro/admin) cu contul tău → «Înscrieri». Dacă nu merge sau nu vezi lista, îmi scrii."],
  [
    "Confirmă datele evenimentelor de pe site (/ro/evenimente): zilele, orele, locurile de întâlnire, traseele — Happy Monday, Running Up That Hill, Crosul Aniversar. Ce e greșit îi spui Amaliei, ea corectează în backoffice.",
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
    "După 10 octombrie, împreună cu Amalia: dăm drumul la înscrieri pentru Crosul Aniversar și decidem postările pe social media; îi dai Amaliei numele și emailurile voluntarilor de la masă (ea le face conturile), iar tu le faci un instructaj scurt cu pașii de la punctul 5.",
    AFTER_THE_TENTH,
  ],
];

function lines(owner: string, prefix: string, source: typeof AMALIA, firstOrder: number): ClubTodoItem[] {
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

/** The nineteen starting lines: the Administrator's twelve, then the Organizer's seven. */
export function startingClubTodo(): ClubTodoItem[] {
  return [...lines("Amalia", "amalia", AMALIA, 1), ...lines("Dani", "dani", DANI, AMALIA.length + 1)];
}
