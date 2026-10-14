import type { LegalDocumentBody } from "../domain/content-hash";

/**
 * The volunteer agreement («Contract de voluntariat», §758, amending §754).
 *
 * The owner, 2026-10-13, right after the volunteers feature shipped: «trebuie să avem și un document gen
 * „contract de voluntariat” simplu, unde zicem că nu sunt plătiți, că trebuie să respecte atribuțiunile, bla
 * bla bla». So: a short contract in plain words that every volunteer of an event accepts before being listed —
 * on the event page's form, from the single-use link an organizer sends to a person entered by hand, or on a
 * printed copy at the desk — approved by the club in `/admin/legal` like every other text (§29, §95, §418).
 *
 * **What it says, section by section.** Who the parties are (the club by its four facts, §132; the volunteer by
 * name); what the help is — the event, its date and place, the role and what it asks, all merge fields filled
 * when the person accepts, so one approved text serves every event and every role (§357); that it is unpaid,
 * and that the club may cover costs announced beforehand, which are not pay; what the volunteer undertakes (the
 * role's tasks, the organizers' instructions, safety and the event's rules, the confidentiality of the
 * participants' data seen at the desk, telling the organizers when they cannot come); what the club undertakes
 * (information about the role and its risks, the means to do it, a contact on the day, a volunteer certificate
 * on request); how long it lasts; that either side may end it at any time by telling the other; a pointer to the
 * privacy notice for the data; and the law it is made under.
 *
 * **For the lawyer, not decided here.** Romania's volunteering law, Legea nr. 78/2014, is named; a lawyer
 * checks the wording against it before the club approves — whether the written form it asks for is met by an
 * electronic acceptance (a typed name, a tick, the moment and the text's fingerprint, the simple electronic
 * signature the declarations already use, §556) or needs the paper copy the desk prints; whether the role's
 * description is enough as the volunteer's task sheet; whether the club must insure its volunteers; whether it
 * must keep a register of volunteer agreements, which the platform's thirty-day deletion of the volunteers'
 * rows (§754) would not be — so the text promises only what the platform does: the volunteer's copy by email
 * (after the form, the link and the paper alike) and the proof kept «cât timp spune nota de confidențialitate»;
 * whether to keep a narrowed acceptance record longer, or to send the club an archive copy as the declarations do,
 * is the owner's and the lawyer's to decide before the club approves the text; and the age: the text states the platform's minimum, fourteen
 * (`VOLUNTEER_MINIMUM_AGE`, through `{{minimumAge}}`) — and, since §NNN, a person of fourteen to seventeen volunteers with a parent's or
 * guardian's agreement (see the minors' clause below).
 *
 * **The minors' clause (§NNN, amending §758; the owner, 2026-10-14: «voluntarii trebuie să aibă cel puțin 14 ani, nu 18» and
 * «fă cu acord ceva»).** Four sentences name `{{volunteerGuardian}}` — the parent's or guardian's name — and so drop whole for an
 * adult (`PARAGRAPH_MERGE_FIELDS`): the guardian's consent given by accepting this same text in their own name, from a link or
 * on paper, and the minor's confirmation only after it (§1); the activities suited to the age and no night or dangerous posts
 * (§6); the guardian's data, kept for the same purpose (§8); and how the guardian accepts (§9). A text that names the marker is
 * what lets the club take a person under eighteen (`namesVolunteerGuardian`, with the notice's `{{volunteerMinors}}`);
 * until both are in force in every language the form refuses an age under eighteen. **For the lawyer, not decided here:**
 * Legea nr. 78/2014 has its own rules on the age and the consent of minors who volunteer — whether fourteen is the right
 * floor, whether a parent's electronic acceptance of this text is the form of consent it asks, what «activități potrivite
 * vârstei» must exclude, and whether the club must keep the guardian's consent beyond the thirty days — and the wording of the
 * four sentences is the lawyer's to confirm before the club approves them.
 *
 * **Several roles (§761, amending §758).** A volunteer ticks every role they would do and the organizers give one
 * afterwards, so a person accepting on the form has no role yet. The text says it in its own sentences: «Voluntarul
 * are rolul {{volunteerRole}}.» when a role is given, «Rolul îl stabilesc organizatorii dintre cele pentru care
 * voluntarul s-a oferit — {{volunteerRoleChoices}} — și i-l comunică pe email.» while none is, each dropped whole when
 * its field is empty, and «Ce presupune fiecare rol: {{volunteerChoiceTasks}}.» beside «Ce presupune rolul: …». A
 * lawyer reads these with the rest: whether accepting before the role is fixed, among the roles named, is enough.
 *
 * **No hardcoded value (§357).** Nothing names a club, an event, a place, a date, an amount or an age: the
 * club by its four `<PLACEHOLDER>`s, the rest by merge fields. The laws cited and the emergency number stay
 * written in, as in every text.
 */

