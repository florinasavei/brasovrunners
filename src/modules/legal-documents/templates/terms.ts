/**
 * The platform's text for this document (`DECISIONS.md` §95), written to describe exactly what
 * the application does; the only blanks are the club's own four facts, marked <LIKE THIS>.
 * Read by the seed (with a not-approved banner) and by `/admin/legal/new?template=`.
 */
import type { LegalDocumentBody } from "../domain/content-hash";

export const termsRo: LegalDocumentBody = {
  sections: [
    {
      heading: "1. Părțile",
      paragraphs: [
        "Acești termeni se încheie între <DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI>, cu sediul în <ADRESA SEDIULUI>, înregistrată sub <NUMĂR DE ÎNREGISTRARE / CUI> („clubul”, „noi”), și tine. Dacă versiunea în engleză diferă, contează cea în română.",
        "Site-ul publică evenimentele clubului și, unde este marcat astfel, îți permite să te înscrii online, gratuit; înscrierea pe site-ul altui organizator nu intră sub acești termeni. La înscriere, termenii, declarația pe propria răspundere și pagina evenimentului formează acordul tău de participare.",
      ],
    },
    {
      heading: "2. Înscrierea",
      paragraphs: [
        "Completezi formularul cu numele tău real, cel din actul de identitate, și te înscrii doar pe tine, o singură dată la un eveniment.",
        "Confirmi adresa de e-mail din legătura primită, în 48 de ore, altfel înscrierea expiră. Dacă există un loc liber, este ținut 30 de minute, cât citești și semnezi declarația; doar semnătura confirmă înscrierea.",
        "Fără locuri, intri pe lista de așteptare, în ordinea confirmării; când se eliberează un loc, primul de pe listă are 24 de ore să semneze, apoi oferta trece la următorul.",
        "Semnezi scriindu-ți numele complet și bifând că accepți; platforma reține numele, seria și numărul actului de identitate, momentul și o amprentă a textului exact. Declarația semnată îți vine pe e-mail, ca PDF.",
        "Este o semnătură electronică simplă în sensul Legii nr. 214/2024 privind utilizarea semnăturii electronice, a mărcii temporale și prestarea serviciilor de încredere bazate pe acestea și al Regulamentului (UE) nr. 910/2014 (eIDAS); nu i se pot refuza efectele juridice pentru că este electronică.",
      ],
    },
    {
      heading: "3. Anularea",
      paragraphs: [
        "Îți poți anula înscrierea oricând înainte de start, din legătura primită pe e-mail; locul trece la lista de așteptare.",
        "Clubul poate anula, amâna, muta sau scurta un eveniment ori îi poate schimba traseul când vremea, siguranța sau autoritățile o impun, anunțând pe pagina evenimentului și, când poate, pe e-mail. Un eveniment mutat îți păstrează înscrierea. Participarea fiind gratuită, nu se returnează nimic; cheltuielile tale de drum rămân ale tale.",
      ],
    },
    {
      heading: "4. Reguli de participare",
      paragraphs: [
        "Participi pe propria răspundere, declarându-te sănătos, pregătit pentru distanță și teren și conștient de limitele tale. Respecți indicațiile organizatorilor și ale voluntarilor, urmezi traseul marcat, respecți regulile de circulație și nu lași nimic în urmă; cine nu o face, pune pe cineva în pericol sau nu mai poate continua poate fi oprit sau exclus pe loc, fără despăgubire.",
        "Un minor este înscris de părinte sau de tutorele legal, cu datele copilului; părintele semnează declarația în locul lui, dă consimțămintele și răspunde pentru el.",
        "Numărul de concurs și kitul se ridică personal, de la birou, cu actul de identitate de pe declarație (pentru un minor, al părintelui) și nu se cedează. Nu se acordă premii în bani. Pagina evenimentului poate adăuga reguli, care fac parte din acești termeni.",
      ],
    },
    {
      heading: "5. Răspundere",
      paragraphs: [
        "Alergarea presupune riscuri firești — teren, vreme, animale, accidentări — pe care le accepți semnând declarația.",
        "Clubul răspunde pentru prejudiciile cauzate din vina sa, potrivit Codului civil (articolele 1349–1350), nu și pentru cele provocate de conduita sau sănătatea ta, de alți participanți ori terți, de trafic, de condițiile traseului sau de pierderea obiectelor personale. Nimic de aici nu înlătură răspunderea pe care legea interzice să o înlături (Codul civil, articolul 1355) și niciun drept de la care nu poți deroga.",
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
        "Numele tău poate apărea pe lista publică de participanți a unui eveniment doar dacă clubul o pornește pentru acel eveniment și ai bifat la înscriere că vrei să apari, și în rezultatele publicate doar dacă ai bifat acordul la înscriere; pe listă și în rezultate apare numele de pe formular (sau numele de afișare, dacă e permis) și clubul, nimic altceva. Amândouă se retrag oricând din pagina înscrierii tale, fără să piardă înscrierea.",
        "Textele, fotografiile, traseele, sigla și numele clubului sunt protejate de Legea nr. 8/1996 privind dreptul de autor și drepturile conexe: le poți citi, descărca pentru uz personal și distribui prin legături; orice altă folosire cere acordul nostru scris.",
        "Clubul poate publica fotografii și filmări de la evenimente în galerie și pe canalele sale, în interesul său legitim (GDPR, articolul 6 alineatul (1) litera (f)) și cu respectarea dreptului tău la propria imagine (Codul civil, articolele 73–75). Te poți opune oricând, fără motiv: spune-ne care fotografie și o scoatem în cel mult o lună.",
      ],
    },
    {
      heading: "8. Folosirea corectă",
      paragraphs: [
        "Nu trimite înscrieri automate, nu ocoli limitele de trimitere, verificarea adresei ori lista de așteptare, nu înscrie pe altcineva fără acordul lui și nu folosi un act de identitate fals sau al altei persoane. Clubul poate anula o astfel de înscriere, refuza înscrierile viitoare ale persoanei și limita temporar accesul la platformă.",
      ],
    },
    {
      heading: "9. Modificări",
      paragraphs: [
        "Fiecare versiune are un număr, o dată de intrare în vigoare și o amprentă a conținutului; o versiune aprobată nu se rescrie, ci este urmată de alta. Înscrierea ta păstrează versiunea în vigoare la momentul înscrierii; ți-o trimitem la cerere.",
      ],
    },
    {
      heading: "10. Legea, instanțele și contactul",
      paragraphs: [
        "Acești termeni sunt guvernați de legea română; o prevedere nulă lasă restul în vigoare. Scrie-ne mai întâi despre orice neînțelegere; altfel decid instanțele competente. Ca persoană fizică, în afara unei activități profesionale, poți alege instanța de la domiciliul tău (Codul de procedură civilă, articolul 113 alineatul (1) punctul 8), iar clubul te cheamă în judecată doar acolo; altfel, competente sunt instanțele din Brașov.",
        "Drepturile tale de consumator rămân neatinse, inclusiv Autoritatea Națională pentru Protecția Consumatorilor (ANPC) și procedura ei de soluționare alternativă a litigiilor (OG nr. 38/2015).",
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
        "The site publishes the club's events and, where marked so, lets you register online, free; registration on another organiser's site is outside these terms. When you register, the terms, the declaration and the event page form your participation agreement.",
      ],
    },
    {
      heading: "2. Registering",
      paragraphs: [
        "You fill in the form with your real name, as on your identity document, and register only yourself, once per event.",
        "Confirm your email address from the link received within 48 hours, or the registration expires. If a place is free, it is held for 30 minutes while you read and sign the declaration; only the signature confirms the registration.",
        "With no place left, you join the waiting list in order of confirmation; when a place frees up, the first on the list has 24 hours to sign before the offer passes to the next.",
        "You sign by typing your full name and ticking that you accept; the platform records the name, your identity document's series and number, the moment and a fingerprint of the exact text. The signed declaration reaches you by email as a PDF.",
        "This is a simple electronic signature under Law no. 214/2024 on the use of electronic signatures, time stamps and the provision of trust services based on them and Regulation (EU) no. 910/2014 (eIDAS); it cannot be denied legal effect for being electronic.",
      ],
    },
    {
      heading: "3. Cancelling",
      paragraphs: [
        "You may cancel at any time before the start, from the link in your email; the place goes to the waiting list.",
        "The club may cancel, postpone, move or shorten an event or change its course when weather, safety or the authorities require it, announced on the event page and, when possible, by email. A moved event keeps your registration. Taking part is free, so nothing is refunded; your travel costs are your own.",
      ],
    },
    {
      heading: "4. Rules for taking part",
      paragraphs: [
        "You take part on your own responsibility, declaring yourself healthy, fit for the distance and terrain and aware of your limits. You follow the organisers' and volunteers' instructions, keep to the marked course, obey the rules of the road and leave nothing behind; whoever does not, endangers anybody or cannot continue may be stopped or excluded on the spot, without compensation.",
        "A minor is registered by a parent or legal guardian with the child's details; the parent signs the declaration for the child, gives the consents and answers for them.",
        "The race number and kit are collected in person at the desk against the identity document on the declaration (for a minor, the parent's) and are not passed on. No prize money is awarded. An event page may add rules that form part of these terms.",
      ],
    },
    {
      heading: "5. Liability",
      paragraphs: [
        "Running carries natural risks — terrain, weather, animals, injury — which you accept by signing the declaration.",
        "The club is liable for damage caused through its fault under the Civil Code (articles 1349–1350), not for damage from your conduct or health, other participants or third parties, traffic, the course's conditions or lost belongings. Nothing here excludes liability the law forbids excluding (Civil Code, article 1355) or any right you cannot waive.",
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
        "Your name appears on an event's public participant list only if the club switches that list on for the event and you ticked that you want to when registering, and in published results only if you ticked that consent when registering; the list and the results show the name from the form (or the display name, where allowed) and the club, nothing else. Both are withdrawn at any time from your registration's page, without losing the registration.",
        "The club's texts, photographs, routes, logo and name are protected by Law no. 8/1996 on copyright and related rights: read them, download them for personal use, share links; any other use needs our written permission.",
        "The club may publish event photographs and video in its gallery and on its channels, in its legitimate interest (GDPR, article 6(1)(f)) and respecting your right to your own image (Civil Code, articles 73–75). You may object at any time, without a reason: tell us which photograph and it comes down within a month.",
      ],
    },
    {
      heading: "8. Fair use",
      paragraphs: [
        "Do not submit automated registrations, work around the sending limits, address check or waiting list, register somebody else without their consent, or use a false identity document or somebody else's. The club may cancel such a registration, refuse the person's future registrations and temporarily limit access to the platform.",
      ],
    },
    {
      heading: "9. Changes",
      paragraphs: [
        "Every version has a number, an effective date and a fingerprint of its content; an approved version is never rewritten, only followed by another. Your registration keeps the version in force when you registered; we send it on request.",
      ],
    },
    {
      heading: "10. Law, courts and contact",
      paragraphs: [
        "Romanian law governs these terms; an invalid provision leaves the rest in force. Write to us first about any dispute; otherwise the competent courts decide. As a private individual outside any professional activity you may choose the court of your domicile (Code of Civil Procedure, article 113(1) point 8), and the club sues you only there; otherwise the courts of Brașov have jurisdiction.",
        "Your consumer rights remain untouched, including the National Authority for Consumer Protection (ANPC) and its alternative dispute resolution procedure (Ordinance no. 38/2015).",
        "<THE CLUB'S FULL LEGAL NAME>, <REGISTERED ADDRESS>, <REGISTRATION NUMBER>; write to us at <CONTACT EMAIL>.",
      ],
    },
  ],
};
