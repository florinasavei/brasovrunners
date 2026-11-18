import type { LegalDocumentBody } from "../domain/content-hash";

/**
 * «Regulamentul tombolei» (§NNN; the owner, 2026-11-18: «Dar pentru tombolă trebuie să am o înscriere separată» — and, asked, that
 * a person accepts a raffle's rules approved by the club, without which the sign-up does not open).
 *
 * One text for every event's raffle in the sign-up mode («Cu înscriere separată»), accepted by every person who signs up — from
 * their own registration's page, on the event's public form, at the desk on race day, or recorded by the organizers — and approved
 * by the club in `/admin/legal` like every other text (§29, §95, §418). Until a version is in force in every language, no door of
 * the sign-up opens (`raffleSignUpGate`); the «Din oficiu» mode needs no rules at all.
 *
 * **What it says, section by section.** Who organises it (the club by its four facts, §132) and at which event (its facts as merge
 * fields filled when the person accepts: `{{event}}`, `{{eventDate}}`, `{{eventLocation}}`); who may take part — the groups the
 * event ticks, `{{raffleGroups}}`, filled from «Cine poate participa» — and that it is free; how to sign up (the three doors and
 * the rules' acceptance); the draw (among those signed up, at the event, at the time announced, the winner present); the prizes as
 * the organisers announce them; how a winner is told, and that no name is published online without the person's agreement; the
 * data, pointing to the privacy notice; withdrawal; disputes.
 *
 * **For the lawyer, not decided here.** Whether a free raffle at a club's event needs anything the text does not say under the
 * law of promotions and games of chance (a public rules text is offered free of charge on the site; whether it must be lodged
 * anywhere); whether a prize above the tax-free threshold asks the organiser to withhold tax and how the winner is told so; whether
 * a minor's taking part needs more than the sentence on the parent's or guardian's agreement. The text promises only what the
 * platform does: the sign-up, the acceptance's record, the withdrawal from the registration's page, no name published.
 *
 * **No hardcoded value (§357).** Nothing names a club, an event, a place, a date, a prize or a time: the club by its four
 * `<PLACEHOLDER>`s, the event and the groups by merge fields. The law of the courts stays written in, as in every text.
 */

const organiserRo = [
  "Tombola este organizată de <DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI>, cu sediul în <ADRESA SEDIULUI>, <NUMĂR DE ÎNREGISTRARE / CUI>, care poate fi contactată la <EMAIL DE CONTACT> (numită mai jos „organizatorul”).",
  "Tombola are loc la evenimentul {{event}}, care are loc {{eventDate}}, în {{eventLocation}}.",
];

const organiserEn = [
  "The raffle is organised by <THE CLUB'S FULL LEGAL NAME>, with its registered seat at <REGISTERED ADDRESS>, <REGISTRATION NUMBER>, which can be contacted at <CONTACT EMAIL> (below, “the organiser”).",
  "The raffle takes place at the event {{event}}, which takes place on {{eventDate}}, at {{eventLocation}}.",
];

const whoRo = [
  // «Cine poate participa» (§NNN): the groups the event ticks, in words, filled when the person accepts.
  "Pot participa la tombolă {{raffleGroups}}.",
  "Participarea este gratuită: nu se cumpără nimic și nu se plătește nimic pentru ea.",
  "Fiecare persoană participă o singură dată: cu numărul ei de concurs sau de voluntar, iar o persoană de pe lista de elită a cursei, cu numele.",
  "Organizatorul poate hotărî ca unele persoane să nu participe la tombolă, de exemplu cele care o organizează.",
  "Un participant minor se înscrie cu acordul părintelui sau al tutorelui său.",
];

const whoEn = [
  "The raffle is open to {{raffleGroups}}.",
  "Taking part is free: nothing is bought and nothing is paid for it.",
  "Each person takes part once: with their race number or volunteer number, and a person on the race's elite list, by name.",
  "The organiser may decide that some people do not take part in the raffle, for example those who run it.",
  "A participant who is a minor signs up with the agreement of their parent or guardian.",
];

const signUpRo = [
  "Tombola cere o înscriere separată de înscrierea la eveniment. Cât timp înscrierile la tombolă sunt deschise, te înscrii într-unul dintre aceste feluri:",
  "• din pagina înscrierii tale la eveniment, la care duce legătura „Gestionează înscrierea” din e-mailurile primite;",
  "• din formularul tombolei de pe pagina evenimentului, cu numărul tău de concurs și numele cu care te-ai înscris; un voluntar bifează că este voluntar și scrie numărul său de voluntar;",
  "• la organizatori, în ziua evenimentului, spunând că accepți acest regulament, pe hârtie sau verbal; tot organizatorii îi înscriu pe voluntari și pe cei de pe lista de elită care le cer acest lucru.",
  "Înscrierea se face numai cu acceptarea acestui regulament. Organizatorul închide înscrierile cel târziu la începutul extragerii.",
];