const partiesRo = [
  "Organizația gazdă este <DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI>, cu sediul în <ADRESA SEDIULUI>, <NUMĂR DE ÎNREGISTRARE / CUI>, care poate fi contactată la <EMAIL DE CONTACT> (numită mai jos „organizatorul”).",
  "Voluntarul este {{volunteer}}.",
  // The platform's minimum age for a volunteer (§758): the one sentence of age, filled from the code.
  "Voluntarul declară că are cel puțin {{minimumAge}} împliniți.",
  // The minors' clause (§NNN): dropped whole for an adult, whose `{{volunteerGuardian}}` is "".
  "Voluntarul fiind minor, părintele sau tutorele său, {{volunteerGuardian}}, își dă acordul ca el să fie voluntar la acest eveniment, în condițiile acestui contract, acceptându-l separat, în nume propriu, din legătura primită pe e-mail sau pe hârtie, la organizatori. Voluntarul minor este confirmat numai după acest acord.",
];

const partiesEn = [
  "The host organisation is <THE CLUB'S FULL LEGAL NAME>, with its registered seat at <REGISTERED ADDRESS>, <REGISTRATION NUMBER>, which can be contacted at <CONTACT EMAIL> (below, “the organiser”).",
  "The volunteer is {{volunteer}}.",
  "The volunteer declares that they are at least {{minimumAge}} old.",
  "The volunteer being a minor, their parent or guardian, {{volunteerGuardian}}, agrees that they volunteer at this event, under this agreement, by accepting it separately, in their own name, from the link received by email or on paper, with the organisers. A minor volunteer is confirmed only after this consent.",
];

const activityRo = [
  "Voluntarul ajută la evenimentul {{event}}, care are loc {{eventDate}}, în {{eventLocation}}.",
  // The role given and the roles offered for (§761): each sentence is dropped whole when its field is "" (`PARAGRAPH_MERGE_FIELDS`) —
  // a role given keeps the first and its tasks, none given keeps the choices and what each asks.
  "Voluntarul are rolul {{volunteerRole}}.",
  "Rolul îl stabilesc organizatorii dintre cele pentru care voluntarul s-a oferit — {{volunteerRoleChoices}} — și i-l comunică pe email.",
  // Dropped whole for a role with no description (`PARAGRAPH_MERGE_FIELDS`).
  "Ce presupune rolul: {{volunteerTasks}}.",
  "Ce presupune fiecare rol: {{volunteerChoiceTasks}}.",
  "Ora și locul de întâlnire și sarcinile concrete ale rolului le stabilesc organizatorii împreună cu voluntarul, înainte de eveniment.",
];

const activityEn = [
  "The volunteer helps at the event {{event}}, which takes place on {{eventDate}}, at {{eventLocation}}.",
  "The volunteer's role is {{volunteerRole}}.",
  "The organisers choose the role from those the volunteer offered to do — {{volunteerRoleChoices}} — and tell the volunteer by email.",
  "What the role involves: {{volunteerTasks}}.",
  "What each role involves: {{volunteerChoiceTasks}}.",
  "The meeting time and place and the role's concrete tasks are agreed between the organisers and the volunteer before the event.",
];

const unpaidRo = [
  "Voluntariatul este o activitate de interes public, pe care voluntarul o face din proprie inițiativă și fără plată.",
  "Voluntarul nu primește salariu, onorariu sau altă plată pentru activitatea sa. Acest contract nu este un contract de muncă.",
  "Organizatorul poate acoperi cheltuieli legate direct de activitate, dacă le anunță dinainte, de exemplu apa și mâncarea din ziua evenimentului sau echipamentul rolului. Ele nu sunt o plată pentru activitate.",
];

const unpaidEn = [
  "Volunteering is an activity of public interest, which the volunteer takes up of their own free will and without pay.",
  "The volunteer receives no salary, fee or other payment for their activity. This agreement is not an employment contract.",
  "The organiser may cover costs directly linked to the activity, if it announces them beforehand, for example water and food on the day of the event or the role's equipment. They are not a payment for the activity.",
];

