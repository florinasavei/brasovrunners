import type { LegalDocumentBody } from "../domain/content-hash";

/**
 * «Angajament de confidențialitate și protecția datelor pentru echipă» (§1006; the owner, 2026-11-19: «Voluntarii trebuie să
 * semneze acordul GDPR când intră în platformă» — the volunteers must sign the GDPR agreement when they enter the platform).
 *
 * One text for the club's whole team below the Administrator — the volunteer, the Redactor, the Organizer, the Tehnic — accepted
 * on `/admin/acord` at every sign-in since §1026 (once per version under §1006), before any backoffice page, action or route answers
 * them, and approved by the club in
 * `/admin/legal` like every other text (§29, §95, §418). Until a version is in force nobody is asked: a text the club has not
 * approved binds nobody. It is not the volunteer agreement (§758), which an event's volunteer accepts for one event and one role and
 * which keeps its own confidentiality clause for the desk; this one is for an account in the backoffice, whatever the role.
 *
 * **What it says, section by section.** Who accepts it (the club by its four facts, §132; the colleague by the name they type) and
 * that it is neither a contract of employment nor a volunteering contract; that the colleague acts under the club's authority and on
 * its instructions — GDPR art. 29 and 32(4), named as every template names the regulation; which data they may see and that they use
 * it only for their role's tasks; that they keep it confidential during and after the role; no copies, exports, photographs or
 * screenshots beyond what the task needs, a file kept safe and deleted after, and nothing sent outside the team; a printed list kept
 * safe on race day and handed back or destroyed after; the account personal and the session never left open unattended; a lost
 * phone, a wrong recipient or any incident told to the club at once, at its contact address, the club deciding what follows (art. 33
 * and 34); access withdrawn when the role ends or the undertaking is broken; and, last, what the club keeps of the colleague and of
 * the acceptance — what the platform records, nothing more — the law it is made under and the courts.
 *
 * **For the lawyer, not decided here.** Whether an undertaking accepted electronically at sign-in is the right instrument under art.
 * 29 and 32(4), or the club wants a signed confidentiality agreement or an annex to the volunteer contract as well; whether
 * confidentiality «fără limită de timp» is the wording to keep; whether the club may ask a volunteer for damages, and how the
 * sentence on liability should read; whether a colleague under eighteen with an account needs a parent's agreement too; how long the
 * club keeps the acceptance — the platform deletes it with the account, when access is taken away, which may be before a breach after
 * the role comes to light; and whether section 12 of the privacy notice should name the acceptance in its own words. The text
 * promises only what the platform does: the acceptance at every sign-in (§1026) and again for a new version, each one recorded with
 * the sign-in it answers, the access withdrawn. Section 10 said «la prima intrare» until §1026; a version the club approved with
 * those words stays in force with them until the club approves the regenerated draft — the platform approves nothing (§29).
 *
 * **No hardcoded value (§357).** Nothing names a club, a place, a person or a date: the club by its four `<PLACEHOLDER>`s, the
 * colleague by the name typed at the acceptance, which the text does not repeat. The laws cited and the regulation stay written in,
 * as in every text.
 */

const partiesRo = [
  "Organizația este <DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI>, cu sediul în <ADRESA SEDIULUI>, <NUMĂR DE ÎNREGISTRARE / CUI>, care poate fi contactată la <EMAIL DE CONTACT> (numită mai jos „clubul”).",
  "Angajamentul îl acceptă, înainte de a lucra în platforma clubului, fiecare persoană care primește în ea un cont de voluntar, redactor, organizator sau tehnic, cu numele complet pe care îl scrie la acceptare (numită mai jos „membrul echipei”).",
  "Angajamentul nu este un contract de muncă și nici un contract de voluntariat: nu creează un raport de muncă, nu dă dreptul la o plată și nu înlocuiește contractul de voluntariat pe care voluntarii unui eveniment îl acceptă separat.",
];

const partiesEn = [
  "The organisation is <THE CLUB'S FULL LEGAL NAME>, with its registered seat at <REGISTERED ADDRESS>, <REGISTRATION NUMBER>, which can be contacted at <CONTACT EMAIL> (below, “the club”).",
  "The undertaking is accepted, before working on the club's platform, by every person who receives an account on it as a volunteer, copywriter, organiser or technical colleague, with the full name they type when accepting (below, “the team member”).",
  "The undertaking is neither a contract of employment nor a volunteering contract: it creates no employment relationship, gives no right to any payment and does not replace the volunteer agreement that an event's volunteers accept separately.",
];

const authorityRo = [
  "Clubul este operatorul datelor personale din platformă. Membrul echipei le prelucrează numai sub autoritatea clubului și numai la instrucțiunile lui, în sensul art. 29 și al art. 32 alin. (4) din Regulamentul (UE) 2016/679 (GDPR).",
  "Instrucțiunile clubului sunt rolul primit în platformă, sarcinile date de organizatorii clubului și acest angajament. Când nu știe dacă o sarcină îi permite să folosească anumite date, membrul echipei întreabă clubul înainte.",
];

