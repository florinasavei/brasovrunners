import type { LegalDocumentBody } from "../domain/content-hash";

/**
 * The optional self-declarations of a group run (§393), one per surface: asphalt and trail.
 *
 * The owner, 2026-09-25: "I might need a 'declarație pe propria răspundere' for group runs as well,
 * especially for the trail one; this is optional but people should be able to sign and email it to
 * us". And, the same morning: the mountain rescue asks for one on the Tâmpa trail run. So a runner
 * may sign one on a group run's page — never as a condition of turning up (§111: a group run takes
 * no registration) — and gets the PDF by email; the club's archive gets its copy.
 *
 * **Why two texts and not the race's.** The race's declaration (`declaration.ts`) speaks of a
 * competition, a race kit collected against the identity document, photographs of the race and a
 * registration confirmed by the signature; none of that is true of a Monday run. And the surface
 * decides the risks: on asphalt, traffic, dogs (§418), the group's pace and the dark; on a trail, the terrain,
 * wild animals and dogs, the weather and the dark, the runner's own equipment (a headlamp after
 * dark) and pace. Each text names only its own.
 *
 * **Informed acceptance of risk, never a waiver** — the same line `declaration.ts` draws (§357):
 * under the Civil Code (art. 1355) liability for intent or gross fault cannot be excluded, harm to
 * the body or health cannot be excused except as the law allows, and accepting a risk is not by
 * itself a waiver of damages. What the text can do is inform, and set out the conduct the runner
 * owes, which counts when a harm was the victim's own doing (art. 1371). So the bullets accept risks
 * and state obligations, and every sentence that says the organiser does not answer for something
 * carries "în limitele permise de lege" / "to the extent the law allows". A Romanian lawyer should
 * read both before the club approves them; these notes are the platform's reading, not advice.
 *
 * **No identity document (§418, the counsel review of 2026-09-25).** A group run hands out no kit
 * and the email is not verified, so a typed number proves nothing and is data the club need not
 * hold (GDPR art. 5(1)(c)): neither text names `{{idDocument}}`, and the signing page, which asks
 * for a document only when the text names one, asks for none. The basis is the club's legitimate
 * interest in evidence (art. 6(1)(f)), and art. 9(2)(f) for the health statement — the privacy
 * notice's §3 says the same — so the rights list names objection and restriction, and the data
 * paragraph says how long it is kept by its purpose, never by a count from the signing (§534, the
 * counsel's second pass of 2026-09-28, amending §503 and §523): the declaration in force is kept while
 * it is needed to manage the signer's taking part in the runs it covers; once the signer asks for its
 * withdrawal it is used for no later run, and a copy may be kept only as long as establishing,
 * exercising or defending a right needs it — with the general three-year limitation period in view
 * (art. 2517 Codul civil) — and, while a complaint, a dispute or proceedings are under way, until they
 * are finally settled (§556, the second review of 2026-09-29: the hold an Administrator sets on the
 * signature, `retention_hold`, is what that sentence promises). «Three years from the signing» was
 * untrue of a declaration still in force: a runner who signed in 2026 and still comes in 2030 is
 * still covered by it.
 *
 * **The second review (§556, 2026-09-29), three sentences.** The shoes name the safety outcome —
 * «adecvată terenului, cu aderență corespunzătoare (de preferat încălțăminte pentru teren
 * accidentat)», in Romanian words since §564 — not a shoe category; the animals clause asks for
 * «indicațiile generale de siguranță comunicate de organizator», never «recomandările
 * autorităților», as a run with no individual supervision and no mountain guide can promise; and the
 * retention sentence above.
 *
 * **The counsel's second pass (§534, 2026-09-28), in the text's own words.** Valid for the whole
 * series and signed once, «until it is withdrawn or replaced by a new version» — never «fără termen de
 * încetare»; the health sentence is the runner's own assessment «din câte cunosc», and the next bullet
 * says the organiser does not and cannot assess anyone medically — no question about a diagnosis, a
 * treatment or a history is asked; the run is «o alergare de grup, nu un serviciu de ghidaj (montan)»
 * that supervises nobody individually, said once, in the opening, and not again in a bullet; the
 * signature names «momentul semnării» as the platform records it and never calls it a time stamp.
 *
 * **One age rule, on `{{minimumAge}}` (§515).** The signer declares for themselves: `{{participant}}`
 * is the signer's own name, and the text says it is signed personally. Until the owner's review of
 * 2026-09-27 both texts opened «declar… că am împlinit 18 ani» and then said «Declar că am cel puțin
 * {{minimumAge}}» — two ages at once. Now the eighteen is not in the text at all: the one sentence is
 * «Declar că am cel puțin {{minimumAge}} împliniți la data alergării», and the adults-only rule is the
 * run's configuration — the editor's group-run box starts and stops at eighteen, and a run saved with
 * less is read as eighteen (`groupRunMinimumAge`). Neither text has a minor's signature or a parent's
 * (§330 is the race's flow, bound to a registration), so neither covers a minor, and the signing
 * page's consent box repeats the run's age. The page asks for a birth date only above eighteen
 * (`groupRunAsksBirthDate`, §440) and refuses one under the minimum on the run's day
 * (`isUnderMinimumAge`, the race's rule).
 *
 * **No hardcoded value (§357).** One approved text serves every group run of its surface, so
 * nothing names a run, a place, a date or a distance — those are merge fields — and the club is
 * named only by the four `<PLACEHOLDER>`s (§132): the legal name, the seat, the registration number
 * and the contact address. The platform's retention is no number of days — kept while the signer
 * takes part in the club's runs and deleted at their request (`jobs/retention.ts` sweeps no row,
 * §503) — the same for every run because the code makes it so.
 */