const volunteerDutiesRo = [
  "Voluntarul se obligă:",
  "• să îndeplinească sarcinile rolului său, cu grijă și la timp;",
  "• să respecte indicațiile organizatorilor din ziua evenimentului;",
  "• să respecte regulile de siguranță, regulamentul evenimentului și regulile de circulație, unde rolul este pe drum sau lângă el;",
  "• să păstreze confidențialitatea datelor personale ale participanților pe care le vede — nume, numere de concurs, date de contact, stare de sănătate — și să nu le copieze, să nu le fotografieze și să nu le transmită nimănui, nici după eveniment;",
  "• să anunțe organizatorii cât mai devreme dacă nu poate veni sau dacă trebuie să plece mai devreme;",
  "• să se poarte cu respect față de participanți, de ceilalți voluntari și de public;",
  "• să nu participe sub influența alcoolului, a drogurilor ori a altor substanțe care îi afectează atenția.",
];

const volunteerDutiesEn = [
  "The volunteer undertakes:",
  "• to carry out the tasks of their role, with care and on time;",
  "• to follow the organisers' instructions on the day of the event;",
  "• to follow the safety rules, the event's rules and the traffic rules, where the role is on or beside a road;",
  "• to keep confidential the participants' personal data they see — names, race numbers, contact details, health information — and not to copy, photograph or pass it to anyone, during or after the event;",
  "• to tell the organisers as early as possible if they cannot come or must leave early;",
  "• to treat the participants, the other volunteers and the public with respect;",
  "• not to take part under the influence of alcohol, drugs or other substances that impair their attention.",
];

const clubDutiesRo = [
  "Organizatorul se obligă:",
  "• să îi spună voluntarului, înainte de eveniment, ce presupune rolul, programul și riscurile lui — de exemplu statul în picioare multe ore, vremea sau traficul de lângă traseu;",
  "• să îi dea mijloacele de care rolul are nevoie: instrucțiunile, materialele și un semn după care participanții îl recunosc ca voluntar;",
  "• să îi numească o persoană de contact pentru ziua evenimentului;",
  "• să îi elibereze, la cerere, un certificat de voluntariat;",
  "• să îi prelucreze datele personale numai așa cum spune nota de confidențialitate a clubului.",
];

const clubDutiesEn = [
  "The organiser undertakes:",
  "• to tell the volunteer, before the event, what the role involves, its schedule and its risks — for example standing for many hours, the weather or the traffic beside the course;",
  "• to give them the means the role needs: the instructions, the materials and a sign by which the participants recognise them as a volunteer;",
  "• to name a contact person for the day of the event;",
  "• to issue them, on request, a volunteer certificate;",
  "• to process their personal data only as the club's privacy notice says.",
];

const safetyRo = [
  "Voluntarul poate refuza o sarcină pe care o consideră nesigură; spune acest lucru persoanei de contact, care îi dă altă sarcină sau îl înlocuiește. În caz de urgență sună la 112 și anunță organizatorii.",
  "Voluntarului minor organizatorul îi dă numai activități potrivite vârstei sale și nu îl pune pe posturi de noapte sau periculoase, de exemplu pe un drum circulat fără un adult responsabil lângă el. Părintele sau tutorele, {{volunteerGuardian}}, poate retrage oricând acordul, anunțând organizatorul; voluntarul minor încetează atunci activitatea.",
];

const safetyEn = [
  "The volunteer may refuse a task they consider unsafe; they tell the contact person, who gives them another task or replaces them. In an emergency they call 112 and tell the organisers.",
  "The organiser gives a minor volunteer only activities suited to their age and puts them on no night or dangerous posts, for example on a road with traffic without a responsible adult beside them. The parent or guardian, {{volunteerGuardian}}, may withdraw the consent at any time by telling the organiser; the minor volunteer then stops the activity.",
];

const durationRo = [
  "Contractul se aplică zilei evenimentului și zilelor de pregătire sau de strângere de care rolul are nevoie, stabilite împreună cu organizatorii. Se încheie după eveniment, odată cu sarcinile rolului.",
  "Oricare parte poate pune capăt contractului oricând, anunțând-o pe cealaltă, prin email sau prin telefon. Voluntarul anunță cât mai devreme, ca organizatorii să găsească pe altcineva.",
];

const durationEn = [
  "The agreement applies to the day of the event and to the days of preparation or clearing up the role needs, agreed with the organisers. It ends after the event, together with the role's tasks.",
  "Either party may end the agreement at any time by telling the other, by email or by telephone. The volunteer tells the organisers as early as possible, so they can find someone else.",
];

