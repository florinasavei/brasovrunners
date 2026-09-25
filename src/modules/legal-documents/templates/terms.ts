/**
 * The platform's text for this document (`DECISIONS.md` §95), written to describe exactly what
 * the application does; the only blanks are the club's own four facts, marked <LIKE THIS>. The
 * deadlines it states are merge fields — `{{confirmationHours}}`, `{{holdMinutes}}`,
 * `{{offerHours}}` — filled from the club's "Termene" when the page is shown (§377), so the text
 * says the numbers the platform keeps.
 * Read by the seed (with a not-approved banner) and by `/admin/legal/new?template=`.
 *
 * No hardcoded value (§357): no town is written in — the courts are "the Romanian courts competent
 * under the Code of Civil Procedure", with a consumer's own domicile named as a choice — and the
 * club's hold (§377) says the participation window's deadline where an event has one (§104) — a
 * sentence true of one event and false of the next is a value, not a rule.
 *
 * **Production-ready per the counsel review of 2026-09-25 (§418).** Registering on the site is free
 * and a fee, where there is one, is the event page's; on another organiser's event the club only
 * publishes (§1). The unusual clauses — §3 cancelling or changing, §4 stopping or excluding, §5
 * liability, §10 law and court — are accepted expressly by a separate box (Civil Code art. 1203).
 * The family flow (§389) is allowed in §2 and nobody signs for another adult (§8). §5 is written
 * around attribution (art. 1349–1352, 1355, 1371, 1373), never as a waiver for injury. §7 describes
 * the list's states only where the notice the runner was given does (§396). §10 has no compulsory
 * pre-litigation step and no forum at the club's seat, and points to ANSPDCP, not SAL-ANPC.
 *
 * §1's separate box and the version §9 records are `Registration.terms.accept` on the form and `registrations.terms_version` (§421).
 */
import type { LegalDocumentBody } from "../domain/content-hash";

