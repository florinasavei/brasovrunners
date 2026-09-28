import type { LegalDocumentBody } from "../domain/content-hash";

/**
 * The race's two declarations — trail (`EVENT_DECLARATION`) and road or park
 * (`EVENT_DECLARATION_ROAD`) — from one shared body (§95, §418, §515). Each text is
 * `opening + riskSection + sharedDuties + closing`, so everything but the risks is written once.
 *
 * - Minimum age 14 with no flow below it; the event's own minimum is `{{minimumAge}}`; 14–17 sign
 *   with a parent's or guardian's approval (Civil Code art. 41(2)).
 * - Liability without an absolute waiver (art. 1351–1352, 1355, 1371): every "the organiser does
 *   not answer" sentence carries "to the extent the law allows".
 * - Only equipment the event's rules call mandatory may refuse a start.
 * - Data and signature as the privacy notice says, the same in both texts.
 *
 * A Romanian lawyer should read both before approval — the liability paragraph first. No hardcoded
 * value (§357; `tests/unit/legal-documents/no-hardcoded-values.test.ts`); 14 and 17 are the Code's.
 */

/** Who signs, for which event, at what age — the same in both texts. */
const openingRo = [
  "Subsemnatul/a {{participant}}, posesor/posesoare al/a actului de identitate {{participantIdDocument}}, declar că particip pe propria răspundere la evenimentul {{event}}, care va avea loc {{eventDate}}, în locația {{eventLocation}}. Declar că datele și cele afirmate în această declarație sunt adevărate, că am citit cu atenție regulamentul și detaliile evenimentului de pe pagina lui de pe site-ul clubului și că sunt de acord cu acestea. Știu că, dacă cele declarate nu sunt adevărate, răspund eu pentru urmările acestui fapt.",
  // §329, never under 14 (§515); filled with its unit: "16 ani", "20 de ani".
  "Declar că am cel puțin {{minimumAge}} împliniți la data evenimentului.",
  "Dacă participantul are între 14 și 17 ani inclusiv, declarația este semnată de participant și încuviințată de părintele sau tutorele legal, care o semnează alături de el: {{guardian}}, posesor/posesoare al/a actului de identitate {{guardianIdDocument}}. Prin semnătura sa, părintele sau tutorele legal își dă încuviințarea prealabilă ca minorul să participe și să semneze această declarație (art. 41 alin. (2) din Codul civil). Persoanele care nu au împlinit vârsta minimă stabilită pentru eveniment nu pot participa.",
  "Particip de bunăvoie, știind că alergarea presupune riscuri inerente, pe care nici organizatorul*, nici eu nu le putem înlătura în întregime și pe care le enumăr mai jos. Le accept în cunoștință de cauză și îmi asum obligațiile de mai jos. Această acceptare nu înseamnă, prin ea însăși, că renunț la dreptul de a fi despăgubit (art. 1355 alin. (4) din Codul civil) și nu înlătură niciun drept pe care legea nu îmi permite să îl limitez. Organizatorul răspunde, potrivit legii, pentru prejudiciile care îi sunt imputabile. Nu răspunde, în limitele permise de lege, pentru prejudiciile care nu îi sunt imputabile: cele datorate exclusiv faptei mele, nerespectării de către mine a regulamentului, a indicațiilor organizatorului ori a obligațiilor din această declarație, faptei unui terț pentru care organizatorul nu este ținut să răspundă, forței majore sau cazului fortuit (art. 1351 și art. 1352 din Codul civil). Dacă la prejudiciu a contribuit și fapta mea, răspunderea organizatorului se reduce sau, după caz, se înlătură, potrivit legii (art. 1371 din Codul civil). Nimic din această declarație nu înlătură și nu limitează răspunderea organizatorului pentru prejudiciile cauzate cu intenție sau din culpă gravă ori pentru vătămarea integrității corporale sau a sănătății, în afara cazurilor prevăzute de lege (art. 1355 alin. (1)–(3) din Codul civil). Răspund, potrivit legii, pentru prejudiciile pe care le cauzez altor persoane.",
  "• Voi respecta regulamentul evenimentului, îndrumările și indicațiile organizatorului și ale voluntarilor de traseu;",
];

