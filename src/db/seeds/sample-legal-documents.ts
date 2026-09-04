import { getDb } from "@/db/client";
import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import {
  computeContentHash,
  type LegalDocumentBody,
  type LegalDocumentTranslationInput,
} from "@/modules/legal-documents/domain/content-hash";
import { findLatestVersion, insertLegalDocumentVersion } from "@/modules/legal-documents/repository";

/**
 * Sample privacy notice, terms and event declaration — complete in structure, blank in
 * substance (`DECISIONS.md` §29, superseding §27).
 *
 * §27 seeded a two-sentence PLACEHOLDER in local and test only, and refused every other
 * environment outright. That was the right rule for the machinery; it is the wrong rule for a
 * QA system nobody can register on, because registration correctly refuses when no approved
 * privacy notice exists (BR-REQ-053-01) and so the whole participant journey was unreachable
 * anywhere a colleague could look at it. **Production stays refused, hard**, and
 * `tests/integration/legal/versions.test.ts` is the test of that refusal.
 *
 * Three rules govern the text below, and they are the reason this file is long:
 *
 *   1. **Every document opens with a banner in its own rendered body, in both languages**,
 *      saying that this is sample text, not approved by the club, not legal advice, and that it
 *      must be replaced before a real participant registers. In the body, not a code comment and
 *      not a column nobody renders: the public page is where somebody has to be able to see it.
 *   2. **Complete in structure, blank in substance.** Every section such a document normally
 *      carries is here; every club-specific fact is an obvious `<ANGLE BRACKET>` placeholder
 *      rather than a plausible invention. AGENTS.md §1.2 forbids inventing legal wording, and a
 *      well-formed invention is far more dangerous than a visible gap — a lawyer edits a
 *      concrete draft in an afternoon and never notices a fabricated retention period.
 *   3. **The privacy notice describes what this application actually does**, read from the
 *      schema rather than guessed: `participants` holds a delivery email, a normalized and a
 *      canonical form of it and a name; `registrations` holds the lifecycle and its timestamps,
 *      the acknowledged privacy-notice version and the results-name consent;
 *      `declaration_acceptances` holds a typed name, a version and a hash; `email_outbox` holds
 *      the queued messages. Nothing else about a person exists, and §12.13 keeps it that way.
 *
 * Each language is written as its own complete text rather than translated sentence by sentence,
 * and both are marked as drafts awaiting one named reviewer.
 */

const SAMPLE_BANNER_RO = [
  "TEXT DE EXEMPLU. Acest document NU a fost aprobat de Brașov Runners, nu este consultanță juridică și nu produce efecte juridice.",
  "Există pentru ca fluxul de înscriere să poată fi construit, verificat și arătat clubului. Structura este completă; fiecare fapt care ține de club este lăsat între paranteze unghiulare — <AȘA> — pentru a fi completat de club sau de consilierul său juridic.",
  "Trebuie înlocuit cu textul aprobat înainte ca un participant real să se înscrie.",
];

const SAMPLE_BANNER_EN = [
  "SAMPLE TEXT. This document has NOT been approved by Brașov Runners, is not legal advice, and has no legal effect.",
  "It exists so the registration flow can be built, checked and shown to the club. The structure is complete; every club-specific fact is left in angle brackets — <LIKE THIS> — to be filled in by the club or its legal adviser.",
  "It must be replaced with the approved text before any real participant registers.",
];

const REVIEW_NOTE_RO = [
  "Stare: proiect. Un singur recenzent desemnat: <NUME RECENZENT>, <ROL>. Data recenziei: <DATA>.",
  "Versiunea aprobată se introduce printr-o migrare, conform docs/RUNBOOKS.md § Legal document version. Nicio interfață din platformă nu editează acest text.",
];

const REVIEW_NOTE_EN = [
  "Status: draft. One named reviewer: <REVIEWER NAME>, <ROLE>. Review date: <DATE>.",
  "The approved version is introduced through a migration, per docs/RUNBOOKS.md § Legal document version. No interface in the platform edits this text.",
];