/**
 * What both surfaces open with: who, which run — every date of it, from the one signed on (§523) —
 * that it is optional and not a race.
 *
 * **A series sentence and a one-off sentence (§523).** A group run is mostly a weekly one (§113: one
 * line, many dates), and the owner's rule of 2026-09-27 is that a returning runner signs once. But one
 * approved text serves a one-off run too, and «every date of the run» is untrue of a run that has one.
 * So the text says what it covers in one of two paragraphs, and the renderer keeps the one that fits
 * (`dropsParagraph`, `SERIES_MERGE_FIELDS`): the **series sentence** names `{{series}}`,
 * `{{seriesRhythm}}` and `{{seriesPlace}}` — every run of the series from the date of signing on,
 * signed once, a date that differs read on its own page, valid until it is withdrawn or replaced by a
 * new version, which the signer is asked to sign again (§534) —; the **one-off sentence** names `{{event}}`, `{{eventDate}}` and
 * `{{eventLocation}}` — that one run. The opening names neither, so it reads right under both. The
 * service keeps one signature per person, series and version (`signGroupRunDeclaration`), which is
 * what the series sentence promises.
 *
 * The series sentence comes in two shapes, with «cu plecare de obicei din {{seriesPlace}}» and
 * without it, for a run whose place is not written in that language (`isPlacelessSeriesSentence`):
 * the renderer keeps exactly one of them, so a series never loses its sentence to an empty place.
 */
/*
  The validity in the counsel's words (§534, points 1–2): valid for the whole series, signed once, from
  the date of signing — «începând cu», so the run of the day it is signed on is covered too; the
  counsel's «după data semnării» would have left out the very run a runner signs at the start of —
  until it is withdrawn or replaced by a new version, never «fără termen de încetare».
*/
const SERIES_TAIL_RO =
  "și nu trebuie semnată din nou la fiecare alergare. Declarația se aplică alergărilor din această serie la care particip începând cu data semnării și rămâne valabilă până când este retrasă sau înlocuită cu o versiune nouă. Dacă o dată diferă de celelalte — locul, ora sau traseul —, aflu acest lucru de pe pagina acelei date, iar declarația se aplică și ei. Dacă organizatorul aprobă o versiune nouă a declarației, participantului i se va cere să o semneze din nou.";