const openingEn = [
  "I, {{participant}}, holder of identity document {{participantIdDocument}}, declare that I take part at my own risk in the event {{event}}, which takes place on {{eventDate}} at {{eventLocation}}. I declare that the information and statements in this declaration are true, that I have read the event's rules and details carefully on its page on the club's website and that I agree with them. I know that if what I declare is not true, I answer for the consequences.",
  // §329, never under 14 (§515); filled with its unit: "16 years".
  "I declare that I am at least {{minimumAge}} old on the day of the event.",
  "If the participant is aged between 14 and 17 inclusive, this declaration is signed by the participant and approved by the parent or legal guardian, who signs it beside them: {{guardian}}, holder of identity document {{guardianIdDocument}}. By signing, the parent or legal guardian gives prior approval to the minor taking part and signing this declaration (art. 41(2) of the Romanian Civil Code). Persons who have not reached the minimum age set for the event may not take part.",
  "I take part of my own free will, knowing that running carries inherent risks, which neither the organiser* nor I can remove entirely and which I list below. I accept them knowingly and take on the obligations below. This acceptance is not, by itself, a waiver of my right to compensation (art. 1355(4) of the Romanian Civil Code), and it removes no right the law does not allow me to limit. The organiser is liable, under the law, for harm attributable to it. It is not responsible, to the extent the law allows, for harm not attributable to it: harm due solely to my own conduct, to my failure to follow the event's rules, the organiser's instructions or the obligations in this declaration, to the act of a third party for whom the organiser is not answerable, or to force majeure or a fortuitous event (art. 1351 and art. 1352 of the Civil Code). Where my own conduct contributed to the harm, the organiser's liability is reduced or, as the case may be, removed, under the law (art. 1371 of the Civil Code). Nothing in this declaration excludes or limits the organiser's liability for harm caused intentionally or through gross negligence, or for harm to bodily integrity or health, except where the law provides (art. 1355(1)–(3) of the Civil Code). I am liable, under the law, for harm I cause to others.",
  "• I will follow the event's rules and the instructions of the organiser and the course marshals;",
];

/** The trail's risks (§357, §515). */
const trailRisksRo = [
  "• Cunosc și accept riscurile participării la o alergare pe trasee montane sau de pădure: teren accidentat, condiții meteo schimbătoare, accidentare sau agravarea unei afecțiuni preexistente;",
  "• Știu că traseul poate avea porțiuni abrupte, rădăcini, pietre, noroi, frunze ude, gheață sau zăpadă și accept riscul de cădere, alunecare, entorsă, tăieturi sau lovituri; îmi adaptez ritmul la teren și la condiții;",
  "• Știu că traseul poate traversa habitatul animalelor sălbatice și că pot întâlni animale domestice sau câini de stână. Mă oblig să păstrez distanța, să nu provoc sau hrănesc animalele, să respect indicațiile organizatorului și recomandările autorităților și, în caz de urgență, să apelez 112;",
  "• Știu că vremea la munte se poate schimba repede, inclusiv cu ceață, și că pe unele porțiuni ajutorul poate ajunge greu și târziu: am telefonul la mine și nu părăsesc traseul fără să anunț organizatorul;",
  "• Știu că pe traseele montane am nevoie de încălțăminte potrivită terenului (pantofi de trail) și, la alergările care se desfășoară sau se termină după lăsarea întunericului, de o lanternă frontală funcțională, cu bateriile încărcate;",
  "• Unde traseul traversează sau folosește drumuri deschise circulației, respect regulile de circulație și indicațiile poliției, ale organizatorului și ale voluntarilor; știu că drumul nu este închis traficului decât dacă pagina evenimentului o spune;",
  "• În ariile naturale protejate rămân pe traseele marcate și nu las în urmă niciun deșeu;",
];

const trailRisksEn = [
  "• I know and accept the risks of taking part in a run on mountain or forest trails: rough ground, changing weather, injury, or the worsening of an existing condition;",
  "• I know the course may have steep sections, roots, rocks, mud, wet leaves, ice or snow, and I accept the risk of falls, slips, sprains, cuts and knocks; I adapt my pace to the ground and the conditions;",
  "• I know the course may cross the habitat of wild animals and that I may meet domestic animals or sheepdogs. I undertake to keep my distance, not to provoke or feed the animals, to follow the organiser's instructions and the authorities' advice and, in an emergency, to call 112;",
  "• I know the weather in the mountains can change quickly, fog included, and that on parts of the course help can be slow and late to arrive: I carry my phone and do not leave the course without telling the organiser;",
  "• I know that on mountain trails I need footwear suited to the terrain (trail shoes) and, for runs that take place or end after dark, a working headlamp with charged batteries;",
  "• Where the course crosses or uses roads open to traffic, I follow the traffic rules and the instructions of the police, the organiser and the marshals; I know the road is not closed to traffic unless the event's page says so;",
  "• In protected natural areas I keep to the marked trails and leave no waste behind;",
];