const privacyNoticeRo: LegalDocumentBody = {
  sections: [
    { heading: "TEXT DE EXEMPLU — NEAPROBAT", paragraphs: SAMPLE_BANNER_RO },
    {
      heading: "1. Cine este operatorul",
      paragraphs: [
        "Operatorul datelor este <DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI>, cu sediul în <ADRESA COMPLETĂ>, înregistrat cu <FORMA JURIDICĂ ȘI NUMĂRUL DE ÎNREGISTRARE>.",
        "Reprezentant pentru protecția datelor: <NUME / „nu a fost desemnat un responsabil cu protecția datelor”>. Date de contact: <CONTACT>.",
      ],
    },
    {
      heading: "2. Ce date colectăm și de ce",
      paragraphs: [
        "Când te înscrii la un eveniment, platforma păstrează numele pe care îl scrii, adresa de e-mail și limba în care ai completat formularul. Nu există parolă și nu se creează niciun cont: adresa de e-mail este singura identitate.",
        "Scopul este organizarea evenimentului: să știm cine participă, să îți trimitem confirmarea și să gestionăm locurile și lista de așteptare.",
        "Temeiul legal pentru acest scop: <TEMEI LEGAL — de exemplu executarea unui contract sau interesul legitim; a se completa de club>.",
      ],
    },
    {
      heading: "3. Identitatea canonică a adresei de e-mail",
      paragraphs: [
        "Pe lângă adresa pe care o scrii, platforma păstrează două forme derivate ale ei: una normalizată (scrisă cu litere mici) și una canonică. Forma canonică există pentru un singur motiv: să recunoască aceeași persoană care se înscrie de două ori la același eveniment scriind adresa ușor diferit.",
        "Pentru adresele Gmail, forma canonică ignoră punctele și eticheta de după semnul plus, deoarece toate ajung în aceeași căsuță poștală. Nu este folosită pentru a trimite mesaje — mesajele merg la adresa exact așa cum ai scris-o.",
        "Temeiul legal: <TEMEI LEGAL>.",
      ],
    },
    {
      heading: "4. Consimțământul pentru publicarea numelui în rezultate",
      paragraphs: [
        "Formularul de înscriere are o căsuță separată prin care poți fi de acord ca numele tău să apară în rezultatele publice. Este opțională, iar înscrierea este valabilă și dacă nu o bifezi.",
        "Temeiul legal este consimțământul. Îl poți retrage oricând, scriind la <CONTACT>; retragerea nu afectează publicările făcute înainte de retragere.",
        "Platforma păstrează atât răspunsul tău, cât și versiunea notei de confidențialitate în vigoare atunci, ca să se poată ști exact la ce ai consimțit.",
      ],
    },
    {
      heading: "5. Ciclul de viață al înscrierii",
      paragraphs: [
        "O înscriere trece prin stări: în așteptarea confirmării adresei de e-mail, în așteptarea declarației, pe lista de așteptare, cu loc oferit, confirmată, anulată sau expirată.",
        "Platforma păstrează momentul fiecărei schimbări: când ai trimis formularul, când ai confirmat adresa, când ai intrat pe lista de așteptare, când ți s-a oferit un loc, când expiră rezervarea, când s-a confirmat, când s-a anulat și de către cine, când a expirat și din ce motiv.",
        "Aceste momente sunt fapte istorice: rămân înregistrate și după ce înscrierea se încheie, pentru că fără ele nu se poate explica de ce a primit cineva un loc și altcineva nu.",
      ],
    },
    {
      heading: "6. Declarația pe proprie răspundere",
      paragraphs: [
        "Pentru evenimentele cu înscriere prin această platformă, confirmarea presupune acceptarea unei declarații. Se păstrează: numele scris de tine ca semnătură, versiunea declarației acceptate, o amprentă criptografică (SHA-256) a textului exact și momentul acceptării.",
        "Nu se păstrează date medicale, contacte de urgență sau date despre minori. Platforma nu are astfel de câmpuri.",
        "Acceptarea nu este o semnătură electronică calificată.",
      ],
    },
    {
      heading: "7. E-mailurile tranzacționale",
      paragraphs: [
        "Platforma trimite doar mesaje legate de înscrierea ta: confirmarea adresei, invitația de a semna declarația, confirmarea locului, oferta de pe lista de așteptare, anularea și expirarea.",
        "Nu trimitem mesaje de marketing prin această platformă.",
        "Pentru fiecare mesaj se păstrează tipul, limba, adresa de destinație, starea trimiterii și momentele legate de ea. Conținutul mesajului și legăturile din el nu sunt stocate.",
      ],
    },
    {
      heading: "8. Cine mai prelucrează datele",
      paragraphs: [
        "Platforma folosește furnizori care prelucrează datele în numele clubului, în calitate de persoane împuternicite:",
        "Găzduirea bazei de date: <FURNIZOR>, regiune <REGIUNE>.",
        "Găzduirea aplicației: <FURNIZOR>, regiune <REGIUNE>.",
        "Trimiterea e-mailurilor: <FURNIZOR>.",
        "Identitatea membrilor echipei clubului (nu a participanților): <FURNIZOR>.",
        "Nu vindem datele și nu le transmitem nimănui în alt scop decât cele descrise aici.",
      ],
    },
    {
      heading: "9. Transferuri în afara Spațiului Economic European",
      paragraphs: [
        "<A se completa de club: dacă vreunul dintre furnizorii de mai sus prelucrează datele în afara SEE, se indică țara și mecanismul de transfer — de exemplu clauzele contractuale standard.>",
      ],
    },
    {
      heading: "10. Cât timp păstrăm datele",
      paragraphs: [
        "Înscrierile și dovezile de acceptare a declarației: <PERIOADĂ DE PĂSTRARE>.",
        "Datele participantului (nume, adresă de e-mail): <PERIOADĂ DE PĂSTRARE>.",
        "Evidența e-mailurilor trimise: <PERIOADĂ DE PĂSTRARE>.",
        "<Fiecare perioadă trebuie stabilită de club; nu au fost inventate valori aici.>",
      ],
    },
    {
      heading: "11. Drepturile tale",
      paragraphs: [
        "Ai dreptul de acces la datele tale, dreptul la rectificare, dreptul la ștergere, dreptul la restricționarea prelucrării, dreptul la portabilitatea datelor și dreptul de a te opune prelucrării întemeiate pe interesul legitim.",
        "Când prelucrarea se bazează pe consimțământ, ai dreptul de a-l retrage oricând, fără ca acest lucru să afecteze legalitatea prelucrării făcute înainte de retragere.",
        "Îți exerciți aceste drepturi scriind la <CONTACT>. Răspundem în termen de o lună de la primirea cererii.",
        "Adresa de e-mail verificată nu poate fi schimbată în platformă și două înscrieri nu pot fi unite: o adresă greșită se rezolvă anulând înscrierea și reluând procesul cu adresa corectă.",
      ],
    },
    {
      heading: "12. Plângeri",
      paragraphs: [
        "Dacă nu ești mulțumit de felul în care îți sunt prelucrate datele, poți depune o plângere la Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal. Date de contact ale autorității: <CONTACT AUTORITATE>.",
      ],
    },
    {
      heading: "13. Cookie-uri și date tehnice",
      paragraphs: [
        "<A se completa de club, după verificarea a ceea ce folosește efectiv site-ul la momentul aprobării.> Platforma folosește un cookie pentru limba aleasă și un cookie de sesiune pentru membrii echipei clubului care se autentifică. Participanții nu se autentifică și nu primesc cont.",
        "Platforma nu stochează adresa IP și nici agentul de utilizator odată cu acceptarea declarației.",
      ],
    },
    {
      heading: "14. Modificări ale acestei note",
      paragraphs: [
        "Fiecare versiune a acestei note are un număr, o dată de intrare în vigoare și o amprentă a conținutului. O înscriere reține versiunea pe care ai confirmat-o, iar versiunile anterioare rămân disponibile pentru înscrierile care le referă.",
      ],
    },
    { heading: "15. Contact", paragraphs: ["<CONTACT>"] },
    { heading: "Stare și recenzie", paragraphs: REVIEW_NOTE_RO },
  ],
};