const authorityEn = [
  "The club is the controller of the personal data on the platform. The team member processes it only under the club's authority and only on its instructions, within the meaning of Article 29 and Article 32(4) of Regulation (EU) 2016/679 (GDPR).",
  "The club's instructions are the role given on the platform, the tasks given by the club's organisers and this undertaking. When unsure whether a task allows them to use certain data, the team member asks the club first.",
];

const purposeRo = [
  "În platformă, membrul echipei poate vedea date personale ale participanților la evenimente, ale voluntarilor și ale membrilor clubului — de exemplu nume, date de contact, numere de concurs, date de naștere, persoane de contact pentru urgențe sau o stare de sănătate declarată.",
  "Membrul echipei folosește aceste date numai pentru sarcinile rolului său și numai cât îi trebuie pentru ele — de exemplu ca să predea un număr de concurs, să înregistreze o sosire sau să răspundă unui participant.",
  "Nu le folosește în scop personal, comercial sau politic, nu le adaugă la alte liste sau baze de date și nu caută în platformă persoane fără legătură cu sarcina lui.",
];

const purposeEn = [
  "On the platform, the team member may see personal data of the events' participants, of the volunteers and of the club's members — for example names, contact details, race numbers, dates of birth, emergency contacts or a declared health condition.",
  "The team member uses this data only for the tasks of their role and only as far as those tasks need it — for example to hand over a race number, to record a finish or to answer a participant.",
  "They do not use it for personal, commercial or political purposes, do not add it to other lists or databases and do not look up on the platform people unconnected with their task.",
];

const confidentialityRo = [
  "Membrul echipei păstrează confidențialitatea datelor pe care le vede, cât timp are rolul și după ce rolul se încheie, fără limită de timp.",
  "Nu le dezvăluie nimănui din afara echipei clubului — familiei, prietenilor, altor cluburi, pe rețelele sociale — și nici colegilor din echipă care nu au nevoie de ele pentru sarcina lor.",
];

const confidentialityEn = [
  "The team member keeps the data they see confidential, while they hold the role and after the role ends, without any time limit.",
  "They disclose it to nobody outside the club's team — family, friends, other clubs, on social media — nor to team colleagues who do not need it for their task.",
];

const copiesRo = [
  "Membrul echipei nu face copii, exporturi, fotografii, capturi de ecran sau înregistrări ale datelor din platformă decât dacă sarcina lui o cere, și numai cât o cere.",
  "Un fișier descărcat pentru o sarcină — o listă, un PDF, numerele de concurs — îl păstrează numai pe un dispozitiv protejat cu parolă, cod sau amprentă și îl șterge când sarcina s-a încheiat. Nu îl trimite pe e-mail, prin aplicații de mesagerie sau pe rețelele sociale nimănui din afara echipei clubului.",
];

const copiesEn = [
  "The team member makes no copies, exports, photographs, screenshots or recordings of data from the platform unless their task requires it, and only as far as it requires it.",
  "A file downloaded for a task — a list, a PDF, the race numbers — is kept only on a device protected by a password, a code or a fingerprint and deleted when the task is over. They do not send it by email, through messaging apps or on social media to anyone outside the club's team.",
];

const printedRo = [
  "O listă tipărită — de participanți, de voluntari, de urgență — membrul echipei o ține la el sau într-un loc supravegheat în ziua evenimentului, nu o lasă la vedere și nu o dă din mână.",
  "După eveniment, o predă organizatorilor sau o distruge, astfel încât să nu mai poată fi citită.",
];

const printedEn = [
  "A printed list — of participants, of volunteers, for emergencies — is kept by the team member on them or in a supervised place on the day of the event, never left in view and never handed out.",
  "After the event, they hand it back to the organisers or destroy it so that it can no longer be read.",
];

const accountRo = [
  "Contul este personal: membrul echipei nu își dă parola nimănui, nu folosește contul altcuiva și nu lasă pe altcineva să lucreze în contul lui.",
  "Nu lasă sesiunea deschisă nesupravegheată: pe un telefon sau un calculator care nu este al lui iese din cont la final, iar pe al lui îl blochează cu parolă, cod sau amprentă.",
];

const accountEn = [
  "The account is personal: the team member gives their password to nobody, uses nobody else's account and lets nobody else work in theirs.",
  "They never leave the session open unattended: on a phone or a computer that is not theirs they sign out when they finish, and they lock their own with a password, a code or a fingerprint.",
];

const incidentsRo = [
  "Membrul echipei anunță clubul imediat, la <EMAIL DE CONTACT> sau prin organizatorii zilei, dacă își pierde telefonul sau calculatorul cu care intră în platformă ori acesta îi este furat, dacă a trimis date unei persoane greșite, dacă s-a pierdut o listă tipărită, dacă crede că altcineva i-a folosit contul sau dacă observă orice altă situație în care datele pot ajunge la cine nu trebuie.",
  "Anunță și când nu este sigur că s-a întâmplat ceva. Clubul hotărăște ce este de făcut, inclusiv dacă anunță autoritatea de supraveghere sau persoanele vizate (art. 33 și 34 GDPR); membrul echipei nu încearcă să rezolve singur incidentul și nu îi șterge urmele.",
];

