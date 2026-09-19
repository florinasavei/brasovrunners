/**
 * The platform's text for this document (`DECISIONS.md` §95), written to describe exactly what
 * the application does; the only blanks are the club's own four facts, marked <LIKE THIS>.
 * Read by the seed (with a not-approved banner) and by `/admin/legal/new?template=`.
 */
import type { LegalDocumentBody } from "../domain/content-hash";

export const privacyNoticeRo: LegalDocumentBody = {
  sections: [
    {
      heading: "1. Cine suntem",
      paragraphs: [
        "Operatorul datelor tale este <DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI>, cu sediul în <ADRESA SEDIULUI>, <NUMĂR DE ÎNREGISTRARE / CUI> — „clubul” sau „noi”. Contact: <EMAIL DE CONTACT>.",
        "Nu avem responsabil cu protecția datelor: art. 37 din Regulamentul (UE) 2016/679 (GDPR) nu îl cere unui club mic, fără monitorizare sistematică sau date speciale la scară largă.",
      ],
    },
    {
      heading: "2. Ce date păstrăm și de ce",
      paragraphs: [
        "Din formular: prenume și nume, data nașterii, sex, naționalitate, oraș, e-mail, telefon, o persoană de contact pentru urgențe (sunată doar într-o urgență) și limba formularului. Cu ele organizăm evenimentul: locurile și lista de așteptare, mesajele despre înscriere, numărul de concurs, categoria, un telefon în ziua cursei. Temei: art. 6(1)(b) GDPR — executarea înțelegerii de participare. Sunt obligatorii: fără ele nu te poți înscrie. Adresa de e-mail confirmată te identifică (fără cont sau parolă); o păstrăm și în formă canonică, ca nimeni să nu ocupe două locuri.",
        "Opțional, același temei: mărimea de tricou, clubul, un nume de afișare și bifa „membru al echipei Brașov Runners” — neverificate, fără efect asupra locului.",
        "Nota de sănătate (alergie, afecțiune, medicament), doar pentru siguranța ta în ziua cursei, este o categorie specială, păstrată numai cu consimțământul tău explicit, bifat separat (art. 6(1)(a) și art. 9(2)(a) GDPR): niciodată obligatorie, văzută doar de organizatori, retractabilă oricând.",
        "Păstrăm și istoricul înscrierii (stările, momentele, cine a făcut-o), numărul de concurs și prezența la start: art. 6(1)(b) GDPR; după încheierea înscrierii, art. 6(1)(f), ca dovadă că locurile s-au dat corect. Locurile se dau în ordinea sosirii, o regulă pentru toți: fără profiluri, fără decizii automate (art. 22 GDPR).",
        "Un minor este înscris de părinte sau de tutorele legal, cu datele copilului; părintele semnează declarația în locul lui, dă consimțămintele și răspunde pentru el.",
      ],
    },
    {
      heading: "3. Declarația și actul de identitate",
      paragraphs: [
        "Opțional, dacă le dai: un link către profilul tău de Strava și numele tău de Instagram — le folosim doar ca să te urmărim și să te etichetăm în postările clubului; nu le publicăm și nu le transmitem nimănui (art. 6(1)(a) GDPR, retractabile oricând, cerând ștergerea lor).",
        "Declarația pe proprie răspundere confirmă locul. Păstrăm numele scris ca semnătură, amprenta textului, momentul și felul semnării (e-mail sau hârtie, cu numele celui din echipă care a înregistrat-o), nu și adresa IP. Temei: art. 6(1)(b) GDPR; ca dovadă după eveniment, art. 6(1)(f).",
        "Este o semnătură electronică simplă în sensul Regulamentului (UE) nr. 910/2014 (eIDAS) și al Legii nr. 214/2024 privind utilizarea semnăturii electronice, a mărcii temporale și prestarea serviciilor de încredere bazate pe acestea, căreia nu i se poate refuza efectul juridic doar pentru că este electronică (art. 25(1) eIDAS).",
        "Dacă declarația o cere, îți cerem seria și numărul actului de identitate, niciodată o copie, doar ca declarația să te numească fără echivoc și ca să îți predăm kitul: art. 6(1)(b) GDPR, nu interes legitim, fiind un număr de identificare național (art. 2 lit. b) din Legea nr. 190/2018 privind măsuri de punere în aplicare a Regulamentului (UE) 2016/679). Obligatorii pentru declarație, nu pentru înscriere; le vede doar echipa și le ștergem la șapte zile după eveniment.",
      ],
    },
    {
      heading: "4. Lista publică, rezultatele, fotografiile",
      paragraphs: [
        "Lista publică de participanți, oprită la fiecare eveniment până când clubul o pornește, arată doar numele (sau numele de afișare) și clubul participanților confirmați, până după eveniment — interes legitim, art. 6(1)(f) GDPR: ca participanții să vadă cine mai vine. Te poți opune fără motiv (art. 21 GDPR): bifa „nu vreau să apar pe listă” din formular este această opoziție; mai târziu, scrie-ne.",
        "Numele tău în rezultatele publicate: doar cu consimțământ separat, retractabil oricând (art. 6(1)(a) GDPR); înscrierea este valabilă și fără el.",
        "Fotografiile și filmările de la evenimente, publicate în galerie și pe canalele clubului: interes legitim (art. 6(1)(f) GDPR) — a arăta evenimentele clubului; spațiu public, fără nume, fără EXIF. Un portret îl publicăm doar cu acordul tău (Codul civil, art. 73–75). Spune-ne care și o scoatem în cel mult o lună, fără motiv.",
      ],
    },
    {
      heading: "5. E-mailurile",
      paragraphs: [
        "Trimitem doar mesaje despre înscrierea ta: confirmări, legături, lista de așteptare, un memento cu 48 de ore înainte și cel mult o mulțumire după cursă, despre acel eveniment — nu comunicări comerciale în sensul Legii nr. 506/2004 privind prelucrarea datelor cu caracter personal și protecția vieții private în sectorul comunicațiilor electronice (art. 12); marketing, doar cu consimțământ separat. Temei: art. 6(1)(b) GDPR. Din fiecare mesaj păstrăm adresa, datele lui și starea trimiterii, nu textul; legăturile, doar ca amprentă.",
      ],
    },
    {
      heading: "6. Cine mai vede datele",
      paragraphs: [
        "Le prelucrează în numele nostru, ca persoane împuternicite (art. 28 GDPR): Vercel Inc. — găzduire, Frankfurt; Neon, Inc. (grupul Databricks) — baza de date, Frankfurt; Mailgun Technologies, Inc. (grupul Sinch) — e-mail, regiunea UE; Cloudflare Inc. — fotografiile, jurisdicție UE. Mesajele către <EMAIL DE CONTACT> ajung, prin Mailgun, în căsuța organizatorului, la Google (Gmail). Datele mai pot ajunge la autorități, când legea o cere, și la un avocat, la o pretenție.",
        "Datele stau în UE, dar acești furnizori sunt companii americane și le pot accesa din SUA (Google poate ține căsuța și acolo). Temei de transfer: Cadrul UE–SUA de protecție a datelor (art. 45 GDPR) și clauzele contractuale standard ale Comisiei Europene (art. 46(2)(c) GDPR), copie la cerere.",
      ],
    },
    {
      heading: "7. Cât timp păstrăm datele",
      paragraphs: [
        "Înscrierile și declarațiile semnate, electronice sau pe hârtie: trei ani de la eveniment (termenul general de prescripție, art. 2517 din Codul civil), apoi ștergere automată. Seria și numărul actului de identitate și nota de sănătate: șapte zile de la eveniment (nota, și la retragerea consimțământului). Numele și adresa ta: odată cu ultima înscriere. Evidența e-mailurilor trimise: 90 de zile; un mesaj nelivrat, cât înscrierea. Legăturile folosite sau expirate: 30 de zile. Contoarele anti-abuz: o zi. Jurnalul echipei (art. 5(2) GDPR): trei ani, fără identitatea unei persoane șterse. Versiunea notei și consimțămintele: cât înscrierea (art. 7(1) GDPR). Lista publică: cât este pornită. Rezultatele cu numele tău: până le scoatem sau îți retragi consimțământul. Fotografiile: până le scoatem sau te opui.",
      ],
    },
    {
      heading: "8. Drepturile tale",
      paragraphs: [
        "Ai dreptul de acces, la rectificare, la ștergere, la restricționare, la portabilitate, de a te opune prelucrărilor bazate pe interes legitim și de a nu face obiectul unei decizii automate (art. 15–22 GDPR). Consimțământul îl retragi oricând, fără efect retroactiv. Opoziția o respectăm, dacă nu prevalează motive legitime imperioase ori un drept în instanță; pentru listă și fotografii nu cerem motiv.",
        "Scrie la <EMAIL DE CONTACT>, de la adresa înscrierii sau confirmându-ți identitatea (art. 12(6) GDPR). Răspundem gratuit în cel mult o lună. Ștergerea elimină înscrierea, declarația și, dacă nu mai ai alta, datele tale; jurnalul reține când și de ce, nu cine, iar locul trece primului de pe lista de așteptare.",
      ],
    },
    {
      heading: "9. Plângeri",
      paragraphs: [
        "Scrie-ne întâi. Poți depune oricând o plângere la Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP), B-dul G-ral. Gheorghe Magheru nr. 28-30, Sector 1, 010336 București, www.dataprotection.ro, anspdcp@dataprotection.ro (art. 77 GDPR), și ai o cale de atac în fața instanțelor din România sau, dacă locuiești în alt stat membru, ale acelui stat — împotriva noastră (art. 79) ori a unei decizii a autorității (art. 78).",
      ],
    },
    {
      heading: "10. Cookie-uri și date tehnice",
      paragraphs: [
        "Fără analiză de trafic, reclame sau urmărire și niciun cookie pentru vizitatori (limba stă în adresă); ce există este strict necesar, fără acord (Legea nr. 506/2004, art. 4(6)): schema de culori, în memoria browserului tău, netransmisă nouă, și, pentru echipă, un cookie de sesiune de 30 de zile.",
        "Găzduirea vede adresa IP a fiecărei cereri; jurnalul ei se păstrează cel mult o oră, nelegat de înscrieri. Formularul are un câmp-capcană, o verificare a timpului de completare și limite pe e-mail și pe legătură, păstrate o zi; platforma nu stochează nicio adresă IP. Când verificarea anti-bot este pornită, formularul folosește Cloudflare Turnstile: Cloudflare primește adresa IP și semnalele tehnice ale browserului doar ca să decidă dacă cererea vine de la o persoană, fără cookie-uri de urmărire (temei: art. 6(1)(f) GDPR). Temei: interes legitim, art. 6(1)(f) GDPR.",
      ],
    },
    {
      heading: "11. Modificări",
      paragraphs: [
        "Fiecare versiune a notei are număr, dată și amprentă și nu se mai schimbă după aprobare; înscrierea reține versiunea luată la cunoștință. Versiunea în vigoare este la această adresă; o schimbare în substanță pentru o înscriere existentă ți-o anunțăm pe e-mail înainte să se aplice.",
      ],
    },
  ],
};