const privacyNoticeEn: LegalDocumentBody = {
  sections: [
    { heading: "SAMPLE TEXT — NOT APPROVED", paragraphs: SAMPLE_BANNER_EN },
    {
      heading: "1. Who the controller is",
      paragraphs: [
        "The data controller is <THE CLUB'S FULL LEGAL NAME>, of <FULL ADDRESS>, registered as <LEGAL FORM AND REGISTRATION NUMBER>.",
        "Data protection representative: <NAME / \"no data protection officer has been appointed\">. Contact: <CONTACT>.",
      ],
    },
    {
      heading: "2. What we collect, and why",
      paragraphs: [
        "When you register for an event, the platform keeps the name you type, your email address, and the language you filled the form in. There is no password and no account is created: your email address is the only identity.",
        "The purpose is running the event: knowing who is taking part, sending you your confirmation, and managing places and the waiting list.",
        "Lawful basis for this purpose: <LAWFUL BASIS — for example performance of a contract, or legitimate interests; to be completed by the club>.",
      ],
    },
    {
      heading: "3. The canonical form of your email address",
      paragraphs: [
        "Alongside the address you type, the platform keeps two derived forms of it: a normalized one (lower-cased) and a canonical one. The canonical form exists for one reason: to recognise the same person registering twice for the same event having typed their address slightly differently.",
        "For Gmail addresses, the canonical form ignores dots and anything after a plus sign, because they all arrive in the same mailbox. It is never used to send anything — mail goes to the address exactly as you typed it.",
        "Lawful basis: <LAWFUL BASIS>.",
      ],
    },
    {
      heading: "4. Consent to publishing your name in results",
      paragraphs: [
        "The registration form has a separate tick box through which you may agree to your name appearing in public results. It is optional, and your registration is valid whether or not you tick it.",
        "The lawful basis is consent. You may withdraw it at any time by writing to <CONTACT>; withdrawal does not affect anything published before you withdrew.",
        "The platform keeps both your answer and the version of this notice that was in force at the time, so that what you consented to is exactly recorded.",
      ],
    },
    {
      heading: "5. The registration lifecycle",
      paragraphs: [
        "A registration moves through states: waiting on email confirmation, waiting on the declaration, on the waiting list, holding an offered place, confirmed, cancelled, or expired.",
        "The platform keeps the moment of each change: when you submitted the form, when you confirmed your address, when you joined the waiting list, when a place was offered to you, when that hold expires, when it was confirmed, when it was cancelled and by whom, and when it expired and for what reason.",
        "These moments are historical facts: they remain recorded after a registration ends, because without them there is no way to explain why one person got a place and another did not.",
      ],
    },
    {
      heading: "6. The event declaration",
      paragraphs: [
        "For events registered through this platform, confirmation requires accepting a declaration. What is kept is: the name you type as your signature, the version of the declaration you accepted, a cryptographic fingerprint (SHA-256) of the exact text, and the moment you accepted it.",
        "No medical information, emergency contact, or information about minors is kept. The platform has no such fields.",
        "The acceptance is not a qualified electronic signature.",
      ],
    },
    {
      heading: "7. Transactional email",
      paragraphs: [
        "The platform sends only messages about your own registration: confirming your address, asking you to sign the declaration, confirming your place, offering a place from the waiting list, cancellation, and expiry.",
        "No marketing is sent through this platform.",
        "For each message, the platform keeps the type, the language, the destination address, the delivery state and the moments attached to it. The body of the message and the links inside it are not stored.",
      ],
    },
    {
      heading: "8. Who else processes the data",
      paragraphs: [
        "The platform relies on providers who process the data on the club's behalf, as processors:",
        "Database hosting: <PROVIDER>, region <REGION>.",
        "Application hosting: <PROVIDER>, region <REGION>.",
        "Email delivery: <PROVIDER>.",
        "Identity for the club's own staff (not for participants): <PROVIDER>.",
        "We do not sell the data and do not pass it to anyone for any purpose other than those described here.",
      ],
    },
    {
      heading: "9. Transfers outside the European Economic Area",
      paragraphs: [
        "<To be completed by the club: where any provider above processes data outside the EEA, name the country and the transfer mechanism — for example standard contractual clauses.>",
      ],
    },
    {
      heading: "10. How long we keep it",
      paragraphs: [
        "Registrations and declaration acceptance records: <RETENTION PERIOD>.",
        "Participant details (name, email address): <RETENTION PERIOD>.",
        "The record of emails sent: <RETENTION PERIOD>.",
        "<Each period must be decided by the club; none has been invented here.>",
      ],
    },
    {
      heading: "11. Your rights",
      paragraphs: [
        "You have the right of access to your data, the right to rectification, the right to erasure, the right to restrict processing, the right to data portability, and the right to object to processing based on legitimate interests.",
        "Where processing is based on consent, you may withdraw it at any time, without affecting the lawfulness of processing carried out before you withdrew.",
        "You exercise these rights by writing to <CONTACT>. We reply within one month of receiving your request.",
        "A verified email address cannot be changed in the platform and two registrations cannot be merged: a mistyped address is handled by cancelling the registration and starting again with the correct one.",
      ],
    },
    {
      heading: "12. Complaints",
      paragraphs: [
        "If you are unhappy with how your data is handled, you may complain to the Romanian National Supervisory Authority for Personal Data Processing. Authority contact details: <AUTHORITY CONTACT>.",
      ],
    },
    {
      heading: "13. Cookies and technical data",
      paragraphs: [
        "<To be completed by the club, after checking what the site actually uses at the moment of approval.> The platform uses a cookie for the language you chose, and a session cookie for members of the club's staff who sign in. Participants do not sign in and get no account.",
        "The platform does not store an IP address or a user agent alongside a declaration acceptance.",
      ],
    },
    {
      heading: "14. Changes to this notice",
      paragraphs: [
        "Every version of this notice carries a number, an effective date, and a fingerprint of its content. A registration records the version you acknowledged, and earlier versions remain available for the registrations that reference them.",
      ],
    },
    { heading: "15. Contact", paragraphs: ["<CONTACT>"] },
    { heading: "Status and review", paragraphs: REVIEW_NOTE_EN },
  ],
};