const SERIES_TAIL_EN =
  "and need not be signed again for each run. The declaration applies to the runs of this series that I take part in from the date of signing onwards, and remains valid until it is withdrawn or replaced by a new version. If a date differs from the others — the place, the time or the route — I learn it from that date's page, and the declaration applies to that date too. If the organiser approves a new version of the declaration, the participant will be asked to sign it again.";

/*
  What a group run is, said once (§534, points 8–10): not a competition, and «o alergare de grup, nu un
  serviciu de ghidaj montan» with no individual supervision — the trail's words; on asphalt a guiding
  service, with no mountain in it. The organiser sets and announces the time, the place and the route and
  may give general safety guidance. Optional, because a group run takes no registration (§111, §393) —
  the event's policy, and the sentence goes the day it stops being one.
*/
const whatItIsRo = (service: string) =>
  `Știu că o alergare de grup nu este o competiție: nu are înscriere, cronometrare sau echipă de siguranță pe traseu. Este o alergare de grup, nu ${service} și nu presupune supravegherea individuală a fiecărui participant. Organizatorul* stabilește și anunță ora, locul și traseul, aleargă împreună cu participanții și poate da indicații generale de siguranță. Semnarea acestei declarații este opțională și nu este o condiție pentru a alerga cu grupul.`;
const whatItIsEn = (service: string) =>
  `I know that a group run is not a competition: it has no registration, no timing and no safety crew on the course. It is a group run, not ${service}, and it does not involve the individual supervision of each participant. The organiser* sets and announces the time, the place and the route, runs together with the participants and may give general safety guidance. Signing this declaration is optional and is not a condition of running with the group.`;

const openingRo = (service: string) => [
  "Subsemnatul/a {{participant}}, declar pe propria răspundere că particip la alergarea de grup descrisă mai jos și că înainte de fiecare alergare îi citesc detaliile pe pagina ei de pe site-ul clubului.",
  // The run's own minimum age (§329, §440), never under eighteen (`groupRunMinimumAge`, §515): the
  // one age the text states — on the day of each run, true of one run and of a series alike.
  "Declar că am cel puțin {{minimumAge}} împliniți la data fiecărei alergări la care particip.",
  // The series sentence (§523): kept for a run that is one of a series, dropped for a one-off.
  `Declarația este valabilă pentru toate alergările seriei {{series}} — {{seriesRhythm}}, cu plecare de obicei din {{seriesPlace}} — ${SERIES_TAIL_RO}`,
  // The same sentence without its place clause (`isPlacelessSeriesSentence`, §523): kept only for a
  // series whose place is not written, when the one above is dropped — never both, never neither.
  `Declarația este valabilă pentru toate alergările seriei {{series}} — {{seriesRhythm}} — ${SERIES_TAIL_RO}`,
  // The one-off sentence (§523): kept for a run of one date, dropped for a series.
  "Declarația este pentru alergarea de grup {{event}}, {{eventDate}}, cu plecare din {{eventLocation}}.",
  whatItIsRo(service),
];

const openingEn = (service: string) => [
  "I, {{participant}}, declare on my own responsibility that I take part in the group run described below, and that before each run I read its details on its page on the club's website.",
  // The run's own minimum age (§329, §440), never under eighteen (`groupRunMinimumAge`, §515): the
  // one age the text states — on the day of each run, true of one run and of a series alike.
  "I declare that I am at least {{minimumAge}} old on the day of each run I take part in.",
  // The series sentence (§523): kept for a run that is one of a series, dropped for a one-off.
  `This declaration is valid for every run of the series {{series}} — {{seriesRhythm}}, usually starting from {{seriesPlace}} — ${SERIES_TAIL_EN}`,
  // The same sentence without its place clause (`isPlacelessSeriesSentence`, §523): kept only for a
  // series whose place is not written, when the one above is dropped — never both, never neither.
  `This declaration is valid for every run of the series {{series}} — {{seriesRhythm}} — ${SERIES_TAIL_EN}`,
  // The one-off sentence (§523): kept for a run of one date, dropped for a series.
  "This declaration is for the group run {{event}} on {{eventDate}}, starting from {{eventLocation}}.",
  whatItIsEn(service),
];