const signUpEn = [
  "The raffle needs a sign-up of its own, separate from the registration for the event. While the raffle's sign-ups are open, you sign up in one of these ways:",
  "• from your registration's own page for the event, which the “Manage your registration” link in the emails you received opens;",
  "• from the raffle's form on the event's page, with your race number and the name you registered with; a volunteer ticks that they are a volunteer and types their volunteer number;",
  "• with the organisers, on the day of the event, by saying that you accept these rules, on paper or aloud; the organisers also sign up the volunteers and the people on the elite list who ask them to.",
  "A sign-up is made only by accepting these rules. The organiser closes the sign-ups at the start of the draw at the latest.",
];

const drawRo = [
  "Extragerea are loc la eveniment, la ora anunțată de organizator, dintre cei înscriși, în fața celor prezenți. Se extrag numere de concurs sau de voluntar, iar pentru o persoană de pe lista de elită, numele.",
  "Câștigătorul trebuie să fie prezent la extragere. Dacă nu este, se extrage altcineva în locul lui.",
];

const drawEn = [
  "The draw takes place at the event, at the time the organiser announces, among those signed up, in front of those present. Race numbers or volunteer numbers are drawn, and for a person on the elite list, the name.",
  "A winner must be present at the draw. If they are not, someone else is drawn in their place.",
];

const prizesRo = [
  "Premiile, câte sunt și în ce ordine se extrag le anunță organizatorul înainte de extragere, la eveniment.",
  "Câștigătorul primește premiul pe loc, la eveniment.",
];

const prizesEn = [
  "The prizes, how many there are and the order in which they are drawn are announced by the organiser before the draw, at the event.",
  "A winner receives the prize on the spot, at the event.",
];

const winnersRo = [
  "Câștigătorul află pe loc, la extragere: organizatorul îi anunță numărul sau numele în fața celor prezenți.",
  "Organizatorul nu publică pe internet numele unui câștigător fără acordul lui.",
];

const winnersEn = [
  "A winner learns it on the spot, at the draw: the organiser announces their number or name in front of those present.",
  "The organiser publishes no winner's name online without their agreement.",
];

const dataRo = [
  "Pentru tombolă, organizatorul păstrează numărul tău de concurs sau de voluntar, numele scris în formular, dacă te-ai înscris ca voluntar și acceptarea acestui regulament, doar ca să țină tombola și ca dovadă a acceptării, așa cum spune nota de confidențialitate a clubului, publicată pe site-ul clubului, care spune și cât timp le păstrează și ce drepturi ai. Pentru ele, scrii la <EMAIL DE CONTACT>.",
];

const dataEn = [
  "For the raffle, the organiser keeps your race number or volunteer number, the name typed on the form, whether you signed up as a volunteer and your acceptance of these rules, only to hold the raffle and as proof of the acceptance, as the club's privacy notice says — published on the club's website, it also says how long they are kept and what rights you have. For them, you write to <CONTACT EMAIL>.",
];

const withdrawRo = [
  "Te poți retrage oricând până la extragere: din pagina înscrierii tale, cu „Nu mai particip”, sau spunându-le organizatorilor.",
];

const withdrawEn = [
  "You may withdraw at any time before the draw: from your registration's own page, with “I'm no longer taking part”, or by telling the organisers.",
];

const disputesRo = [
  "O nelămurire sau o reclamație despre tombolă se trimite organizatorului, la <EMAIL DE CONTACT>. O neînțelegere care nu se rezolvă pe cale amiabilă se judecă de instanțele competente din România.",
];

const disputesEn = [
  "A question or a complaint about the raffle is sent to the organiser, at <CONTACT EMAIL>. A disagreement not settled amicably is decided by the competent courts of Romania.",
];

export const raffleRulesRo: LegalDocumentBody = {
  sections: [
    { heading: "1. Organizatorul", paragraphs: organiserRo },
    { heading: "2. Cine poate participa", paragraphs: whoRo },
    { heading: "3. Cum te înscrii", paragraphs: signUpRo },
    { heading: "4. Extragerea", paragraphs: drawRo },
    { heading: "5. Premiile", paragraphs: prizesRo },
    { heading: "6. Câștigătorii", paragraphs: winnersRo },
    { heading: "7. Datele personale", paragraphs: dataRo },
    { heading: "8. Retragerea", paragraphs: withdrawRo },
    { heading: "9. Neînțelegeri", paragraphs: disputesRo },
  ],
};

export const raffleRulesEn: LegalDocumentBody = {
  sections: [
    { heading: "1. The organiser", paragraphs: organiserEn },
    { heading: "2. Who may take part", paragraphs: whoEn },
    { heading: "3. How to sign up", paragraphs: signUpEn },
    { heading: "4. The draw", paragraphs: drawEn },
    { heading: "5. The prizes", paragraphs: prizesEn },
    { heading: "6. The winners", paragraphs: winnersEn },
    { heading: "7. Personal data", paragraphs: dataEn },
    { heading: "8. Withdrawing", paragraphs: withdrawEn },
    { heading: "9. Disagreements", paragraphs: disputesEn },
  ],
};