const termsRo: LegalDocumentBody = {
  sections: [
    { heading: "TEXT DE EXEMPLU — NEAPROBAT", paragraphs: SAMPLE_BANNER_RO },
    {
      heading: "1. Între cine se încheie acești termeni",
      paragraphs: [
        "Acești termeni se aplică între <DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI>, cu sediul în <ADRESA COMPLETĂ>, și orice persoană care folosește acest site sau se înscrie printr-un formular de pe el.",
      ],
    },
    {
      heading: "2. Ce oferă site-ul",
      paragraphs: [
        "Site-ul publică evenimentele clubului și, pentru unele dintre ele, permite înscrierea online. Participarea la evenimentele clubului este gratuită, dacă nu se prevede altfel pe pagina evenimentului.",
      ],
    },
    {
      heading: "3. Înscrierea",
      paragraphs: [
        "Înscrierea nu presupune crearea unui cont și nu presupune o parolă. Confirmi adresa de e-mail printr-o legătură trimisă pe aceasta, apoi accepți declarația pe proprie răspundere; abia atunci înscrierea este confirmată.",
        "Locurile sunt limitate acolo unde pagina evenimentului o spune. Când nu mai sunt locuri, intri pe lista de așteptare, în ordinea în care ai intrat pe ea.",
        "O rezervare temporară expiră dacă declarația nu este semnată în intervalul indicat, iar locul revine primei persoane de pe lista de așteptare.",
      ],
    },
    {
      heading: "4. Anularea",
      paragraphs: [
        "Îți poți anula înscrierea oricând înainte de începerea evenimentului, folosind legătura din e-mailul primit. Locul este eliberat imediat.",
        "Clubul poate anula sau modifica un eveniment. În acest caz, anunță participanții înscriși la adresa de e-mail folosită la înscriere.",
      ],
    },
    {
      heading: "5. Reguli de participare",
      paragraphs: [
        "Participanții respectă regulile evenimentului, indicațiile organizatorilor și ale voluntarilor de traseu, precum și regulile de circulație acolo unde traseul folosește drumuri publice.",
        "<A se completa de club: eventuale reguli specifice — echipament obligatoriu, vârstă minimă, participarea minorilor însoțiți, animale de companie, cască pentru bicicletă de însoțire.>",
      ],
    },
    {
      heading: "6. Răspundere",
      paragraphs: [
        "<A se completa de club, împreună cu consilierul juridic. Această secțiune este cea care are cel mai mare efect juridic și nu a fost redactată aici.>",
        "Nimic din acești termeni nu limitează răspunderea care nu poate fi limitată potrivit legii.",
      ],
    },
    {
      heading: "7. Conținutul site-ului",
      paragraphs: [
        "Textele, fotografiile și traseele publicate aparțin clubului sau sunt folosite cu acordul autorilor. Le poți citi și distribui legături către ele; reproducerea în alt scop necesită acordul clubului.",
      ],
    },
    {
      heading: "8. Folosirea corectă a platformei",
      paragraphs: [
        "Nu trimite înscrieri automate, nu încerca să treci peste limitele de trimitere și nu folosi adresa altcuiva.",
        "Clubul poate anula o înscriere care încalcă această secțiune.",
      ],
    },
    {
      heading: "9. Datele cu caracter personal",
      paragraphs: [
        "Modul în care sunt prelucrate datele este descris în nota de confidențialitate, disponibilă pe acest site.",
      ],
    },
    {
      heading: "10. Modificarea termenilor",
      paragraphs: [
        "Fiecare versiune a acestor termeni are un număr și o dată de intrare în vigoare. Versiunea în vigoare la momentul înscrierii este cea care se aplică acelei înscrieri.",
      ],
    },
    {
      heading: "11. Legea aplicabilă și instanțele competente",
      paragraphs: ["<LEGEA APLICABILĂ>", "<INSTANȚELE COMPETENTE>"],
    },
    { heading: "12. Contact", paragraphs: ["<CONTACT>"] },
    { heading: "Stare și recenzie", paragraphs: REVIEW_NOTE_RO },
  ],
};

