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
 * paragraph names the platform's keeping it until the signer asks for its deletion (§503, reversing
 * §393's seven days) and the archive copy's three years from the signing — not "from the run",
 * which a declaration covering every date of a weekly run no longer names (§NNN); the platform's
 * copy, which a PDF can be drawn from again, is the one that lasts while the signer keeps coming.
 *
 * **One age rule, on `{{minimumAge}}` (§NNN).** The signer declares for themselves: `{{participant}}`
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
 * What both surfaces open with: who, which run — every date of it, from the one signed on (§NNN) —
 * that it is optional and not a race.
 *
 * **A series sentence and a one-off sentence (§NNN).** A group run is mostly a weekly one (§113: one
 * line, many dates), and the owner's rule of 2026-09-27 is that a returning runner signs once. But one
 * approved text serves a one-off run too, and «every date of the run» is untrue of a run that has one.
 * So the text says what it covers in one of two paragraphs, and the renderer keeps the one that fits
 * (`dropsParagraph`, `SERIES_MERGE_FIELDS`): the **series sentence** names `{{series}}`,
 * `{{seriesRhythm}}` and `{{seriesPlace}}` — every run of the series from the signing on, with no end
 * date, a date that differs read on its own page, valid until the signer asks for its deletion, and a
 * new version asked for again —; the **one-off sentence** names `{{event}}`, `{{eventDate}}` and
 * `{{eventLocation}}` — that one run. The opening names neither, so it reads right under both. The
 * service keeps one signature per person, series and version (`signGroupRunDeclaration`), which is
 * what the series sentence promises.
 */
const openingRo = [
  "Subsemnatul/a {{participant}}, declar pe propria răspundere că particip la alergarea de grup descrisă mai jos și că înainte de fiecare alergare îi citesc detaliile pe pagina ei de pe site-ul clubului.",
  // The run's own minimum age (§329, §440), never under eighteen (`groupRunMinimumAge`, §NNN): the
  // one age the text states — on the day of each run, true of one run and of a series alike.
  "Declar că am cel puțin {{minimumAge}} împliniți la data fiecărei alergări la care particip.",
  // The series sentence (§NNN): kept for a run that is one of a series, dropped for a one-off.
  "Declarația este valabilă pentru toate alergările seriei {{series}} — {{seriesRhythm}}, cu plecare de obicei din {{seriesPlace}} — la care particip de la semnare, fără termen de încetare: nu o semnez din nou la fiecare alergare. Dacă o dată diferă de celelalte — locul, ora sau traseul —, aflu acest lucru de pe pagina acelei date, iar declarația se aplică și ei. Rămâne valabilă până când cer ștergerea ei; dacă organizatorul aprobă o versiune nouă a textului, mi se cere să o semnez din nou.",
  // The one-off sentence (§NNN): kept for a run of one date, dropped for a series.
  "Declarația este pentru alergarea de grup {{event}}, {{eventDate}}, cu plecare din {{eventLocation}}.",
  "Știu că o alergare de grup nu este o competiție și nici o tură ghidată: nu are înscriere, cronometrare sau echipă de siguranță pe traseu, iar organizatorul* anunță ora, locul și traseul și aleargă împreună cu participanții. Semnarea acestei declarații este opțională și nu este o condiție pentru a alerga cu grupul.",
];

const openingEn = [
  "I, {{participant}}, declare on my own responsibility that I take part in the group run described below, and that before each run I read its details on its page on the club's website.",
  // The run's own minimum age (§329, §440), never under eighteen (`groupRunMinimumAge`, §NNN): the
  // one age the text states — on the day of each run, true of one run and of a series alike.
  "I declare that I am at least {{minimumAge}} old on the day of each run I take part in.",
  // The series sentence (§NNN): kept for a run that is one of a series, dropped for a one-off.
  "This declaration is valid for every run of the series {{series}} — {{seriesRhythm}}, usually starting from {{seriesPlace}} — that I take part in from the moment I sign it, with no end date: I do not sign it again for each run. If a date differs from the others — the place, the time or the route — I learn it from that date's page, and the declaration applies to that date too. It stays valid until I ask for its deletion; if the organiser approves a new version of the text, I am asked to sign it again.",
  // The one-off sentence (§NNN): kept for a run of one date, dropped for a series.
  "This declaration is for the group run {{event}} on {{eventDate}}, starting from {{eventLocation}}.",
  "I know that a group run is neither a competition nor a guided tour: it has no registration, no timing and no safety crew on the course, and the organiser* announces the time, the place and the route and runs together with the participants. Signing this declaration is optional and is not a condition of running with the group.",
];