export const privacyNoticeEn: LegalDocumentBody = {
  sections: [
    {
      heading: "1. Who we are",
      paragraphs: [
        "The controller of your data is <THE CLUB'S FULL LEGAL NAME>, of <REGISTERED ADDRESS>, <REGISTRATION NUMBER> — “the club” or “we”. Contact: <CONTACT EMAIL>.",
        "We have no data protection officer: article 37 of Regulation (EU) 2016/679 (the GDPR) does not require one of a small club without systematic monitoring or large-scale special data.",
      ],
    },
    {
      heading: "2. What we keep and why",
      paragraphs: [
        "From the form: first and last name, date of birth, sex, nationality, city, email, telephone, an emergency contact (called only in an emergency) and the form's language. With them we run the event: places and the waiting list, messages about your registration, race number, category, a call on race day. Basis: art. 6(1)(b) GDPR — performing the participation agreement. Required: without them you cannot register. Your confirmed email address identifies you (no account or password); a canonical form of it stops one person holding two places.",
        "Optional, same basis: t-shirt size, club, display name and the “Brașov Runners team member” tick — unverified, without effect on your place.",
        "The health note (allergy, condition, medicine), only for your safety on race day, is special-category data, kept only with your explicit consent, ticked separately (art. 6(1)(a) and art. 9(2)(a) GDPR): never required, seen only by the organisers, withdrawable at any time.",
        "We also keep the registration's history (states, moments, who acted), race number and check-in: art. 6(1)(b) GDPR; after the registration ends, art. 6(1)(f), as proof that places were given fairly. Places go in order of arrival, one rule for all: no profiling, no automated decisions (art. 22 GDPR).",
        "A minor is registered by a parent or legal guardian with the child's details; the parent signs the declaration for the child, gives the consents and answers for them.",
      ],
    },
    {
      heading: "3. Declaration and identity document",
      paragraphs: [
        "Optional, if you give them: a link to your Strava profile and your Instagram username — used only to follow you and tag you in the club's posts; never published, never passed on (art. 6(1)(a) GDPR, withdrawable at any time by asking us to delete them).",
        "The declaration of own responsibility confirms your place. We keep the name typed as signature, the text's fingerprint, the moment and how you signed (email or paper, with the recording team member's name), not your IP address. Basis: art. 6(1)(b) GDPR; as evidence after the event, art. 6(1)(f).",
        "It is a simple electronic signature under Regulation (EU) No 910/2014 (eIDAS) and Romanian Law no. 214/2024 on the use of electronic signatures, time stamps and trust services, which cannot be denied legal effect only for being electronic (art. 25(1) eIDAS).",
        "Where the declaration asks, we take your identity document's series and number, never a copy, only so that it names you unambiguously and we can hand you your kit: art. 6(1)(b) GDPR, not legitimate interest, as it is a national identification number (art. 2(b) of Romanian Law no. 190/2018 on measures implementing Regulation (EU) 2016/679). Required for the declaration, not to register; only the team sees them, deleted seven days after the event.",
      ],
    },
    {
      heading: "4. Public list, results, photographs",
      paragraphs: [
        "The public participant list, off on every event until the club switches it on, shows only the name (or display name) and club of confirmed participants, until after the event — legitimate interest, art. 6(1)(f) GDPR: so participants see who else is coming. You may object without reason (art. 21 GDPR): the “keep me off the list” tick on the form is that objection; later, write to us.",
        "Your name in published results: only with separate, withdrawable consent (art. 6(1)(a) GDPR); the registration is valid without it.",
        "Photographs and video from events, published in the gallery and on the club's channels: legitimate interest (art. 6(1)(f) GDPR) — showing the club's events; public place, no names, no EXIF. A portrait is published only with your agreement (Romanian Civil Code, art. 73–75). Tell us which and we take it down within a month, no reason needed.",
      ],
    },
    {
      heading: "5. Emails",
      paragraphs: [
        "We send only messages about your registration: confirmations, links, the waiting list, a reminder 48 hours before and at most one thank-you after the race, about that event — not commercial communications under Romanian Law no. 506/2004 on the processing of personal data and the protection of privacy in the electronic communications sector (art. 12); marketing only with separate consent. Basis: art. 6(1)(b) GDPR. Of each message we keep the address, its facts and delivery state, not the text; links, only as a fingerprint.",
      ],
    },
    {
      heading: "6. Who else sees it",
      paragraphs: [
        "Processors handle it on our behalf (art. 28 GDPR): Vercel Inc. — hosting, Frankfurt; Neon, Inc. (Databricks group) — database, Frankfurt; Mailgun Technologies, Inc. (Sinch group) — email, EU region; Cloudflare Inc. — photographs, EU jurisdiction. Mail to <CONTACT EMAIL> reaches, through Mailgun, the organiser's mailbox at Google (Gmail). Data may also reach the authorities where the law requires, and a lawyer over a claim.",
        "The data stays in the EU, but these providers are US companies and may access it from the US (Google may hold the mailbox there too). Transfer basis: the EU-U.S. Data Privacy Framework (art. 45 GDPR) and the European Commission's standard contractual clauses (art. 46(2)(c) GDPR), copy on request.",
      ],
    },
    {
      heading: "7. How long we keep it",
      paragraphs: [
        "Registrations and signed declarations, electronic or paper: three years from the event (general limitation period, art. 2517 of the Romanian Civil Code), then automatic deletion. Identity document series and number, and the health note: seven days from the event (the note also on withdrawal of consent). Your name and address: with your last registration. Sent-email records: 90 days; an undelivered message, as long as the registration. Used or expired links: 30 days. Anti-abuse counters: one day. The team's log (art. 5(2) GDPR): three years, without an erased person's identity. Notice version and consents: as long as the registration (art. 7(1) GDPR). The public list: while on. Results with your name: until taken down or you withdraw consent. Photographs: until removed or you object.",
      ],
    },
    {
      heading: "8. Your rights",
      paragraphs: [
        "You have the rights of access, rectification, erasure, restriction, portability, objection to processing based on legitimate interest and not to be subject to an automated decision (art. 15–22 GDPR). You may withdraw consent at any time, without retroactive effect. We honour an objection unless compelling legitimate grounds or a legal claim prevail; for the list and photographs we ask no reason.",
        "Write to <CONTACT EMAIL> from the registered address, or confirm your identity (art. 12(6) GDPR). We answer free of charge within one month. Erasure removes the registration, the declaration and, if you have no other, your details; the log keeps when and why, not who, and the place passes to the first on the waiting list.",
      ],
    },
    {
      heading: "9. Complaints",
      paragraphs: [
        "Write to us first. You may always complain to Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP), B-dul G-ral. Gheorghe Magheru nr. 28-30, Sector 1, 010336 Bucharest, www.dataprotection.ro, anspdcp@dataprotection.ro (art. 77 GDPR), and have a judicial remedy before the courts of Romania or, if you live in another Member State, of that State — against us (art. 79) or a decision of the authority (art. 78).",
      ],
    },
    {
      heading: "10. Cookies and technical data",
      paragraphs: [
        "No traffic analytics, advertising or tracking, and no cookie for visitors (the language is in the address); what exists is strictly necessary and needs no consent (Romanian Law no. 506/2004, art. 4(6)): the colour scheme, in your browser's own storage, never sent to us, and, for the team, a 30-day session cookie.",
        "Hosting sees each request's IP address; its log is kept at most one hour, unlinked to registrations. The form has a trap field, a fill-time check and limits per email and per link, kept one day; the platform stores no IP address. When the anti-bot check is on, the form uses Cloudflare Turnstile: Cloudflare receives the IP address and the browser's technical signals only to decide whether the request comes from a person, with no tracking cookies (basis: art. 6(1)(f) GDPR). Basis: legitimate interest, art. 6(1)(f) GDPR.",
      ],
    },
    {
      heading: "11. Changes",
      paragraphs: [
        "Every version of this notice is numbered, dated, fingerprinted and never changes after approval; your registration records the version you acknowledged. The version in force is at this address; a material change for an existing registration is announced by email before it applies.",
      ],
    },
  ],
};