const termsEn: LegalDocumentBody = {
  sections: [
    { heading: "SAMPLE TEXT — NOT APPROVED", paragraphs: SAMPLE_BANNER_EN },
    {
      heading: "1. Who these terms are between",
      paragraphs: [
        "These terms apply between <THE CLUB'S FULL LEGAL NAME>, of <FULL ADDRESS>, and anyone who uses this site or registers through a form on it.",
      ],
    },
    {
      heading: "2. What the site offers",
      paragraphs: [
        "The site publishes the club's events and, for some of them, lets you register online. Taking part in the club's events is free unless the event page says otherwise.",
      ],
    },
    {
      heading: "3. Registering",
      paragraphs: [
        "Registering creates no account and needs no password. You confirm your email address through a link sent to it, then accept the event declaration; only then is your registration confirmed.",
        "Places are limited where the event page says so. When there are none left you join the waiting list, in the order you joined it.",
        "A temporary hold expires if the declaration is not signed within the stated window, and the place goes to the first person on the waiting list.",
      ],
    },
    {
      heading: "4. Cancelling",
      paragraphs: [
        "You may cancel your registration at any time before the event starts, using the link in the email you received. The place is released immediately.",
        "The club may cancel or change an event. If it does, it tells registered participants at the email address they registered with.",
      ],
    },
    {
      heading: "5. Rules for taking part",
      paragraphs: [
        "Participants follow the event's rules, the instructions of the organisers and the marshals, and the rules of the road wherever the course uses public roads.",
        "<To be completed by the club: any specific rules — required kit, minimum age, accompanied minors, dogs, helmets for accompanying cyclists.>",
      ],
    },
    {
      heading: "6. Liability",
      paragraphs: [
        "<To be completed by the club with its legal adviser. This is the section with the greatest legal effect and it has deliberately not been drafted here.>",
        "Nothing in these terms limits liability that cannot be limited by law.",
      ],
    },
    {
      heading: "7. The site's content",
      paragraphs: [
        "The text, photographs and routes published here belong to the club or are used with their authors' permission. You may read them and link to them; reproducing them for another purpose needs the club's permission.",
      ],
    },
    {
      heading: "8. Fair use of the platform",
      paragraphs: [
        "Do not submit registrations automatically, do not try to work around the sending limits, and do not use somebody else's address.",
        "The club may cancel a registration that breaches this section.",
      ],
    },
    {
      heading: "9. Personal data",
      paragraphs: [
        "How data is handled is described in the privacy notice, available on this site.",
      ],
    },
    {
      heading: "10. Changes to these terms",
      paragraphs: [
        "Every version of these terms carries a number and an effective date. The version in force when you registered is the one that applies to that registration.",
      ],
    },
    {
      heading: "11. Governing law and jurisdiction",
      paragraphs: ["<GOVERNING LAW>", "<COMPETENT COURTS>"],
    },
    { heading: "12. Contact", paragraphs: ["<CONTACT>"] },
    { heading: "Status and review", paragraphs: REVIEW_NOTE_EN },
  ],
};