const incidentsEn = [
  "The team member tells the club at once, at <CONTACT EMAIL> or through the day's organisers, if the phone or computer they use for the platform is lost or stolen, if they sent data to the wrong person, if a printed list was lost, if they think someone else used their account, or if they notice any other situation in which data may reach someone who should not have it.",
  "They tell the club even when unsure that something happened. The club decides what is to be done, including whether to notify the supervisory authority or the people concerned (Articles 33 and 34 GDPR); the team member does not try to deal with the incident alone and does not erase its traces.",
];

const endRo = [
  "Clubul retrage accesul când rolul se încheie, când membrul echipei cere asta sau dacă angajamentul este încălcat; în acest ultim caz, îl poate retrage imediat, fără preaviz.",
  "Când rolul se încheie, membrul echipei predă clubului sau distruge listele și fișierele cu date pe care le mai are. Confidențialitatea rămâne și după aceea.",
  "O încălcare a angajamentului poate atrage, pe lângă retragerea accesului, și răspunderea membrului echipei, în condițiile legii.",
];

const endEn = [
  "The club withdraws access when the role ends, when the team member asks for it or if the undertaking is broken; in that last case it may withdraw it at once, without notice.",
  "When the role ends, the team member hands back to the club or destroys any lists and files with data they still hold. Confidentiality remains after that.",
  "A breach of the undertaking may lead, besides the withdrawal of access, to the team member's liability, as the law provides.",
];

const dataRo = [
  "Clubul prelucrează datele membrului echipei — numele, adresa de e-mail, rolul și acceptarea acestui angajament — așa cum spune nota de confidențialitate a clubului, publicată pe site-ul clubului, care spune și cât timp le păstrează și ce drepturi are membrul echipei. Pentru ele, membrul echipei scrie la <EMAIL DE CONTACT>.",
  "Membrul echipei acceptă angajamentul electronic, la fiecare intrare în platformă, cât timp o versiune aprobată de club este în vigoare: la fiecare acceptare, numele complet scris, bifa de acceptare, momentul acceptării, intrarea în platformă la care răspunde, versiunea și amprenta textului citit, adresa IP și browserul din care a acceptat sunt înregistrate împreună de platforma clubului. O versiune nouă a angajamentului se acceptă din nou, înainte de a lucra mai departe.",
  "Angajamentul se completează cu prevederile Regulamentului (UE) 2016/679, ale Legii nr. 190/2018 privind măsuri de punere în aplicare a acestuia și ale Codului civil. O neînțelegere care nu se rezolvă pe cale amiabilă se judecă de instanțele competente din România.",
];

const dataEn = [
  "The club processes the team member's data — their name, email address, role and acceptance of this undertaking — as the club's privacy notice says, published on the club's website, which also says how long it is kept and what rights the team member has. For them, the team member writes to <CONTACT EMAIL>.",
  "The team member accepts the undertaking electronically, each time they enter the platform while a version approved by the club is in force: at every acceptance, the full name typed, the acceptance tick, the moment of acceptance, the entry into the platform it answers, the version and the fingerprint of the text read, the IP address and the browser it was accepted from are recorded together by the club's platform. A new version of the undertaking is accepted again, before working on.",
  "The undertaking is completed by Regulation (EU) 2016/679, by Romanian Law no. 190/2018 implementing it and by the Romanian Civil Code. A disagreement not settled amicably is decided by the competent courts of Romania.",
];

export const teamAgreementRo: LegalDocumentBody = {
  sections: [
    { heading: "1. Clubul și membrul echipei", paragraphs: partiesRo },
    { heading: "2. Sub autoritatea clubului", paragraphs: authorityRo },
    { heading: "3. Ce date și pentru ce", paragraphs: purposeRo },
    { heading: "4. Confidențialitatea", paragraphs: confidentialityRo },
    { heading: "5. Copii, fișiere, fotografii", paragraphs: copiesRo },
    { heading: "6. Listele tipărite", paragraphs: printedRo },
    { heading: "7. Contul și sesiunea", paragraphs: accountRo },
    { heading: "8. Incidentele", paragraphs: incidentsRo },
    { heading: "9. Încheierea rolului", paragraphs: endRo },
    { heading: "10. Datele membrului echipei, acceptarea și legea", paragraphs: dataRo },
  ],
};

export const teamAgreementEn: LegalDocumentBody = {
  sections: [
    { heading: "1. The club and the team member", paragraphs: partiesEn },
    { heading: "2. Under the club's authority", paragraphs: authorityEn },
    { heading: "3. Which data, and what for", paragraphs: purposeEn },
    { heading: "4. Confidentiality", paragraphs: confidentialityEn },
    { heading: "5. Copies, files, photographs", paragraphs: copiesEn },
    { heading: "6. Printed lists", paragraphs: printedEn },
    { heading: "7. The account and the session", paragraphs: accountEn },
    { heading: "8. Incidents", paragraphs: incidentsEn },
    { heading: "9. When the role ends", paragraphs: endEn },
    { heading: "10. The team member's data, the acceptance and the law", paragraphs: dataEn },
  ],
};