/** The road's and the park's risks (§515). */
const roadRisksRo = [
  "• Cunosc și accept riscurile participării la o alergare pe șosea sau în parc: suprafețe dure, condiții meteo schimbătoare, aglomerație, accidentare sau agravarea unei afecțiuni preexistente;",
  "• Știu că traseul poate trece pe asfalt, beton, tartan sau pavele și poate avea borduri, gropi, capace de canal, denivelări, suprafețe ude sau alunecoase, curbe și porțiuni înguste, și accept riscul de cădere, alunecare, entorsă, tăieturi sau lovituri; îmi adaptez ritmul la suprafață și la condiții;",
  "• Știu că la start, pe porțiunile înguste și la punctele de alimentare poate fi aglomerație și că pot intra în contact sau în coliziune cu alți participanți: păstrez distanța, evit schimbările bruște de direcție, nu blochez traseul și nu mă opresc brusc în calea altora, iar când depășesc o fac cu atenție;",
  "• Știu că pe traseu sau lângă el pot fi pietoni, bicicliști, trotinete sau câini și că nu toți știu că se desfășoară o cursă: sunt atent/ă la ei și le las loc;",
  "• Știu că drumul nu este închis traficului decât dacă pagina evenimentului o spune; unde traseul nu este complet închis circulației, respect regulile de circulație și indicațiile poliției, ale organizatorului și ale voluntarilor;",
  "• Știu că am nevoie de încălțăminte potrivită suprafeței și, la alergările care se desfășoară sau se termină după lăsarea întunericului, de elemente reflectorizante și, unde traseul nu este luminat, de o lanternă frontală;",
];

const roadRisksEn = [
  "• I know and accept the risks of taking part in a run on the road or in a park: hard surfaces, changing weather, crowding, injury, or the worsening of an existing condition;",
  "• I know the course may run on asphalt, concrete, tartan or paving and may have kerbs, potholes, manhole covers, uneven ground, wet or slippery surfaces, bends and narrow sections, and I accept the risk of falls, slips, sprains, cuts and knocks; I adapt my pace to the surface and the conditions;",
  "• I know there may be crowding at the start, on narrow sections and at the refreshment points, and that I may come into contact or collide with other participants: I keep my distance, avoid sudden changes of direction, do not block the course or stop suddenly in others' way, and overtake with care;",
  "• I know there may be pedestrians, cyclists, scooters or dogs on or beside the course, and that not all of them know a race is on: I watch out for them and give them room;",
  "• I know the road is not closed to traffic unless the event's page says so; where the course is not fully closed to traffic, I follow the traffic rules and the instructions of the police, the organiser and the marshals;",
  "• I know I need footwear suited to the surface and, for runs that take place or end after dark, reflective elements and, where the course is not lit, a headlamp;",
];