/** What both surfaces close with: ownership, what the text is and is not, the data, the signature, who the organiser is. */
const closingRo = [
  "Îmi asum responsabilitatea pentru propria siguranță, pentru echipamentul meu și pentru deciziile pe care le iau pe traseu.",
  "Această declarație arată că am fost informat/ă despre riscurile de mai sus și că le accept, împreună cu obligațiile mele; acceptarea riscurilor nu înseamnă, prin ea însăși, că renunț la dreptul de a fi despăgubit (art. 1355 alin. (4) din Codul civil) și nu mă lipsește de niciun drept pe care mi-l dă legea. Organizatorul răspunde, potrivit legii, pentru prejudiciile care îi sunt imputabile; nu poate fi tras la răspundere, în limitele permise de lege, pentru cele care nu îi sunt imputabile, cum sunt urmările propriilor mele alegeri pe traseu, iar fapta mea poate reduce sau înlătura răspunderea lui, potrivit legii (art. 1371 din Codul civil).",
  "Sunt informat/ă că datele din această declarație — numele și adresa de email — sunt prelucrate de organizator*, conform Regulamentului (UE) 2016/679 (GDPR) și notei de confidențialitate a clubului, ca dovadă că am fost informat/ă despre riscurile acestor alergări și că le-am acceptat, în temeiul interesului legitim al organizatorului (art. 6 alin. (1) lit. f) GDPR), iar afirmația despre sănătate, doar pentru constatarea, exercitarea sau apărarea unui drept în instanță (art. 9 alin. (2) lit. f) GDPR). O copie îmi este trimisă pe adresa de email pe care am dat-o, iar una ajunge în arhiva clubului. Declarația activă se păstrează cât timp este necesară pentru gestionarea participării mele la alergările la care se aplică. Dacă cer retragerea ei, la adresa de contact a clubului, nu mai este folosită pentru participările viitoare. O copie poate fi păstrată și după aceea, pe durata necesară constatării, exercitării sau apărării unor drepturi, inclusiv ținând seama de termenul general de prescripție de trei ani prevăzut de art. 2517 din Codul civil. Dacă există o reclamație, un litigiu sau o procedură în curs, documentul poate fi păstrat până la soluționarea definitivă a acesteia. Am dreptul de acces, de rectificare, de ștergere, de restricționare și de opoziție, precum și dreptul de a depune plângere la Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP); pentru ele scriu la <EMAIL DE CONTACT>.",
  // «Momentul semnării» as the platform records it (§534, point 14): never called a time stamp, and no
  // law's title beside it that could read as one — the Romanian law is cited by its number.
  "Semnez această declarație personal, doar pentru mine. Este semnată electronic: numele scris mai jos, bifa de acceptare, momentul semnării ({{signedAt}}) și amprenta textului citit sunt înregistrate împreună de platforma clubului. Este o semnătură electronică simplă, căreia nu i se poate refuza efectul juridic doar pentru că este electronică (art. 25 alin. (1) din Regulamentul (UE) nr. 910/2014 (eIDAS); Legea nr. 214/2024).",
  "*Prin Organizator se înțelege <DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI>, cu sediul în <ADRESA SEDIULUI>, <NUMĂR DE ÎNREGISTRARE / CUI>.",
];

