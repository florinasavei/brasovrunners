/**
 * The platform's text for this document (`DECISIONS.md` §95), written to describe exactly what
 * the application does; the only blanks are the club's own four facts, marked <LIKE THIS>.
 * Read by the seed (with a not-approved banner) and by `/admin/legal/new?template=`.
 *
 * Rewritten by the GDPR transparency pass (§323): every item the platform keeps now has its
 * purpose next to it, the emergency contact and the club team are covered, the club's own
 * mailboxes and their copies are named, retention is listed item by item, and the rights say
 * what a person can do alone and what they ask for. A template edit changes nothing in
 * effect: production keeps the version the club approved until it approves a new one in
 * `/admin/legal`.
 *
 * The hold, the offer and the reminder are merge fields — `{{holdMinutes}}`, `{{offerHours}}`,
 * `{{reminderHours}}` — filled from the club's "Termene" when the notice is shown (§NNN). The
 * retention periods (three years, seven days, thirty days…) are not: they are the club's legal
 * commitment, written in the text it approves, and no setting may move them.
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
        "Din formular: prenume și nume, data nașterii, sex, e-mail, telefon și limba formularului; opțional, naționalitatea și orașul. Le folosim ca să organizăm evenimentul: locurile și lista de așteptare, mesajele despre înscriere și numărul de concurs (numele și e-mailul); categoria de vârstă și de sex și dacă un minor trebuie înscris de părinte (data nașterii și sexul); ca să te găsim în ziua cursei, dacă e nevoie (telefonul); ca să știm de unde vin participanții (naționalitatea și orașul, opționale). Temei: art. 6(1)(b) GDPR — executarea înțelegerii de participare. Cele obligatorii sunt marcate în formular: fără ele nu te poți înscrie. Adresa de e-mail confirmată te identifică (fără cont sau parolă); o păstrăm și în formă canonică, ca nimeni să nu ocupe două locuri.",
        "Persoana de contact pentru urgențe: îi păstrăm numele și telefonul, pe care ni le dai tu, doar ca s-o sunăm dacă ți se întâmplă ceva la eveniment — interesul legitim al tău și al clubului de a anunța pe cineva apropiat (art. 6(1)(f) GDPR) și, într-o urgență, interesul vital (art. 6(1)(d)). Spune-i că ne-ai dat datele ei; drepturile din secțiunea 8 sunt și ale ei. Le văd doar organizatorii, pe fișa de urgență a evenimentului, și le ștergem odată cu înscrierea.",
        "Opțional, același temei: mărimea de tricou, clubul, un nume de afișare și bifa „membru al echipei Brașov Runners” — neverificate, fără efect asupra locului.",
        "Nota de sănătate (alergie, afecțiune, medicament) este o categorie specială de date, pe care o păstrăm numai cu consimțământul tău explicit, bifat separat (art. 6(1)(a) și art. 9(2)(a) GDPR), doar ca organizatorii cursei să știe ce e de făcut dacă ai nevoie de ajutor în ziua cursei. Nu este niciodată obligatorie. O văd doar organizatorii, pe pagina înscrierii și pe fișa de urgență a evenimentului; nu apare în exportul listei de participanți, în e-mailuri sau în copiile trimise clubului (o primești doar tu, dacă ne ceri o copie a datelor tale). O retragi oricând din „Înscrierile mele”, fără să-ți pierzi locul.",
        "Păstrăm și istoricul înscrierii (stările, momentele, cine a făcut-o), numărul de concurs și prezența la start: art. 6(1)(b) GDPR; după încheierea înscrierii, art. 6(1)(f), ca dovadă că locurile s-au dat corect. Locurile și lista de așteptare le gestionează automat platforma, după o singură regulă pentru toți — ordinea confirmării adresei de e-mail; un loc ținut și nesemnat la timp ({{holdMinutes}}, sau până la termenul de confirmare dinaintea cursei când evenimentul are unul, ori {{offerHours}} pentru o ofertă de pe lista de așteptare) trece automat următorului de pe lista de așteptare. Nu facem profiluri. Nu considerăm aceasta o decizie cu efecte juridice sau la fel de importante în sensul art. 22 GDPR, participarea fiind gratuită, dar poți cere oricând ca un om din echipă să verifice ce s-a întâmplat cu locul tău.",
        "Data nașterii ne arată și dacă ai vârsta minimă a evenimentului, acolo unde are una: se stabilește pentru fiecare eveniment, este afișată pe pagina lui și se socotește în ziua evenimentului; pe nimeni mai tânăr nu îl înscriem. Un minor (sub 18 ani la data înscrierii) este înscris de părinte sau de tutorele legal, cu datele copilului. Adresa de e-mail și telefonul din formular sunt de regulă ale părintelui, care primește astfel toate mesajele; păstrăm și numele părintelui, iar la semnare seria și numărul actului de identitate al părintelui și al minorului, pentru că declarația o semnează amândoi; părintele dă consimțămintele în locul copilului (art. 8 GDPR), iar kitul se ridică cu actul unuia dintre ei — temei art. 6(1)(b) GDPR, aceleași termene ca mai jos. Pentru un minor nu păstrăm Strava sau Instagram, iar fotografii în care un copil apare în prim-plan publicăm doar cu acordul părintelui.",
        "Opțional: un link către profilul tău de Strava și numele tău de Instagram — ca să te urmărim și să te putem eticheta în postările clubului de pe acele platforme (eticheta e vizibilă acolo); pe site nu le publicăm și nu le dăm nimănui. Temei: consimțământul tău (art. 6(1)(a) GDPR), pe care îl retragi oricând din „Înscrierile mele”, fără să-ți afecteze înscrierea.",
      ],
    },
    {
      heading: "3. Declarația și actul de identitate",
      paragraphs: [
        "Declarația pe proprie răspundere confirmă locul. Păstrăm numele scris ca semnătură, amprenta textului, momentul și felul semnării (e-mail sau hârtie, cu numele celui din echipă care a înregistrat-o), nu și adresa IP. Temei: art. 6(1)(b) GDPR; ca dovadă după eveniment, art. 6(1)(f).",
        "Este o semnătură electronică simplă în sensul Regulamentului (UE) nr. 910/2014 (eIDAS) și al Legii nr. 214/2024 privind utilizarea semnăturii electronice, a mărcii temporale și prestarea serviciilor de încredere bazate pe acestea, căreia nu i se poate refuza efectul juridic doar pentru că este electronică (art. 25(1) eIDAS).",
        "Dacă declarația o cere, îți cerem seria și numărul actului de identitate (pentru un minor, și pe ale părintelui sau tutorelui care semnează alături), niciodată o copie, doar ca declarația să te numească fără echivoc și ca să îți predăm kitul: art. 6(1)(b) GDPR, nu interes legitim, fiind un număr de identificare național (art. 2 lit. b) din Legea nr. 190/2018 privind măsuri de punere în aplicare a Regulamentului (UE) 2016/679). Fără ele nu poți semna declarația, iar fără declarație locul nu se confirmă. Le văd doar echipa, la ridicarea kitului; în copiile declarației trimise clubului pe e-mail apar mascate (rămân cel mult primele două și ultimele două caractere), iar din baza de date le ștergem la șapte zile după eveniment.",
      ],
    },
    {
      heading: "4. Lista publică, rezultatele, fotografiile",
      paragraphs: [
        "Lista publică de participanți, oprită la fiecare eveniment până când clubul o pornește, arată doar numele (sau numele de afișare) și clubul participanților confirmați care au bifat „vreau să apar pe lista de participanți” la înscriere, până după eveniment — consimțământ, art. 6(1)(a) GDPR, pe care îl retragi oricând din „Înscrierile mele” sau din legătura din emailul de confirmare; fără bifă nu apari.",
        "Rezultate cu nume nu publicăm încă; când o vom face, te vom întreba separat, pentru fiecare eveniment.",
        "Fotografiile și filmările de la evenimente, publicate în galerie și pe canalele clubului: interes legitim (art. 6(1)(f) GDPR) — a arăta evenimentele clubului; spațiu public, fără nume, fără EXIF. Un portret îl publicăm doar cu acordul tău (Codul civil, art. 73–75). Spune-ne care și o scoatem în cel mult o lună, fără motiv.",
      ],
    },
    {
      heading: "5. E-mailurile",
      paragraphs: [
        "Trimitem doar mesaje despre înscrierea ta: confirmări, legături, lista de așteptare, un memento cu {{reminderHours}} înainte și cel mult o mulțumire după cursă, despre acel eveniment — nu comunicări comerciale în sensul Legii nr. 506/2004 privind prelucrarea datelor cu caracter personal și protecția vieții private în sectorul comunicațiilor electronice (art. 12); marketing, doar cu consimțământ separat. Temei: art. 6(1)(b) GDPR. Din fiecare mesaj păstrăm adresa, datele lui și starea trimiterii, nu textul; legăturile, doar ca amprentă.",
        "„Anunță-mă când se deschid înscrierile”: dacă lași adresa ta pe pagina unui eveniment înainte să se deschidă înscrierile, îți trimitem un singur e-mail, la scurt timp după ce se deschid, cu legătura către formular. Adresa o păstrăm în lista de anunțare doar până la trimiterea acelui mesaj și o ștergem din listă odată cu el (mesajul însuși păstrează adresa ca orice alt mesaj, vezi mai sus) — sau fără mesaj, dacă evenimentul e anulat ori înscrierile nu se mai deschid pe site. Temei: consimțământul tău (art. 6(1)(a) GDPR), pe care îl poți retrage oricând înainte de trimitere, scriindu-ne la <EMAIL DE CONTACT>.",
        "Formularul de contact („Scrie-ne”): ia numele, adresa de e-mail și mesajul tău, împreună cu limba și pagina de pe care ai scris, și le trimite ca un e-mail obișnuit în căsuța clubului (Gmail, secțiunea 6), unde le păstrăm cel mult 12 luni de la ultimul mesaj al conversației; platforma nu păstrează nicio copie. Le folosim doar ca să-ți răspundem — pentru nimic altceva. Temei: interesul nostru legitim de a răspunde la ceea ce ne-ai întrebat (art. 6(1)(f) GDPR). Formularul are aceleași apărări anti-roboți ca cel de înscriere (secțiunea 10).",
      ],
    },
    {
      heading: "6. Cine mai vede datele",
      paragraphs: [
        "Le prelucrează în numele nostru, ca persoane împuternicite, pe bază de contract (art. 28 GDPR): Vercel Inc. — găzduirea site-ului (funcțiile în Frankfurt; cererile trec prin rețeaua globală Vercel); Neon, Inc. (grupul Databricks) — baza de date, Frankfurt; Mailgun Technologies, Inc. (grupul Sinch) — trimiterea e-mailurilor, regiunea UE; Cloudflare, Inc. — stocarea fotografiilor, în UE, și verificarea anti-roboți Turnstile (secțiunea 10); Zitadel — conturile de autentificare ale echipei clubului, fără date ale participanților.",
        "Căsuța de e-mail a clubului este un cont Gmail (Google). În ea ajung mesajele trimise la <EMAIL DE CONTACT> și prin formularul de contact, precum și copiile de mai jos; unele pot fi redirecționate către căsuțele organizatorilor. Pentru un cont Gmail obișnuit, Google prelucrează datele și după propriile reguli, nu doar în numele nostru.",
        "Copii în căsuțele clubului. Când semnezi declarația, o copie PDF a ei — cu numele tău și evenimentul, iar seria și numărul actului de identitate mascate (rămân cel mult primele două și ultimele două caractere) — ajunge în căsuța de arhivă a clubului și la cel mult câteva adrese ale organizatorilor, alese de club. Clubul primește și un mesaj scurt când îți confirmi locul (numele, evenimentul, numărul de concurs) și poate primi o copie a e-mailurilor pe care ți le trimitem despre înscriere, fără legăturile personale și fără atașamente. Temei: interesul nostru legitim de a avea declarațiile și confirmările la îndemână în ziua cursei și ca dovadă după ea (art. 6(1)(f) GDPR). Le ștergem la trei ani de la eveniment.",
        "Fotografiile publicate pe Facebook, Instagram (Meta) sau Strava ajung la acele platforme, care le prelucrează după propriile reguli. Datele mai pot ajunge la autorități, când legea o cere, și la un avocat, la o pretenție. Nu le vindem și nu le dăm nimănui altcuiva.",
        "Datele stau în UE, dar Vercel, Neon, Mailgun, Cloudflare și Google sunt sau aparțin unor companii din SUA și le pot accesa de acolo. Temei de transfer: clauzele contractuale standard ale Comisiei Europene din contractul de prelucrare al fiecăruia (art. 46(2)(c) GDPR) și, pentru furnizorii certificați, Cadrul UE–SUA de protecție a datelor (art. 45 GDPR). La cerere îți trimitem lista furnizorilor, cu temeiul fiecăruia, și o copie a clauzelor.",
      ],
    },
    {
      heading: "7. Cât timp păstrăm datele",
      paragraphs: [
        "Înscrierile și declarațiile semnate: trei ani de la eveniment (termenul general de prescripție, art. 2517 din Codul civil); cele electronice se șterg automat, cele pe hârtie le distruge clubul la același termen. O înscriere a cărei adresă de e-mail nu a fost confirmată: 30 de zile. Seria și numărul actului de identitate și nota de sănătate: șapte zile de la eveniment (nota, mai devreme, dacă îți retragi consimțământul). Datele tale de participant (numele și adresa de e-mail): odată cu ultima ta înscriere. Copiile din căsuța clubului (secțiunea 6): trei ani de la eveniment. Mesajele din formularul de contact: 12 luni de la ultimul mesaj al conversației. Listele exportate și foile tipărite pentru ziua cursei: distruse în cel mult 30 de zile de la eveniment. Evidența e-mailurilor trimise: 90 de zile; un mesaj nelivrat, cât înscrierea, sau 90 de zile dacă nu ține de o înscriere. Legăturile folosite sau expirate: 30 de zile. Contoarele anti-abuz: o zi. Jurnalul echipei (art. 5(2) GDPR): trei ani, fără identitatea unei persoane șterse. Versiunea notei și consimțămintele: cât înscrierea (art. 7(1) GDPR). Copiile de siguranță ale bazei de date: încă cel mult șapte zile după o ștergere. Jurnalele furnizorilor: găzduirea, cel mult o oră; Mailgun, cât prevede planul contului, iar o adresă care a respins mesajele rămâne în lista lui de blocare până o scoatem. Lista publică: cât este pornită. Fotografiile: până le scoatem sau te opui.",
      ],
    },
    {
      heading: "8. Drepturile tale",
      paragraphs: [
        "Ce poți face singur. Din „Înscrierile mele” (legătura îți vine pe e-mail) îți vezi înscrierile active, starea, numărul și codul QR, renunți la o înscriere, alegi dacă apari pe lista publică și îți ștergi nota de sănătate și conturile de Strava și Instagram. Renunțarea eliberează locul, dar nu șterge datele: înscrierea anulată se păstrează cât scrie în secțiunea 7.",
        "Ce facem la cerere. Scrie la <EMAIL DE CONTACT>, de la adresa înscrierii sau confirmându-ți identitatea (art. 12(6) GDPR); răspundem gratuit în cel mult o lună. Acces: îți trimitem o copie a datelor tale. Rectificare: corectăm datele greșite. Ștergere: eliminăm înscrierea, declarația și, dacă nu mai ai alta, datele tale; jurnalul reține când și de ce, nu cine, iar locul trece primului de pe lista de așteptare. Restricționare. Portabilitate: datele date de tine, într-un fișier. Retragerea consimțământului, oricând, fără efect retroactiv și fără să-ți pierzi locul.",
        "Dreptul la opoziție. Te poți opune oricând prelucrărilor bazate pe interesul nostru legitim — păstrarea ca dovadă, fotografiile, jurnalul, verificarea anti-roboți, copiile din căsuța clubului. Oprim prelucrarea, dacă nu prevalează motive legitime imperioase ori un drept în instanță; pentru fotografii nu cerem motiv.",
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
        "Fără analiză de trafic, reclame sau urmărire. Ce folosim este strict necesar, deci fără acord (Legea nr. 506/2004, art. 4(6)): schema de culori și un aviz de versiune nouă, în memoria browserului tău, netransmise nouă; două cookie-uri criptate, de cel mult 10 minute, puse doar când trimiți formularul de înscriere, declarația sau formularul de contact — unul păstrează ce ai scris dacă formularul se întoarce cu o eroare, celălalt adresa și prenumele pentru ecranul de confirmare; pentru echipă, cookie-urile de autentificare (sesiunea, 30 de zile, și protecțiile ei de scurtă durată). Limba stă în adresă, nu într-un cookie. Un videoclip YouTube de pe pagina unui eveniment se încarcă doar când apeși pe el; abia atunci Google primește adresa ta IP și își poate pune propriile cookie-uri.",
        "Găzduirea vede adresa IP a fiecărei cereri; jurnalul ei se păstrează cel mult o oră, nelegat de înscrieri. Formularul are un câmp-capcană, o verificare a timpului de completare și limite pe e-mail și pe legătură, păstrate o zi; platforma nu stochează nicio adresă IP. Când verificarea anti-bot este pornită, formularul folosește Cloudflare Turnstile: Cloudflare primește adresa IP și semnalele tehnice ale browserului doar ca să decidă dacă cererea vine de la o persoană, fără cookie-uri de urmărire (temei: art. 6(1)(f) GDPR).",
      ],
    },
    {
      heading: "11. Modificări",
      paragraphs: [
        "Fiecare versiune a notei are număr, dată și amprentă și nu se mai schimbă după aprobare; înscrierea reține versiunea luată la cunoștință. Versiunea în vigoare este la această adresă; o schimbare în substanță o anunțăm pe această pagină și, pentru înscrierile la evenimente care nu au avut loc, pe e-mail, înainte să se aplice.",
      ],
    },
    {
      heading: "12. Echipa clubului",
      paragraphs: [
        "Pentru voluntarii și organizatorii cu acces la platformă păstrăm numele, adresa de e-mail și rolul, cine a făcut ce în platformă și numele celui care a înregistrat o declarație pe hârtie. Contul de autentificare îl ține Zitadel; sesiunea durează 30 de zile. Temei: interesul legitim de a ști cine are acces și cine a acționat (art. 6(1)(f) și art. 5(2) GDPR). Când accesul se retrage, ștergem contul din platformă, iar pe cel din Zitadel la cerere; jurnalul rămâne cel mult trei ani.",
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
        "From the form: first and last name, date of birth, sex, email, telephone and the form's language; optionally, nationality and city. We use them to run the event: places and the waiting list, the messages about your registration and your race number (name and email); age and sex category and whether a minor must be registered by a parent (date of birth and sex); to reach you on race day if needed (telephone); to know where participants come from (nationality and city, optional). Basis: art. 6(1)(b) GDPR — performing the participation agreement. The required ones are marked on the form: without them you cannot register. Your confirmed email address identifies you (no account or password); we also keep it in canonical form, so nobody takes two places.",
        "Your emergency contact: we keep the name and telephone number you give us only to call that person if something happens to you at the event — the legitimate interest of you and the club in telling someone close (art. 6(1)(f) GDPR) and, in an emergency, vital interests (art. 6(1)(d)). Tell them you gave us their details; the rights in section 8 are theirs too. Only the organisers see them, on the event's emergency sheet, and we delete them with the registration.",
        "Optional, same basis: t-shirt size, club, display name and the “Brașov Runners team member” tick — unverified, without effect on your place.",
        "The health note (an allergy, a condition, a medicine) is special-category data, kept only with your explicit consent, ticked separately (art. 6(1)(a) and art. 9(2)(a) GDPR), only so the race organisers know what to do if you need help on race day. It is never required. Only the organisers see it, on the registration's page and the event's emergency sheet; it appears in no participant-list export, email or copy sent to the club (only you receive it, if you ask us for a copy of your data). You withdraw it at any time from “My registrations”, without losing your place.",
        "We also keep the registration's history (states, moments, who acted), race number and check-in: art. 6(1)(b) GDPR; after the registration ends, art. 6(1)(f), as proof that places were given fairly. The platform manages places and the waiting list automatically, by one rule for all — the order in which email addresses are confirmed; a place held and not signed for in time ({{holdMinutes}}, or until the confirmation deadline before the race where the event sets one, or {{offerHours}} for a waiting-list offer) passes automatically to the next person on the waiting list. We do no profiling. We do not consider this a decision with legal or similarly significant effect under art. 22 GDPR, taking part being free, but you may always ask a person on the team to review what happened to your place.",
        "Your date of birth also tells us whether you meet the event's minimum age, where it has one: it is set for each event, shown on its page and counted on the day of the event; we register nobody younger. A minor (under 18 on the day of registering) is registered by a parent or legal guardian with the child's details. The email and telephone on the form are usually the parent's, who then receives every message; we also keep the parent's name and, at signing, the series and number of both the parent's and the minor's identity documents, because both sign the declaration; the parent gives the consents for the child (art. 8 GDPR), and the kit is collected against either one's document — basis art. 6(1)(b) GDPR, the same periods as below. For a minor we keep no Strava or Instagram, and photographs in which a child is the subject are published only with the parent's agreement.",
        "Optional: a link to your Strava profile and your Instagram username — so we can follow you and tag you in the club's posts on those platforms (the tag is visible there); we never publish them on the site or give them to anyone. Basis: your consent (art. 6(1)(a) GDPR), withdrawn at any time from “My registrations”, without affecting your registration.",
      ],
    },
    {
      heading: "3. Declaration and identity document",
      paragraphs: [
        "The declaration of own responsibility confirms your place. We keep the name typed as signature, the text's fingerprint, the moment and how you signed (email or paper, with the recording team member's name), not your IP address. Basis: art. 6(1)(b) GDPR; as evidence after the event, art. 6(1)(f).",
        "It is a simple electronic signature under Regulation (EU) No 910/2014 (eIDAS) and Romanian Law no. 214/2024 on the use of electronic signatures, time stamps and trust services, which cannot be denied legal effect only for being electronic (art. 25(1) eIDAS).",
        "Where the declaration asks, we take your identity document's series and number (for a minor, the co-signing parent's or guardian's too), never a copy, only so that it names you unambiguously and we can hand you your kit: art. 6(1)(b) GDPR, not legitimate interest, as it is a national identification number (art. 2(b) of Romanian Law no. 190/2018 on measures implementing Regulation (EU) 2016/679). Without them you cannot sign the declaration, and without the declaration the place is not confirmed. Only the team sees them, at kit collection; in the declaration copies emailed to the club they are masked (at most the first two and last two characters remain), and we delete them from our database seven days after the event.",
      ],
    },
    {
      heading: "4. Public list, results, photographs",
      paragraphs: [
        "The public participant list, off on every event until the club switches it on, shows only the name (or display name) and club of confirmed participants who ticked “I want to appear on the participant list” when registering, until after the event — consent, art. 6(1)(a) GDPR, withdrawn at any time from “My registrations”, or from the link in your confirmation email; no tick, no listing.",
        "We do not publish results with names yet; when we do, we will ask you separately, for each event.",
        "Photographs and video from events, published in the gallery and on the club's channels: legitimate interest (art. 6(1)(f) GDPR) — showing the club's events; public place, no names, no EXIF. A portrait is published only with your agreement (Romanian Civil Code, art. 73–75). Tell us which and we take it down within a month, no reason needed.",
      ],
    },
    {
      heading: "5. Emails",
      paragraphs: [
        "We send only messages about your registration: confirmations, links, the waiting list, a reminder {{reminderHours}} before and at most one thank-you after the race, about that event — not commercial communications under Romanian Law no. 506/2004 on the processing of personal data and the protection of privacy in the electronic communications sector (art. 12); marketing only with separate consent. Basis: art. 6(1)(b) GDPR. Of each message we keep the address, its facts and delivery state, not the text; links, only as a fingerprint.",
        "\"Tell me when registration opens\": if you leave your address on an event's page before its registration opens, we send you one email, shortly after it opens, with the link to the form. We keep the address on the notification list only until that message is sent and delete it from the list with it (the message itself keeps the address like any other message, see above) — or without a message, if the event is cancelled or registration no longer opens on the site. Basis: your consent (art. 6(1)(a) GDPR), which you can withdraw at any time before it is sent by writing to <CONTACT EMAIL>.",
        "The contact form (\"Write to us\"): it takes your name, email address and message, with the language and the page you wrote from, and sends them as an ordinary email to the club's mailbox (Gmail, section 6), where we keep them at most 12 months from the conversation's last message; the platform keeps no copy. We use them only to answer you — for nothing else. Basis: our legitimate interest in answering what you asked (art. 6(1)(f) GDPR). The form has the same anti-bot defences as the registration form (section 10).",
      ],
    },
    {
      heading: "6. Who else sees it",
      paragraphs: [
        "Processors handle it on our behalf, under contract (art. 28 GDPR): Vercel Inc. — hosting the site (functions in Frankfurt; requests pass through Vercel's global network); Neon, Inc. (Databricks group) — database, Frankfurt; Mailgun Technologies, Inc. (Sinch group) — sending email, EU region; Cloudflare, Inc. — storing photographs, in the EU, and the Turnstile anti-bot check (section 10); Zitadel — the club team's sign-in accounts, no participant data.",
        "The club's mailbox is a Gmail account (Google). Mail to <CONTACT EMAIL> and from the contact form reaches it, as do the copies below; some may be forwarded to organisers' mailboxes. For an ordinary Gmail account, Google also processes data under its own terms, not only on our behalf.",
        "Copies in the club's mailboxes. When you sign the declaration, a PDF copy of it — with your name and the event, and your identity document's series and number masked (at most the first two and last two characters remain) — reaches the club's archive mailbox and at most a few organisers' addresses chosen by the club. The club also receives a short message when you confirm your place (name, event, race number) and may receive a copy of the emails we send you about your registration, without the personal links and without attachments. Basis: our legitimate interest in having declarations and confirmations to hand on race day and as evidence afterwards (art. 6(1)(f) GDPR). We delete these copies three years after the event.",
        "Photographs published on Facebook, Instagram (Meta) or Strava reach those platforms, which process them under their own terms. Data may also reach the authorities where the law requires, and a lawyer over a claim. We never sell it or give it to anyone else.",
        "The data stays in the EU, but Vercel, Neon, Mailgun, Cloudflare and Google are or belong to US companies and may access it from the US. Transfer basis: the European Commission's standard contractual clauses in each one's data processing agreement (art. 46(2)(c) GDPR) and, for certified providers, the EU-U.S. Data Privacy Framework (art. 45 GDPR). On request we send the list of providers with each one's basis and a copy of the clauses.",
      ],
    },
    {
      heading: "7. How long we keep it",
      paragraphs: [
        "Registrations and signed declarations: three years from the event (general limitation period, art. 2517 of the Romanian Civil Code); electronic ones are deleted automatically, paper ones are destroyed by the club at the same point. A registration whose email address was never confirmed: 30 days. Identity document series and number, and the health note: seven days from the event (the note sooner, if you withdraw consent). Your participant details (name and email address): with your last registration. Copies in the club's mailbox (section 6): three years from the event. Contact-form messages: 12 months from the conversation's last message. Exported lists and printed race-day sheets: destroyed within 30 days of the event. Sent-email records: 90 days; an undelivered message, as long as the registration, or 90 days if it belongs to none. Used or expired links: 30 days. Anti-abuse counters: one day. The team's log (art. 5(2) GDPR): three years, without an erased person's identity. Notice version and consents: as long as the registration (art. 7(1) GDPR). Database backups: at most seven days more after a deletion. Providers' logs: hosting, at most one hour; Mailgun, per the account's plan, and an address that bounced stays on its suppression list until we remove it. The public list: while on. Photographs: until removed or you object.",
      ],
    },
    {
      heading: "8. Your rights",
      paragraphs: [
        "What you can do yourself. From “My registrations” (the link comes by email) you see your active registrations, their state, number and QR code, cancel a registration, choose whether you appear on the public list, and delete your health note and your Strava and Instagram. Cancelling frees the place but does not delete the data: a cancelled registration is kept as section 7 says.",
        "What we do on request. Write to <CONTACT EMAIL> from the registered address, or confirm your identity (art. 12(6) GDPR); we answer free of charge within one month. Access: we send you a copy of your data. Rectification: we correct what is wrong. Erasure: we remove the registration, the declaration and, if you have no other, your details; the log keeps when and why, not who, and the place passes to the first on the waiting list. Restriction. Portability: the data you gave, as a file. Withdrawing consent, at any time, without retroactive effect and without losing your place.",
        "Your right to object. You may object at any time to processing based on our legitimate interest — keeping evidence, photographs, the log, the anti-bot check, the copies in the club's mailbox. We stop unless compelling legitimate grounds or a legal claim prevail; for photographs we ask no reason.",
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
        "No traffic analytics, advertising or tracking. What we use is strictly necessary and needs no consent (Romanian Law no. 506/2004, art. 4(6)): the colour scheme and a new-version notice, in your browser's own storage, never sent to us; two encrypted cookies lasting at most 10 minutes, set only when you submit the registration form, the declaration or the contact form — one keeps what you typed if the form comes back with an error, the other your address and first name for the confirmation screen; for the team, the sign-in cookies (the session, 30 days, and its short-lived protections). The language is in the address, not a cookie. A YouTube video on an event page loads only when you press it; only then does Google receive your IP address and may set its own cookies.",
        "Hosting sees each request's IP address; its log is kept at most one hour, unlinked to registrations. The form has a trap field, a fill-time check and limits per email and per link, kept one day; the platform stores no IP address. When the anti-bot check is on, the form uses Cloudflare Turnstile: Cloudflare receives the IP address and the browser's technical signals only to decide whether the request comes from a person, with no tracking cookies (basis: art. 6(1)(f) GDPR).",
      ],
    },
    {
      heading: "11. Changes",
      paragraphs: [
        "Every version of this notice is numbered, dated, fingerprinted and never changes after approval; your registration records the version you acknowledged. The version in force is at this address; a material change is announced on this page and, for registrations to events not yet held, by email, before it applies.",
      ],
    },
    {
      heading: "12. The club's team",
      paragraphs: [
        "For volunteers and organisers with access to the platform we keep name, email address and role, who did what on the platform, and the name of whoever recorded a paper declaration. Zitadel holds the sign-in account; a session lasts 30 days. Basis: our legitimate interest in knowing who has access and who acted (art. 6(1)(f) and art. 5(2) GDPR). When access is withdrawn we delete the account on the platform, and the Zitadel one on request; the log stays at most three years.",
      ],
    },
  ],
};