/** The runner's duties every course shares. */
const sharedDutiesRo = [
  "• Știu că vremea se poate schimba — căldură, frig, ploaie, furtună, fulgere — și că după lăsarea întunericului vizibilitatea scade; accept că organizatorul poate modifica, scurta, opri sau anula evenimentul pentru siguranța participanților;",
  "• Știu că efortul pe căldură, frig, vânt sau ploaie poate duce la deshidratare, epuizare termică sau hipotermie: beau apă, mă echipez pentru vreme și mă opresc la primele semne;",
  "• Echipamentul este responsabilitatea mea: încălțăminte și îmbrăcăminte potrivite traseului și vremii, apă și un telefon mobil încărcat. Știu că, pentru echipament, organizatorul îmi poate refuza startul doar dacă îmi lipsește echipamentul declarat obligatoriu în regulamentul evenimentului; ce regulamentul doar recomandă rămâne o recomandare;",
  "• După cunoștința mea, starea mea de sănătate îmi permite efortul acestui eveniment și niciun medic nu mi-a interzis un astfel de efort. Știu că efortul intens poate provoca, rar, probleme grave, inclusiv cardiace, și că, dacă am o afecțiune cunoscută, trebuie să cer înainte sfatul medicului;",
  "• Alerg în ritmul meu și îmi cunosc limitele: mă opresc dacă nu mă simt bine, urmez traseul marcat, anunț organizatorul dacă abandonez sau părăsesc traseul și, la nevoie, sun la 112. Accept să primesc primul ajutor și să fiu oprit/ă din eveniment dacă organizatorul sau echipajul medical o consideră necesar pentru siguranța mea sau a celorlalți. Deciziile pe care le iau pe traseu îmi aparțin;",
  "• Nu particip sub influența alcoolului, a drogurilor ori a altor substanțe care îmi afectează capacitatea de a participa în siguranță;",
  "• Voi participa în spiritul sportivității și al fair-play-ului, în limita capacităților mele, evitând să mă expun pe mine sau pe alții la riscuri inutile;",
  "• Obiectele personale le am asupra mea sau le las pe răspunderea mea; accept că organizatorul nu răspunde, în limitele permise de lege, pentru pierderea sau deteriorarea lor;",
  "• Kitul de participare se ridică personal și nu se cedează, pe baza unui act de identitate menționat în această declarație: al participantului sau, pentru un participant de 14–17 ani, al lui ori al părintelui sau tutorelui legal care a semnat alături de el.",
];

const sharedDutiesEn = [
  "• I know the weather can change — heat, cold, rain, storms, lightning — and that visibility drops after dark; I accept that the organiser may change, shorten, stop or cancel the event for the participants' safety;",
  "• I know that effort in heat, cold, wind or rain can lead to dehydration, heat exhaustion or hypothermia: I drink, dress for the weather and stop at the first signs;",
  "• My equipment is my own responsibility: footwear and clothing suited to the course and the weather, water and a charged mobile phone. I know that, as to equipment, the organiser may refuse me the start only if I lack the equipment the event's rules declare mandatory; what the rules only recommend remains a recommendation;",
  "• To the best of my knowledge my health allows the effort of this event, and no doctor has told me to avoid such effort. I know that intense effort can, rarely, cause serious problems, including cardiac ones, and that if I have a known condition I should ask a doctor's advice beforehand;",
  "• I run at my own pace and know my limits: I stop if I feel unwell, keep to the marked course, tell the organiser if I drop out or leave the course and, if needed, call 112. I accept receiving first aid and being stopped from continuing if the organiser or the medical crew judge it necessary for my safety or that of others. The decisions I make on the course are my own;",
  "• I do not take part under the influence of alcohol, drugs or other substances that impair my ability to take part safely;",
  "• I will take part in the spirit of sportsmanship and fair play, within my abilities, avoiding needless risks to myself and to others;",
  "• I carry or leave my personal belongings at my own risk, and I accept that the organiser is not responsible, to the extent the law allows, for their loss or damage;",
  "• The race kit is collected in person and is not passed on, against an identity document named in this declaration: the participant's or, for a participant aged 14–17, theirs or that of the parent or legal guardian who signed beside them.",
];

/** Photographs, the data, the signature and the organiser — shared. */
const closingRo = [
  "Îmi asum responsabilitatea pentru propria siguranță, pentru echipamentul meu și pentru deciziile pe care le iau pe traseu.",
  "Am luat la cunoștință că la eveniment se fac fotografii și filmări, iar pe cele făcute de organizator sau în numele lui acesta le poate publica pentru a povesti evenimentul, în condițiile descrise în nota de confidențialitate — unde este descris și cum pot cere oricând să nu apar. Sunt de acord cu termenii și condițiile clubului, în versiunea acceptată la înscriere, și cu regulamentul evenimentului.",
  "Dacă vin la eveniment însoțit/însoțită de minori care nu sunt înscriși, aceștia rămân în grija și sub supravegherea mea pe toată durata evenimentului. Organizatorul nu preia supravegherea lor, iar un minor care nu este înscris nu poate lua parte la cursă.",
  "Sunt informat/ă că datele cu caracter personal din această declarație sunt prelucrate conform Regulamentului (UE) 2016/679 (GDPR) și notei de confidențialitate a clubului, pentru organizarea și desfășurarea acestui eveniment și, după el, ca dovadă a declarației. Declarația semnată se păstrează trei ani de la data evenimentului; seria și numărul actelor de identitate se păstrează în platformă cel mult șapte zile de la eveniment, iar copiile din arhiva clubului le au mascate.",
  "Semnez personal: un adult semnează doar pentru sine, iar o înscriere făcută de altcineva, pe adresa sa de email, nu îi dă dreptul să semneze în locul meu; pentru un participant de 14–17 ani semnează minorul și părintele sau tutorele legal, fiecare cu propriul act de identitate. Dacă semnez electronic, din linkul trimis pe adresa de email confirmată, numele fiecărui semnatar, scris mai jos, bifa de acceptare, momentul semnării și amprenta textului citit sunt înregistrate împreună: este o semnătură electronică simplă, căreia nu i se poate refuza efectul juridic doar pentru că este electronică (art. 25 alin. (1) din Regulamentul (UE) nr. 910/2014 (eIDAS); Legea nr. 214/2024 privind utilizarea semnăturii electronice, a mărcii temporale și prestarea serviciilor de încredere bazate pe acestea). Dacă semnez pe hârtie, la masa de înscrieri, un membru al echipei înregistrează semnătura în platformă, cu numele său, iar clubul păstrează originalul. În ambele cazuri primesc o copie pe adresa de email confirmată, iar arhiva clubului păstrează o copie cu seria și numărul actelor de identitate mascate (rămân cel mult primele două și ultimele două caractere); pe originalul de hârtie, clubul le acoperă în cel mult șapte zile de la eveniment.",
  "*Prin Organizator se înțelege <DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI>.",
];