const dataRo = [
  "Datele voluntarului — numele, adresa de email, numărul de telefon și rolul — sunt prelucrate de organizator pentru organizarea ajutorului la eveniment și ca dovadă a acestui contract, conform Regulamentului (UE) 2016/679 (GDPR) și notei de confidențialitate a clubului, publicată pe site-ul clubului, care spune cât timp se păstrează și ce drepturi are voluntarul. Pentru ele, voluntarul scrie la <EMAIL DE CONTACT>.",
  "Datele părintelui sau tutorelui, {{volunteerGuardian}} — numele, adresa de email și acceptarea contractului — sunt prelucrate de organizator pentru același scop, în aceleași condiții, iar părintele sau tutorele are aceleași drepturi, pe care le exercită scriind la <EMAIL DE CONTACT>.",
];

const dataEn = [
  "The volunteer's data — their name, email address, telephone number and role — is processed by the organiser to organise the help at the event and as evidence of this agreement, under Regulation (EU) 2016/679 (GDPR) and the club's privacy notice, published on the club's website, which says how long it is kept and what rights the volunteer has. For them, the volunteer writes to <CONTACT EMAIL>.",
  "The data of the parent or guardian, {{volunteerGuardian}} — their name, email address and acceptance of the agreement — is processed by the organiser for the same purpose, on the same terms, and the parent or guardian has the same rights, which they exercise by writing to <CONTACT EMAIL>.",
];

const lawRo = [
  "Contractul se încheie potrivit Legii nr. 78/2014 privind reglementarea activității de voluntariat în România și se completează cu prevederile Codului civil.",
  // «Momentul acceptării» as the platform records it (§534's words for the declarations), never a time stamp.
  "Voluntarul acceptă contractul electronic — numele, bifa de acceptare, momentul acceptării ({{signedAt}}) și amprenta textului citit sunt înregistrate împreună de platforma clubului — sau îl semnează pe hârtie, la organizatori. Voluntarul primește pe email o copie a contractului acceptat, ca PDF. Clubul păstrează dovada acceptării cât timp spune nota de confidențialitate.",
  "Părintele sau tutorele, {{volunteerGuardian}}, acceptă contractul în nume propriu, electronic — numele scris, bifa de acceptare, momentul acceptării ({{signedAt}}) și amprenta textului citit sunt înregistrate împreună de platforma clubului — sau îl semnează pe hârtie, la organizatori.",
];

const lawEn = [
  "The agreement is made under Romanian Law no. 78/2014 on volunteering in Romania and is completed by the Romanian Civil Code.",
  "The volunteer accepts the agreement electronically — the name, the acceptance tick, the moment of acceptance ({{signedAt}}) and the fingerprint of the text read are recorded together by the club's platform — or signs it on paper, with the organisers. The volunteer receives a copy of the accepted agreement by email, as a PDF. The club keeps the proof of acceptance for as long as the privacy notice says.",
  "The parent or guardian, {{volunteerGuardian}}, accepts the agreement in their own name, electronically — the typed name, the acceptance tick, the moment of acceptance ({{signedAt}}) and the fingerprint of the text read are recorded together by the club's platform — or signs it on paper, with the organisers.",
];

export const volunteerAgreementRo: LegalDocumentBody = {
  sections: [
    { heading: "1. Părțile", paragraphs: partiesRo },
    { heading: "2. Activitatea", paragraphs: activityRo },
    { heading: "3. Fără plată", paragraphs: unpaidRo },
    { heading: "4. Ce face voluntarul", paragraphs: volunteerDutiesRo },
    { heading: "5. Ce face organizatorul", paragraphs: clubDutiesRo },
    { heading: "6. Siguranța", paragraphs: safetyRo },
    { heading: "7. Durata și încetarea", paragraphs: durationRo },
    { heading: "8. Datele personale", paragraphs: dataRo },
    { heading: "9. Legea aplicabilă și acceptarea", paragraphs: lawRo },
  ],
};

export const volunteerAgreementEn: LegalDocumentBody = {
  sections: [
    { heading: "1. The parties", paragraphs: partiesEn },
    { heading: "2. The activity", paragraphs: activityEn },
    { heading: "3. No pay", paragraphs: unpaidEn },
    { heading: "4. What the volunteer does", paragraphs: volunteerDutiesEn },
    { heading: "5. What the organiser does", paragraphs: clubDutiesEn },
    { heading: "6. Safety", paragraphs: safetyEn },
    { heading: "7. Duration and ending", paragraphs: durationEn },
    { heading: "8. Personal data", paragraphs: dataEn },
    { heading: "9. Governing law and acceptance", paragraphs: lawEn },
  ],
};