export const termsRo: LegalDocumentBody = {
  sections: [
    {
      heading: "1. Părțile",
      paragraphs: [
        "Acești termeni se încheie între <DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI>, cu sediul în <ADRESA SEDIULUI>, înregistrată sub <NUMĂR DE ÎNREGISTRARE / CUI> („clubul”, „noi”), și tine. Dacă versiunea în engleză diferă, contează cea în română.",
        "Site-ul publică evenimentele clubului și, pentru informarea ta, evenimente ale altor organizatori; unde este marcat astfel, te poți înscrie online. Înscrierea pe site este gratuită; dacă un eveniment cere o taxă, pagina lui spune cât, cui și cum se plătește. Unde înscrierea se face pe site-ul altui organizator, clubul doar publică informația și nu este parte la acel contract: înscrierea, taxa (plătită organizatorului, nu clubului), reducerea afișată, dacă există, rambursarea, regulamentul și datele tale personale sunt ale acelui organizator, după condițiile lui. La înscrierea pe acest site, termenii, declarația pe propria răspundere și pagina evenimentului formează acordul tău de participare.",
        "Clauzele din secțiunile 3 (anularea sau modificarea evenimentului), 4 (oprirea sau excluderea de pe traseu), 5 (răspunderea) și 10 (legea și instanța) le accepți în mod expres, prin căsuța separată din formularul de înscriere (Codul civil, articolul 1203).",
      ],
    },
    {
      heading: "2. Înscrierea",
      paragraphs: [
        "Completezi formularul cu numele real al persoanei care aleargă, cel din actul ei de identitate. De pe aceeași adresă de e-mail poți înscrie la același eveniment și alte persoane, de exemplu din familie, cel mult câte permite clubul, fiecare o singură dată, doar cu acordul lor și după ce le-ai spus, pe baza notei de confidențialitate, cum le folosim datele; un minor îl înscrie părintele sau tutorele legal, ca la punctul 4. Fiecare persoană are propria înscriere, propriul loc și propria declarație, pe care o semnează ea însăși (pentru un minor, ca la punctul 4). Mesajele care o privesc ajung pe adresa ta și i le transmiți.",
        "Confirmi adresa de e-mail din legătura primită, în {{confirmationHours}}, altfel înscrierea expiră. Dacă există un loc liber, este ținut {{holdMinutes}}, cât citești și semnezi declarația — iar la un eveniment care cere confirmarea participării cu câteva zile înainte de start, până la termenul de confirmare arătat pe pagina lui; doar semnătura confirmă înscrierea.",
        "Fără locuri, intri pe lista de așteptare, în ordinea confirmării; când se eliberează un loc, primul de pe listă are {{offerHours}} să semneze, apoi oferta trece la următorul.",
        "Semnezi scriindu-ți numele complet și bifând că accepți; platforma reține numele, seria și numărul actului de identitate, momentul și o amprentă a textului exact. Declarația semnată îți vine pe e-mail, ca PDF.",
        "Este o semnătură electronică simplă în sensul Legii nr. 214/2024 privind utilizarea semnăturii electronice, a mărcii temporale și prestarea serviciilor de încredere bazate pe acestea și al Regulamentului (UE) nr. 910/2014 (eIDAS); nu i se pot refuza efectele juridice pentru că este electronică.",
      ],
    },
    {
      heading: "3. Anularea",
      paragraphs: [
        "Îți poți anula înscrierea oricând înainte de start, din legătura primită pe e-mail; locul trece la lista de așteptare.",
        "Clubul poate anula, amâna, muta sau scurta un eveniment ori îi poate schimba traseul când vremea, siguranța sau autoritățile o impun, anunțând pe pagina evenimentului și, când poate, pe e-mail. Un eveniment mutat îți păstrează înscrierea. La un eveniment gratuit nu se returnează nimic. Dacă ai plătit clubului o taxă de participare și clubul anulează evenimentul, îți restituim integral taxa, pe calea pe care ai plătit-o. Alte reguli de restituire, dacă există, sunt pe pagina evenimentului. Dreptul de retragere de 14 zile nu se aplică unui serviciu de agrement cu dată fixă (OUG nr. 34/2014, articolul 16 litera l)), dar îți poți anula oricând înscrierea, ca mai sus. Cheltuielile tale de drum rămân ale tale.",
      ],
    },
    {
      heading: "4. Reguli de participare",
      paragraphs: [
        "Participi pe propria răspundere, declarându-te sănătos, pregătit pentru distanță și teren și conștient de limitele tale. Respecți indicațiile organizatorilor și ale voluntarilor, urmezi traseul marcat, respecți regulile de circulație și nu lași nimic în urmă; cine nu o face, pune pe cineva în pericol sau nu mai poate continua poate fi oprit sau exclus pe loc, fără despăgubire.",
        "Un eveniment poate cere o vârstă minimă de participare; când o cere, ea este afișată pe pagina evenimentului și trebuie să o ai împlinită în ziua lui, iar o înscriere cu o dată a nașterii care arată mai puțin este refuzată. Un minor (sub 18 ani) este înscris de părinte sau de tutorele legal, cu datele copilului. Declarația o semnează părintele sau tutorele, cu actul lui de identitate, iar când declarația în vigoare o cere, o semnează alături de el și minorul, cu actul lui; părintele sau tutorele își dă acordul pentru participarea minorului, dă consimțămintele și răspunde pentru el.",
        "Numărul de concurs și kitul se ridică personal, de la birou, cu actul de identitate de pe declarație (pentru un minor, al minorului sau al părintelui ori tutorelui) și nu se cedează. Nu se acordă premii în bani. Pagina evenimentului poate adăuga reguli, care fac parte din acești termeni așa cum sunt afișate când te înscrii. O schimbare ulterioară impusă de vreme, de siguranță sau de autorități se aplică tuturor, ca la punctul 3; oricare alta ți se aplică doar după ce ți-o anunțăm pe e-mail, iar dacă nu ești de acord îți poți anula înscrierea oricând înainte de start.",
      ],
    },
    {
      heading: "5. Răspundere",
      paragraphs: [
        "Alergarea presupune riscuri firești — teren, căderi, vreme, întuneric, animale, accidentări — pe care declarația le descrie și pe care le accepți semnând-o; echipamentul potrivit și deciziile tale pe traseu sunt responsabilitatea ta.",
        "Clubul răspunde, potrivit Codului civil (articolele 1349–1350 și 1373), pentru prejudiciile cauzate din vina sa ori a persoanelor de care se folosește la organizare, inclusiv pentru felul în care alege, marchează și supraveghează traseul. Nu răspunde pentru prejudiciile care nu îi sunt imputabile: cele cauzate exclusiv de conduita sau de starea ta de sănătate, de alți participanți, de terți pentru care nu este ținut să răspundă ori de trafic, de riscurile firești ale traseului pe care declarația le descrie, sau de forța majoră ori cazul fortuit (articolele 1351–1352); dacă la prejudiciu a contribuit și fapta ta, clubul răspunde numai pentru partea lui (articolul 1371). Pentru pierderea sau deteriorarea obiectelor personale lăsate nesupravegheate, clubul răspunde doar pentru intenție sau culpă gravă (articolul 1355 alineatele (1) și (2)). Nici acești termeni, nici declarația nu înlătură și nu limitează răspunderea clubului pentru vătămarea integrității corporale sau a sănătății, iar acceptarea riscurilor nu înseamnă, prin ea însăși, renunțarea la despăgubiri (articolul 1355 alineatele (3) și (4)). Nimic de aici nu înlătură vreun drept de la care nu poți deroga.",
      ],
    },
    {
      heading: "6. Datele personale",
      paragraphs: [
        "Datele tale sunt prelucrate de club, ca operator, potrivit Regulamentului (UE) 2016/679 (GDPR) și Legii nr. 190/2018; nota de confidențialitate, arătată la înscriere, spune ce colectăm, de ce, cât timp, cine ne ajută și ce drepturi ai.",
      ],
    },
    {
      heading: "7. Numele tău, rezultatele, fotografiile",
      paragraphs: [
        "Numele tău poate apărea pe lista publică de participanți a unui eveniment doar dacă clubul o pornește pentru acel eveniment și ai bifat la înscriere că vrei să apari. Lista arată numele de pe formular (sau numele de afișare, dacă e permis), clubul și, dacă nota de confidențialitate primită la înscriere o prevede, stadiul înscrierii — {{participantListStates}} —, nimic altceva. O înscriere cu adresa neconfirmată, anulată sau expirată nu apare. Rezultate cu nume nu publicăm încă; când o vom face, te vom întreba separat. Acordul pentru listă îl retragi oricând din „Înscrierile mele” sau din legătura din emailul de confirmare, fără să pierzi înscrierea.",
        "Textele, fotografiile, traseele, sigla și numele clubului sunt protejate de Legea nr. 8/1996 privind dreptul de autor și drepturile conexe: le poți citi, descărca pentru uz personal și distribui prin legături; orice altă folosire cere acordul nostru scris.",
        "Clubul poate publica fotografii și filmări de la evenimente în galerie și pe canalele sale, în interesul său legitim (GDPR, articolul 6 alineatul (1) litera (f)) și cu respectarea dreptului tău la propria imagine (Codul civil, articolele 73–75). Te poți opune oricând, fără motiv: spune-ne care fotografie și o scoatem în cel mult o lună.",
      ],
    },
    {
      heading: "8. Folosirea corectă",
      paragraphs: [
        "Nu trimite înscrieri automate, nu ocoli limitele de trimitere, verificarea adresei ori lista de așteptare, nu înscrie pe altcineva fără acordul lui (iar un minor, doar dacă ești părintele sau tutorele lui legal), nu semna declarația în locul altui adult și nu folosi un act de identitate fals sau al altei persoane. Clubul poate anula o astfel de înscriere, refuza înscrierile viitoare ale persoanei și limita temporar accesul la platformă.",
      ],
    },
    {
      heading: "9. Modificări",
      paragraphs: [
        "Fiecare versiune are un număr, o dată de intrare în vigoare și o amprentă a conținutului; o versiune aprobată nu se rescrie, ci este urmată de alta. Înscrierea ta rămâne supusă versiunii pe care ai acceptat-o când ai trimis formularul; numărul ei este înregistrat la înscrierea ta și ți-o trimitem la cerere.",
      ],
    },
    {
      heading: "10. Legea, instanțele și contactul",
      paragraphs: [
        "Acești termeni sunt guvernați de legea română; o prevedere nulă lasă restul în vigoare. Te rugăm să ne scrii mai întâi despre orice neînțelegere, ca s-o rezolvăm împreună; nu este o condiție pentru a te adresa instanței. Litigiile se judecă de instanțele române competente potrivit Codului de procedură civilă. Ca persoană fizică, în afara unei activități profesionale, ne poți chema în judecată și la instanța de la domiciliul tău (Codul de procedură civilă, articolul 113 alineatul (1) punctul 8), iar clubul te cheamă în judecată doar la instanța de la domiciliul tău.",
        "Nimic din acești termeni nu îți restrânge drepturile pe care ți le dă legea și de la care nu se poate deroga. Pentru datele tale personale te poți adresa și Autorității Naționale de Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP); nota de confidențialitate spune cum.",
        "<DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI>, <ADRESA SEDIULUI>, <NUMĂR DE ÎNREGISTRARE / CUI>; scrie-ne la <EMAIL DE CONTACT>.",
      ],
    },
  ],
};