const closingEn = [
  "I take responsibility for my own safety, my equipment and the decisions I make on the course.",
  "I acknowledge that photographs and film are made at the event and that the organiser may publish those made by it or on its behalf to tell the event's story, under the conditions described in the privacy notice — which also says how I can ask at any time not to appear. I agree with the club's terms and conditions, in the version accepted when registering, and with the event's rules.",
  "If I come to the event with minors who are not registered, they remain in my care and under my supervision throughout the event. The organiser does not take over their supervision, and a minor who is not registered may not take part in the race.",
  "I am informed that the personal data in this declaration is processed under Regulation (EU) 2016/679 (GDPR) and the club's privacy notice, to organise and run this event and, afterwards, as evidence of the declaration. The signed declaration is kept for three years from the date of the event; the identity documents' series and numbers are kept on the platform for at most seven days from the event, and the copies in the club's archive have them masked.",
  "I sign personally: an adult signs only for themselves, and a registration made by someone else, on their own email address, does not entitle them to sign in my place; for a participant aged 14–17 the minor and the parent or legal guardian sign, each with their own identity document. If I sign electronically, from the link sent to my confirmed email address, each signer's name, written below, the acceptance tick, the moment of signing and the fingerprint of the text read are recorded together: this is a simple electronic signature, which cannot be denied legal effect solely because it is electronic (art. 25(1) of Regulation (EU) No 910/2014 (eIDAS); Romanian Law no. 214/2024 on the use of electronic signatures, time stamps and the provision of trust services based on them). If I sign on paper at the registration desk, a team member records the signature in the platform under their own name, and the club keeps the original. Either way a copy is sent to my confirmed email address, and the club's archive keeps a copy with the identity documents' series and numbers masked (at most the first two and last two characters remain); on the paper original, the club covers them within seven days of the event.",
  "*Organiser means <THE CLUB'S FULL LEGAL NAME>.",
];

const body = (paragraphs: string[]): LegalDocumentBody => ({ sections: [{ paragraphs }] });

/** Also every race while no road text is approved. */
export const declarationTrailRo: LegalDocumentBody = body([...openingRo, ...trailRisksRo, ...sharedDutiesRo, ...closingRo]);
export const declarationTrailEn: LegalDocumentBody = body([...openingEn, ...trailRisksEn, ...sharedDutiesEn, ...closingEn]);

export const declarationRoadRo: LegalDocumentBody = body([...openingRo, ...roadRisksRo, ...sharedDutiesRo, ...closingRo]);
export const declarationRoadEn: LegalDocumentBody = body([...openingEn, ...roadRisksEn, ...sharedDutiesEn, ...closingEn]);

/** For the test that holds each part to one place. */
export const RACE_DECLARATION_PARTS = {
  ro: { opening: openingRo, trail: trailRisksRo, road: roadRisksRo, shared: sharedDutiesRo, closing: closingRo },
  en: { opening: openingEn, trail: trailRisksEn, road: roadRisksEn, shared: sharedDutiesEn, closing: closingEn },
} as const;