/** What both surfaces close with: ownership, what the text is and is not, the data, the signature, who the organiser is. */
const closingRo = [
  "Îmi asum responsabilitatea pentru propria siguranță, pentru echipamentul meu și pentru deciziile pe care le iau pe traseu.",
  "Această declarație arată că am fost informat/ă despre riscurile de mai sus și că le accept, împreună cu obligațiile mele; acceptarea riscurilor nu înseamnă, prin ea însăși, că renunț la dreptul de a fi despăgubit (art. 1355 alin. (4) din Codul civil) și nu mă lipsește de niciun drept pe care mi-l dă legea. Organizatorul răspunde, potrivit legii, pentru prejudiciile care îi sunt imputabile; nu poate fi tras la răspundere, în limitele permise de lege, pentru cele care nu îi sunt imputabile, cum sunt urmările propriilor mele alegeri pe traseu, iar fapta mea poate reduce sau înlătura răspunderea lui, potrivit legii (art. 1371 din Codul civil).",
  "Sunt informat/ă că datele din această declarație — numele și adresa de email — sunt prelucrate de organizator*, conform Regulamentului (UE) 2016/679 (GDPR) și notei de confidențialitate a clubului, ca dovadă că am fost informat/ă despre riscurile acestor alergări și că le-am acceptat, în temeiul interesului legitim al organizatorului (art. 6 alin. (1) lit. f) GDPR), iar afirmația despre sănătate, doar pentru constatarea sau apărarea unui drept în instanță (art. 9 alin. (2) lit. f) GDPR). O copie îmi este trimisă pe adresa de email pe care am dat-o, iar una ajunge în arhiva clubului. Platforma clubului păstrează declarația cât timp particip la alergările clubului și o șterge la cererea mea, trimisă la adresa de contact a clubului; copia din arhiva clubului se păstrează trei ani de la semnare (termenul general de prescripție, art. 2517 din Codul civil), apoi se șterge. Am dreptul de acces, de rectificare, de ștergere, de restricționare și de opoziție, precum și dreptul de a depune plângere la Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP); pentru ele scriu la <EMAIL DE CONTACT>.",
  "Semnez această declarație personal, doar pentru mine. Este semnată electronic: numele scris mai jos, bifa de acceptare, momentul semnării ({{signedAt}}) și amprenta textului citit sunt înregistrate împreună (semnătură electronică simplă, în sensul Regulamentului (UE) nr. 910/2014 (eIDAS) și al Legii nr. 214/2024 privind utilizarea semnăturii electronice, a mărcii temporale și prestarea serviciilor de încredere bazate pe acestea).",
  "*Prin Organizator se înțelege <DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI>, cu sediul în <ADRESA SEDIULUI>, <NUMĂR DE ÎNREGISTRARE / CUI>.",
];