const declarationRo: LegalDocumentBody = {
  sections: [
    { heading: "TEXT DE EXEMPLU — NEAPROBAT", paragraphs: SAMPLE_BANNER_RO },
    {
      heading: "1. Cine declară",
      paragraphs: [
        "Subsemnatul/subsemnata, cu numele scris în câmpul de semnătură de mai jos, mă înscriu la evenimentul <EVENIMENT>, organizat de <DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI> la data de <DATA>.",
      ],
    },
    {
      heading: "2. Starea de sănătate",
      paragraphs: [
        "Declar pe proprie răspundere că sunt apt/aptă din punct de vedere fizic pentru efortul pe care îl presupune acest eveniment și că nu am cunoștință de vreo afecțiune care să facă participarea nesigură pentru mine.",
        "Această declarație este a mea. Clubul nu îmi cere și nu păstrează informații medicale, iar platforma nu are câmpuri pentru așa ceva.",
      ],
    },
    {
      heading: "3. Asumarea riscului",
      paragraphs: [
        "Înțeleg că alergarea, în special pe traseu de cros sau de munte, presupune riscuri: teren neregulat, condiții meteo schimbătoare, trafic acolo unde traseul folosește drumuri publice, accidentare sau agravarea unei afecțiuni preexistente.",
        "Particip din proprie inițiativă și îmi asum aceste riscuri.",
      ],
    },
    {
      heading: "4. Regulile și indicațiile organizatorilor",
      paragraphs: [
        "Mă angajez să respect regulile evenimentului, marcajele traseului și indicațiile organizatorilor și ale voluntarilor de traseu, inclusiv o eventuală decizie de a opri sau a scurta evenimentul.",
        "Înțeleg că nerespectarea acestor indicații poate duce la excluderea din eveniment.",
      ],
    },
    {
      heading: "5. Fotografii și rezultate",
      paragraphs: [
        "Înțeleg că la eveniment se pot face fotografii și înregistrări în care apar și eu, și că acestea pot fi publicate de club în legătură cu evenimentul.",
        "<A se completa de club: dacă publicarea fotografiilor se face pe bază de consimțământ separat, se descrie aici cum se acordă și cum se retrage.>",
        "Publicarea numelui meu în rezultate se face numai dacă am bifat acordul separat din formularul de înscriere.",
      ],
    },
    {
      heading: "6. Răspundere proprie",
      paragraphs: [
        "Particip pe propria răspundere.",
        "<A se completa de club, împreună cu consilierul juridic: întinderea exactă a acestei clauze și limitele ei legale nu au fost redactate aici.>",
      ],
    },
    {
      heading: "7. Ce se păstrează din această declarație",
      paragraphs: [
        "Se păstrează numele pe care îl scriu ca semnătură, versiunea acestui text, o amprentă criptografică a lui și momentul acceptării. Nimic din conținutul declarat mai sus nu este stocat ca dată separată despre mine.",
        "Această acceptare nu este o semnătură electronică calificată.",
      ],
    },
    { heading: "Stare și recenzie", paragraphs: REVIEW_NOTE_RO },
  ],
};