const closingEn = [
  "I take responsibility for my own safety, my equipment and the decisions I make on the course.",
  "This declaration shows that I have been informed of the risks above and that I accept them, together with my own obligations; accepting the risks is not, by itself, a waiver of my right to compensation (art. 1355(4) of the Romanian Civil Code), and it does not take away any right the law gives me. The organiser is liable, under the law, for harm attributable to it; it cannot be held liable, to the extent the law allows, for harm not attributable to it, such as the consequences of my own choices on the course, and my own conduct may reduce or remove its liability, under the law (art. 1371 of the Civil Code).",
  "I am informed that the data in this declaration — my name and my email address — is processed by the organiser*, under Regulation (EU) 2016/679 (GDPR) and the club's privacy notice, as evidence that I was informed of the risks of these runs and accepted them, on the basis of the organiser's legitimate interest (art. 6(1)(f) GDPR), and the statement about my health only for the establishment, exercise or defence of legal claims (art. 9(2)(f) GDPR). A copy is sent to the email address I gave, and one to the club's archive. The active declaration is kept as long as it is needed to manage my taking part in the runs it applies to. If I ask for its withdrawal, at the club's contact address, it is no longer used for any later run. A copy may be kept after that, for as long as needed to establish, exercise or defend rights, including with regard to the general three-year limitation period set by art. 2517 of the Romanian Civil Code. If a complaint, a dispute or proceedings are under way, the document may be kept until they are finally settled. I have the rights of access, rectification, erasure, restriction and objection, and the right to complain to the Romanian supervisory authority (ANSPDCP); for them I write to <CONTACT EMAIL>.",
  "I sign this declaration personally, for myself only. It is signed electronically: the name written below, the acceptance tick, the moment of signing ({{signedAt}}) and the fingerprint of the text read are recorded together by the club's platform. It is a simple electronic signature, which cannot be denied legal effect solely because it is electronic (art. 25(1) of Regulation (EU) No 910/2014 (eIDAS); Romanian Law no. 214/2024).",
  "*Organiser means <THE CLUB'S FULL LEGAL NAME>, with its registered seat at <REGISTERED ADDRESS>, <REGISTRATION NUMBER>.",
];

/*
  Right after the runner's own health statement on both surfaces (§534, point 4, the counsel's words):
  nobody on the organiser's side assesses a participant medically, and no question about a diagnosis,
  a treatment or a medical history is asked anywhere (point 5) — the statement stays the one health
  datum, under art. 9(2)(f).
*/
const ORGANISER_NO_MEDICAL_RO =
  "• Organizatorul nu efectuează și nu poate efectua o evaluare medicală a participanților; responsabilitatea de a aprecia dacă starea proprie permite participarea aparține fiecărui participant;";
const ORGANISER_NO_MEDICAL_EN =
  "• The organiser does not and cannot carry out a medical assessment of the participants; the responsibility for judging whether one's own condition allows taking part lies with each participant;";

/**
 * On asphalt: traffic, dogs, the group's pace, the dark — and the ground and the weather as a road has
 * them. Each bullet in the race text's "• …;" style, the last with a full stop.
 */
const asphaltRisksRo = [
  "• Știu că traseul folosește drumuri publice, trotuare și treceri de pietoni, pe unde circulă mașini, bicicliști și trotinete: respect regulile de circulație, traversez doar pe unde și când este permis și nu mă bazez pe grup ca să fiu văzut/ă de șoferi;",
  "• Știu că pot întâlni câini, inclusiv fără stăpân: păstrez distanța, nu mă apropii de ei și nu fug de ei;",
  "• Știu că grupul aleargă într-un ritm pe care nu îl aleg eu: alerg în ritmul meu, mă opresc sau mă întorc când nu mai pot ține pasul și știu că grupul nu așteaptă neapărat după mine;",
  "• Știu că după lăsarea întunericului vizibilitatea scade, pentru mine și pentru șoferi: la alergările care se desfășoară sau se termină după lăsarea întunericului port elemente reflectorizante și, unde drumul nu este luminat, o lanternă frontală funcțională;",
  "• Știu că vremea se poate schimba — căldură, frig, ploaie, polei — și că asfaltul ud sau înghețat, bordurile, gropile și capacele de canal pot provoca alunecări și căderi; accept riscul de cădere, entorsă, tăieturi sau lovituri;",
  "• Echipamentul este responsabilitatea mea: încălțăminte și îmbrăcăminte potrivite vremii, apă și un telefon mobil încărcat;",
  // The runner's own assessment, never the organiser's certificate (§534, points 3–5): the trail's words, on a road.
  "• Declar că, din câte cunosc, starea mea de sănătate îmi permite să particip la o alergare de grup pe drumuri publice și că nu cunosc existența unei afecțiuni sau recomandări medicale care să îmi interzică un astfel de efort. Îmi asum responsabilitatea de a-mi evalua starea înaintea fiecărei participări și de a nu participa sau de a mă opri dacă apar simptome ori o stare care face continuarea nesigură; la nevoie, sun la 112;",
  ORGANISER_NO_MEDICAL_RO,
  "• Nu particip sub influența alcoolului, a drogurilor ori a altor substanțe care îmi afectează capacitatea de a participa în siguranță;",
  "• Obiectele personale le am asupra mea sau le las pe răspunderea mea; accept că organizatorul nu răspunde, în limitele permise de lege, pentru pierderea sau deteriorarea lor.",
];