const closingEn = [
  "I take responsibility for my own safety, my equipment and the decisions I make on the course.",
  "This declaration shows that I have been informed of the risks above and that I accept them, together with my own obligations; accepting the risks is not, by itself, a waiver of my right to compensation (art. 1355(4) of the Romanian Civil Code), and it does not take away any right the law gives me. The organiser is liable, under the law, for harm attributable to it; it cannot be held liable, to the extent the law allows, for harm not attributable to it, such as the consequences of my own choices on the course, and my own conduct may reduce or remove its liability, under the law (art. 1371 of the Civil Code).",
  "I am informed that the data in this declaration — my name and my email address — is processed by the organiser*, under Regulation (EU) 2016/679 (GDPR) and the club's privacy notice, as evidence that I was informed of the risks of these runs and accepted them, on the basis of the organiser's legitimate interest (art. 6(1)(f) GDPR), and the statement about my health only for the establishment or defence of legal claims (art. 9(2)(f) GDPR). A copy is sent to the email address I gave, and one to the club's archive. The club's platform keeps the declaration while I take part in the club's runs and deletes it at my request, sent to the club's contact address; the copy in the club's archive is kept for three years from the signing (the general limitation period, art. 2517 of the Romanian Civil Code), then deleted. I have the rights of access, rectification, erasure, restriction and objection, and the right to complain to the Romanian supervisory authority (ANSPDCP); for them I write to <CONTACT EMAIL>.",
  "I sign this declaration personally, for myself only. It is signed electronically: the name written below, the acceptance tick, the moment of signing ({{signedAt}}) and the fingerprint of the text read are recorded together (a simple electronic signature under Regulation (EU) 910/2014 (eIDAS) and Romanian Law no. 214/2024 on the use of electronic signatures, time stamps and the provision of trust services based on them).",
  "*Organiser means <THE CLUB'S FULL LEGAL NAME>, with its registered seat at <REGISTERED ADDRESS>, <REGISTRATION NUMBER>.",
];

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
  "• Starea mea de sănătate îmi permite efortul unei alergări în grup și nu am boli care să îmi interzică practicarea sportului; mă opresc dacă nu mă simt bine și, la nevoie, sun la 112;",
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
  "• My state of health allows the effort of a group run and I have no illness that forbids me from doing sport; I stop if I feel unwell and, if needed, call 112;",
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
  // The owner's own sentence of §NNN, the race's trail text word for word.
  "• Știu că traseul poate traversa habitatul animalelor sălbatice și că pot întâlni animale domestice sau câini de stână. Mă oblig să păstrez distanța, să nu provoc sau hrănesc animalele, să respect indicațiile organizatorului și recomandările autorităților și, în caz de urgență, să apelez 112;",
  "• Știu că vremea la munte se poate schimba repede — căldură, frig, ploaie, furtună, fulgere, ceață — și că după lăsarea întunericului vizibilitatea scade; accept că organizatorul poate schimba, scurta sau opri alergarea pentru siguranța celor care aleargă;",
  "• Echipamentul este responsabilitatea mea: încălțăminte potrivită terenului (pantofi de trail), îmbrăcăminte potrivită vremii, apă și un telefon mobil încărcat; la alergările care se desfășoară sau se termină după lăsarea întunericului, o lanternă frontală funcțională, cu bateriile încărcate;",
  "• Alerg în ritmul meu și îmi cunosc limitele: mă opresc dacă nu mă simt bine, rămân pe traseul marcat și anunț organizatorul dacă mă despart de grup sau abandonez. Știu că o alergare de grup nu este o tură ghidată și că deciziile pe care le iau pe traseu îmi aparțin;",
  "• Știu că pe munte ajutorul poate ajunge greu și târziu: am telefonul la mine, cunosc numărul de urgență 112 și nu plec de pe traseu fără să anunț pe cineva din grup;",
  "• Starea mea de sănătate îmi permite efortul unei alergări pe munte și nu am boli care să îmi interzică practicarea sportului;",
  "• În ariile naturale protejate rămân pe traseele marcate și nu las în urmă niciun deșeu;",
  "• Nu particip sub influența alcoolului, a drogurilor ori a altor substanțe care îmi afectează capacitatea de a participa în siguranță;",
  "• Obiectele personale le am asupra mea sau le las pe răspunderea mea; accept că organizatorul nu răspunde, în limitele permise de lege, pentru pierderea sau deteriorarea lor.",
];

const trailRisksEn = [
  "• I know the route runs on mountain or forest paths, with steep sections, roots, rocks, mud, wet leaves, ice or snow, and I accept the risk of falls, slips, sprains, cuts and knocks; I adapt my pace to the ground and the conditions;",
  // The owner's own sentence of §NNN, the race's trail text word for word.
  "• I know the route may cross the habitat of wild animals and that I may meet domestic animals or sheepdogs. I undertake to keep my distance, not to provoke or feed the animals, to follow the organiser's instructions and the authorities' advice and, in an emergency, to call 112;",
  "• I know the weather in the mountains can change quickly — heat, cold, rain, storms, lightning, fog — and that visibility drops after dark; I accept that the organiser may change, shorten or stop the run for the runners' safety;",
  "• My equipment is my own responsibility: footwear suited to the terrain (trail shoes), clothing suited to the weather, water and a charged mobile phone; for runs that take place or end after dark, a working headlamp with charged batteries;",
  "• I run at my own pace and know my limits: I stop if I feel unwell, keep to the marked route and tell the organiser if I leave the group or drop out. I know that a group run is not a guided tour and that the decisions I make on the course are my own;",
  "• I know that in the mountains help can be slow and late to arrive: I carry my phone, know the emergency number 112, and do not leave the route without telling someone in the group;",
  "• My state of health allows the effort of a mountain run and I have no illness that forbids me from doing sport;",
  "• In protected natural areas I keep to the marked trails and leave no waste behind;",
  "• I do not take part under the influence of alcohol, drugs or other substances that impair my ability to take part safely;",
  "• I carry or leave my personal belongings at my own risk, and I accept that the organiser is not responsible, to the extent the law allows, for their loss or damage.",
];

const body = (paragraphs: string[]): LegalDocumentBody => ({ sections: [{ paragraphs }] });

export const groupRunAsphaltRo: LegalDocumentBody = body([...openingRo, ...asphaltRisksRo, ...closingRo]);
export const groupRunAsphaltEn: LegalDocumentBody = body([...openingEn, ...asphaltRisksEn, ...closingEn]);
export const groupRunTrailRo: LegalDocumentBody = body([...openingRo, ...trailRisksRo, ...closingRo]);
export const groupRunTrailEn: LegalDocumentBody = body([...openingEn, ...trailRisksEn, ...closingEn]);