const declarationEn: LegalDocumentBody = {
  sections: [
    { heading: "SAMPLE TEXT — NOT APPROVED", paragraphs: SAMPLE_BANNER_EN },
    {
      heading: "1. Who is declaring",
      paragraphs: [
        "I, whose name appears in the signature field below, am registering for <EVENT>, organised by <THE CLUB'S FULL LEGAL NAME> on <DATE>.",
      ],
    },
    {
      heading: "2. Fitness to take part",
      paragraphs: [
        "I declare on my own responsibility that I am physically fit for the effort this event involves, and that I know of no condition that would make taking part unsafe for me.",
        "This declaration is mine. The club does not ask for and does not keep medical information, and the platform has no fields for any.",
      ],
    },
    {
      heading: "3. Assumption of risk",
      paragraphs: [
        "I understand that running, particularly on cross-country or mountain terrain, carries risks: uneven ground, changing weather, traffic where the course uses public roads, injury, or the worsening of an existing condition.",
        "I am taking part of my own accord and I accept those risks.",
      ],
    },
    {
      heading: "4. Rules and the organisers' instructions",
      paragraphs: [
        "I undertake to follow the event's rules, the course markings, and the instructions of the organisers and the marshals, including any decision to stop or shorten the event.",
        "I understand that not following those instructions may mean being withdrawn from the event.",
      ],
    },
    {
      heading: "5. Photography and results",
      paragraphs: [
        "I understand that photographs and recordings may be made at the event in which I appear, and that the club may publish them in connection with the event.",
        "<To be completed by the club: if publishing photographs relies on separate consent, describe here how it is given and how it is withdrawn.>",
        "My name appears in the results only if I ticked the separate agreement on the registration form.",
      ],
    },
    {
      heading: "6. My own responsibility",
      paragraphs: [
        "I take part at my own responsibility.",
        "<To be completed by the club with its legal adviser: the exact scope of this clause and its limits in law have not been drafted here.>",
      ],
    },
    {
      heading: "7. What is kept from this declaration",
      paragraphs: [
        "What is kept is the name I type as my signature, the version of this text, a cryptographic fingerprint of it, and the moment I accepted it. Nothing declared above is stored as separate data about me.",
        "This acceptance is not a qualified electronic signature.",
      ],
    },
    { heading: "Status and review", paragraphs: REVIEW_NOTE_EN },
  ],
};