const asphaltRisksEn = [
  "• I know the route uses public roads, pavements and pedestrian crossings, where cars, bicycles and scooters move: I follow the traffic rules, cross only where and when it is allowed, and do not rely on the group to make me visible to drivers;",
  "• I know I may meet dogs, stray ones included: I keep my distance, do not approach them and do not run from them;",
  "• I know the group runs at a pace I do not choose: I run at my own pace, stop or turn back when I cannot keep up, and know that the group will not necessarily wait for me;",
  "• I know that visibility drops after dark, for me and for drivers: for runs that take place or end after dark I wear reflective elements and, where the road is not lit, a working headlamp;",
  "• I know the weather can change — heat, cold, rain, black ice — and that wet or icy asphalt, kerbs, potholes and manhole covers can cause slips and falls; I accept the risk of falls, sprains, cuts and knocks;",
  "• My equipment is my own responsibility: footwear and clothing suited to the weather, water and a charged mobile phone;",
  "• I declare that, to the best of my knowledge, my state of health allows me to take part in a group run on public roads and that I am not aware of any condition or medical advice that forbids me such an effort. I take responsibility for assessing my condition before each run I take part in, and for not taking part, or stopping, if symptoms appear or my condition makes carrying on unsafe; if needed, I call 112;",
  ORGANISER_NO_MEDICAL_EN,
  "• I do not take part under the influence of alcohol, drugs or other substances that impair my ability to take part safely;",
  "• I carry or leave my personal belongings at my own risk, and I accept that the organiser is not responsible, to the extent the law allows, for their loss or damage.",
];

/**
 * On a trail: the terrain and falls, wild animals and dogs, the weather and the dark, the runner's
 * own equipment (a headlamp after dark) and pace — the race declaration's wording (§357), for a run
 * nobody registered for.
 */
const trailRisksRo = [
  "• Știu că traseul este pe poteci de munte sau de pădure, cu porțiuni abrupte, rădăcini, pietre, noroi, frunze ude, gheață sau zăpadă, și accept riscul de cădere, alunecare, entorsă, tăieturi sau lovituri; îmi adaptez ritmul la teren și la condiții;",
  // The owner's own sentence of §515, the race's trail text word for word.
  "• Știu că traseul poate traversa habitatul animalelor sălbatice și că pot întâlni animale domestice sau câini de stână. Mă oblig să păstrez distanța, să nu provoc sau hrănesc animalele, să respect indicațiile generale de siguranță comunicate de organizator și, în caz de urgență, să apelez 112;",
  "• Știu că vremea la munte se poate schimba repede — căldură, frig, ploaie, furtună, fulgere, ceață — și că după lăsarea întunericului vizibilitatea scade; accept că organizatorul poate schimba, scurta sau opri alergarea pentru siguranța celor care aleargă;",
  "• Echipamentul este responsabilitatea mea: încălțăminte adecvată terenului, cu aderență corespunzătoare (de preferat încălțăminte pentru teren accidentat), îmbrăcăminte potrivită vremii, apă și un telefon mobil încărcat; la alergările care se desfășoară sau se termină după lăsarea întunericului, o lanternă frontală funcțională, cu bateriile încărcate;",
  // Not guided is said once, in the opening (§534, point 9); stopping when unwell is the health bullet's.
  "• Alerg în ritmul meu și îmi cunosc limitele: rămân pe traseul marcat și anunț organizatorul dacă mă despart de grup sau abandonez;",
  "• Știu că pe munte ajutorul poate ajunge greu și târziu: am telefonul la mine, cunosc numărul de urgență 112 și nu plec de pe traseu fără să anunț pe cineva din grup;",
  // The counsel's words (§534, points 3–4): the runner's own assessment, then the organiser's none.
  "• Declar că, din câte cunosc, starea mea de sănătate îmi permite să particip la o alergare pe teren montan și că nu cunosc existența unei afecțiuni sau recomandări medicale care să îmi interzică un astfel de efort. Îmi asum responsabilitatea de a-mi evalua starea înaintea fiecărei participări și de a nu participa sau de a mă opri dacă apar simptome ori o stare care face continuarea nesigură;",
  ORGANISER_NO_MEDICAL_RO,
  "• În ariile naturale protejate rămân pe traseele marcate și nu las în urmă niciun deșeu;",
  "• Nu particip sub influența alcoolului, a drogurilor ori a altor substanțe care îmi afectează capacitatea de a participa în siguranță;",
  "• Obiectele personale le am asupra mea sau le las pe răspunderea mea; accept că organizatorul nu răspunde, în limitele permise de lege, pentru pierderea sau deteriorarea lor.",
];