export const termsEn: LegalDocumentBody = {
  sections: [
    {
      heading: "1. The parties",
      paragraphs: [
        "These terms are between <THE CLUB'S FULL LEGAL NAME>, of <REGISTERED ADDRESS>, registered under <REGISTRATION NUMBER> (“the club”, “we”), and you. If the English version differs, the Romanian one counts.",
        "The site publishes the club's events and, for your information, events by other organisers; where marked so, you can register online. Registering on the site is free; if an event asks a fee, its page says how much, to whom and how it is paid. Where registration is on another organiser's site, the club only publishes the information and is not a party to that contract: the registration, the fee (paid to the organiser, not to the club), any discount shown, refunds, the rules and your personal data are that organiser's, on its own terms. When you register on this site, the terms, the declaration and the event page form your participation agreement.",
        "You accept the clauses in sections 3 (cancelling or changing an event), 4 (being stopped or excluded on the course), 5 (liability) and 10 (law and courts) expressly, by the separate box on the registration form (Civil Code, article 1203).",
      ],
    },
    {
      heading: "2. Registering",
      paragraphs: [
        "You fill in the form with the real name of the person who will run, as on their identity document. From the same email address you may also register other people for the same event, your family for instance, up to the number the club allows, each of them once, only with their agreement and after telling them, from the privacy notice, how we use their data; a minor is registered by a parent or legal guardian, as in section 4. Each person has their own registration, place and declaration, which they sign themselves (for a minor, as in section 4). The messages about them reach your address, and you pass them on.",
        "Confirm your email address from the link received within {{confirmationHours}}, or the registration expires. If a place is free, it is held for {{holdMinutes}} while you read and sign the declaration — or, at an event that asks for the confirmation of participation a few days before the start, until the confirmation deadline shown on its page; only the signature confirms the registration.",
        "With no place left, you join the waiting list in order of confirmation; when a place frees up, the first on the list has {{offerHours}} to sign before the offer passes to the next.",
        "You sign by typing your full name and ticking that you accept; the platform records the name, your identity document's series and number, the moment and a fingerprint of the exact text. The signed declaration reaches you by email as a PDF.",
        "This is a simple electronic signature under Law no. 214/2024 on the use of electronic signatures, time stamps and the provision of trust services based on them and Regulation (EU) no. 910/2014 (eIDAS); it cannot be denied legal effect for being electronic.",
      ],
    },
    {
      heading: "3. Cancelling",
      paragraphs: [
        "You may cancel at any time before the start, from the link in your email; the place goes to the waiting list.",
        "The club may cancel, postpone, move or shorten an event or change its course when weather, safety or the authorities require it, announced on the event page and, when possible, by email. A moved event keeps your registration. At a free event nothing is refunded. If you paid the club a participation fee and the club cancels the event, we refund the fee in full, by the way you paid it. Any other refund rules are on the event's page. The 14-day right of withdrawal does not apply to a leisure service on a set date (Emergency Ordinance no. 34/2014, article 16(l)), but you may still cancel your registration at any time, as above. Your travel costs are your own.",
      ],
    },
    {
      heading: "4. Rules for taking part",
      paragraphs: [
        "You take part on your own responsibility, declaring yourself healthy, fit for the distance and terrain and aware of your limits. You follow the organisers' and volunteers' instructions, keep to the marked course, obey the rules of the road and leave nothing behind; whoever does not, endangers anybody or cannot continue may be stopped or excluded on the spot, without compensation.",
        "An event may set a minimum age to take part; where it does, the age is shown on the event's page and must be reached by the day of the event, and a registration whose date of birth gives less is refused. A minor (under 18) is registered by a parent or legal guardian with the child's details. The parent or guardian signs the declaration with their own identity document and, where the declaration in force asks for it, the minor signs it too, with their own; the parent or guardian consents to the minor taking part, gives the consents and answers for them.",
        "The race number and kit are collected in person at the desk against the identity document on the declaration (for a minor, the minor's or the parent's or guardian's) and are not passed on. No prize money is awarded. An event page may add rules, which form part of these terms as shown when you register. A later change required by weather, safety or the authorities applies to everybody, as in section 3; any other change applies to you only once we have announced it to you by email, and if you do not agree you may cancel your registration at any time before the start.",
      ],
    },
    {
      heading: "5. Liability",
      paragraphs: [
        "Running carries natural risks — terrain, falls, weather, darkness, animals, injury — which the declaration describes and which you accept by signing it; the right equipment and your decisions on the course are your own responsibility.",
        "The club is liable, under the Civil Code (articles 1349–1350 and 1373), for damage caused through its fault or that of the people it uses to organise the event, including in how it chooses, marks and supervises the course. It is not liable for damage that cannot be attributed to it: damage caused solely by your own conduct or health, by other participants, by third parties it does not answer for or by traffic, by the ordinary risks of the course that the declaration describes, or by force majeure or a fortuitous event (articles 1351–1352); where your own conduct contributed, the club answers only for its share (article 1371). For lost or damaged personal belongings left unattended the club is liable only for intent or gross fault (article 1355(1) and (2)). Neither these terms nor the declaration exclude or limit the club's liability for harm to your body or health, and accepting the risks does not by itself mean you waive compensation (article 1355(3) and (4)). Nothing here removes any right you cannot waive.",
      ],
    },
    {
      heading: "6. Personal data",
      paragraphs: [
        "Your data is processed by the club, as controller, under Regulation (EU) 2016/679 (the GDPR) and Law no. 190/2018; the privacy notice, shown when you register, says what we collect, why, for how long, who helps us and your rights.",
      ],
    },
    {
      heading: "7. Your name, the results, the photographs",
      paragraphs: [
        "Your name appears on an event's public participant list only if the club switches that list on for the event and you ticked that you want to when registering. The list shows the name from the form (or the display name, where allowed), the club and, where the privacy notice you were given at registration provides for it, where the registration stands — {{participantListStates}} — nothing else. A registration whose address is unconfirmed, or which is cancelled or expired, does not appear. We do not publish results with names yet; when we do, we will ask you separately. You withdraw your agreement to the list at any time from “My registrations”, or from the link in your confirmation email, without losing the registration.",
        "The club's texts, photographs, routes, logo and name are protected by Law no. 8/1996 on copyright and related rights: read them, download them for personal use, share links; any other use needs our written permission.",
        "The club may publish event photographs and video in its gallery and on its channels, in its legitimate interest (GDPR, article 6(1)(f)) and respecting your right to your own image (Civil Code, articles 73–75). You may object at any time, without a reason: tell us which photograph and it comes down within a month.",
      ],
    },
    {
      heading: "8. Fair use",
      paragraphs: [
        "Do not submit automated registrations, work around the sending limits, address check or waiting list, register somebody else without their agreement (and a minor only if you are their parent or legal guardian), sign the declaration in another adult's place, or use a false identity document or somebody else's. The club may cancel such a registration, refuse the person's future registrations and temporarily limit access to the platform.",
      ],
    },
    {
      heading: "9. Changes",
      paragraphs: [
        "Every version has a number, an effective date and a fingerprint of its content; an approved version is never rewritten, only followed by another. Your registration stays under the version you accepted when you sent the form; its number is recorded with your registration and we send it on request.",
      ],
    },
    {
      heading: "10. Law, courts and contact",
      paragraphs: [
        "Romanian law governs these terms; an invalid provision leaves the rest in force. Please write to us first about any dispute so we can settle it together; this is not a condition of going to court. Disputes are decided by the Romanian courts competent under the Code of Civil Procedure. As a private individual outside any professional activity you may also sue us in the court of your domicile (Code of Civil Procedure, article 113(1) point 8), and the club sues you only in the court of your domicile.",
        "Nothing in these terms limits the rights the law gives you and that cannot be waived. About your personal data you may also turn to the National Supervisory Authority for Personal Data Processing (ANSPDCP); the privacy notice says how.",
        "<THE CLUB'S FULL LEGAL NAME>, <REGISTERED ADDRESS>, <REGISTRATION NUMBER>; write to us at <CONTACT EMAIL>.",
      ],
    },
  ],
};