export const SAMPLE_DOCUMENTS: ReadonlyArray<{
  key: LegalDocumentKey;
  translations: LegalDocumentTranslationInput[];
}> = [
  {
    key: "PRIVACY_NOTICE",
    translations: [
      { locale: "ro", title: "Notă de confidențialitate (EXEMPLU, NEAPROBAT)", body: privacyNoticeRo },
      { locale: "en", title: "Privacy notice (SAMPLE, NOT APPROVED)", body: privacyNoticeEn },
    ],
  },
  {
    key: "TERMS",
    translations: [
      { locale: "ro", title: "Termeni și condiții (EXEMPLU, NEAPROBAT)", body: termsRo },
      { locale: "en", title: "Terms and conditions (SAMPLE, NOT APPROVED)", body: termsEn },
    ],
  },
  {
    key: "EVENT_DECLARATION",
    translations: [
      { locale: "ro", title: "Declarație pe proprie răspundere (EXEMPLU, NEAPROBATĂ)", body: declarationRo },
      { locale: "en", title: "Event declaration (SAMPLE, NOT APPROVED)", body: declarationEn },
    ],
  },
];

/**
 * Seed one approved version of each key, unless the same text is already the latest one.
 *
 * Never a delete-and-reinsert, unlike the event seed: a version an acceptance references is
 * immutable (AGENTS.md §12.5), and by the time QA has a registration on it there is acceptance
 * evidence pointing at these rows. Re-running with unchanged text does nothing; re-running after
 * the text here changes inserts the next version, which is exactly what a correction is.
 */
export async function seedSampleLegalDocuments(now: Date = new Date()): Promise<void> {
  assertSampleLegalDocumentsAllowed();

  const db = getDb();

  for (const document of SAMPLE_DOCUMENTS) {
    const contentSha256 = computeContentHash(document.translations);
    const latest = await findLatestVersion(db, document.key);

    if (latest?.contentSha256 === contentSha256) {
      console.log(`${document.key}: version ${latest.version} already carries this text`);
      continue;
    }

    const version = (latest?.version ?? 0) + 1;
    await insertLegalDocumentVersion(db, {
      key: document.key,
      version,
      effectiveAt: now,
      isApproved: true,
      contentSha256,
      translations: document.translations,
      now,
    });
    console.log(`${document.key}: inserted sample version ${version}`);
  }
}

/**
 * Production is refused, and it is refused in kind rather than in degree.
 *
 * Everywhere else, sample text is a draft somebody is reviewing on a system no participant has
 * ever entered a race on. In production it would be the wording a real person is told they have
 * agreed to — text that says of itself that it has no legal effect, presented as the notice
 * under which their data is processed. There is no configuration that makes that acceptable, so
 * this throws rather than skipping quietly: a seed that silently did nothing would be indistinguishable
 * from one that worked, and the difference matters on exactly one deployment.
 */
export function assertSampleLegalDocumentsAllowed(): void {
  const appEnv = process.env.APP_ENV ?? "local";
  if (appEnv === "production") {
    throw new Error(
      "Refusing to seed sample legal documents into APP_ENV=production. DECISIONS.md §29: the club's approved wording arrives through a migration, per docs/RUNBOOKS.md § Legal document version.",
    );
  }
}