const trailRisksEn = [
  "• I know the route runs on mountain or forest paths, with steep sections, roots, rocks, mud, wet leaves, ice or snow, and I accept the risk of falls, slips, sprains, cuts and knocks; I adapt my pace to the ground and the conditions;",
  // The owner's own sentence of §515, the race's trail text word for word.
  "• I know the route may cross the habitat of wild animals and that I may meet domestic animals or sheepdogs. I undertake to keep my distance, not to provoke or feed the animals, to follow the general safety instructions communicated by the organiser and, in an emergency, to call 112;",
  "• I know the weather in the mountains can change quickly — heat, cold, rain, storms, lightning, fog — and that visibility drops after dark; I accept that the organiser may change, shorten or stop the run for the runners' safety;",
  "• My equipment is my own responsibility: footwear suited to the terrain, with adequate grip (preferably trail shoes), clothing suited to the weather, water and a charged mobile phone; for runs that take place or end after dark, a working headlamp with charged batteries;",
  "• I run at my own pace and know my limits: I keep to the marked route and tell the organiser if I leave the group or drop out;",
  "• I know that in the mountains help can be slow and late to arrive: I carry my phone, know the emergency number 112, and do not leave the route without telling someone in the group;",
  "• I declare that, to the best of my knowledge, my state of health allows me to take part in a run on mountain terrain and that I am not aware of any condition or medical advice that forbids me such an effort. I take responsibility for assessing my condition before each run I take part in, and for not taking part, or stopping, if symptoms appear or my condition makes carrying on unsafe;",
  ORGANISER_NO_MEDICAL_EN,
  "• In protected natural areas I keep to the marked trails and leave no waste behind;",
  "• I do not take part under the influence of alcohol, drugs or other substances that impair my ability to take part safely;",
  "• I carry or leave my personal belongings at my own risk, and I accept that the organiser is not responsible, to the extent the law allows, for their loss or damage.",
];

const body = (paragraphs: string[]): LegalDocumentBody => ({ sections: [{ paragraphs }] });

export const groupRunAsphaltRo: LegalDocumentBody = body([...openingRo("un serviciu de ghidaj"), ...asphaltRisksRo, ...closingRo]);
export const groupRunAsphaltEn: LegalDocumentBody = body([...openingEn("a guiding service"), ...asphaltRisksEn, ...closingEn]);
export const groupRunTrailRo: LegalDocumentBody = body([...openingRo("un serviciu de ghidaj montan"), ...trailRisksRo, ...closingRo]);
export const groupRunTrailEn: LegalDocumentBody = body([...openingEn("a mountain guiding service"), ...trailRisksEn, ...closingEn]);
