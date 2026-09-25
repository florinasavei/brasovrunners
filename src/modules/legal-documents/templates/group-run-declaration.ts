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
 * decides the risks: on asphalt, traffic, the group's pace and the dark; on a trail, the terrain,
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
 * **Adults only, for now.** The signer declares for themselves: `{{participant}}` and
 * `{{idDocument}}` are the signer's own name and document. A minor's signature beside a parent's
 * (§330) is the race's flow, bound to a registration; whether a parent may sign here for a child is
 * the owner's question (listed in §393). Until it is answered, both texts open with the signer's own
 * statement that they are 18 or older, and the signing page's consent box repeats it: a minor cannot
 * give this declaration alone, so the archive must not hold one that looks as if they did.
 *
 * **No hardcoded value (§357).** One approved text serves every group run of its surface, so
 * nothing names a run, a place, a date or a distance — those are merge fields — and the club is
 * named only by the four `<PLACEHOLDER>`s (§132): the legal name, the seat, the registration number
 * and the contact address. The retention period is the platform's own (`jobs/retention.ts`), the
 * same for every run because the code makes it so.
 */

/** What both surfaces open with: who, which run, that it is optional and not a race. */
const openingRo = [
  "Subsemnatul/a {{participant}}, posesor/posesoare al actului de identitate {{idDocument}}, declar pe propria răspundere că am împlinit 18 ani, că particip la alergarea de grup {{event}}, din data de {{eventDate}}, cu plecare din {{eventLocation}}, și că am citit detaliile ei de pe pagina evenimentului de pe site-ul clubului.",
  "Știu că o alergare de grup nu este o competiție și nici o tură ghidată: nu are înscriere, cronometrare sau echipă de siguranță pe traseu, iar organizatorul* anunță ora, locul și traseul și aleargă împreună cu participanții. Semnarea acestei declarații este opțională și nu este o condiție pentru a alerga cu grupul.",
];

const openingEn = [
  "I, {{participant}}, holder of identity document {{idDocument}}, declare on my own responsibility that I am 18 or older, that I take part in the group run {{event}}, on {{eventDate}}, starting from {{eventLocation}}, and that I have read its details on the event's page on the club's website.",
  "I know that a group run is neither a competition nor a guided tour: it has no registration, no timing and no safety crew on the course, and the organiser* announces the time, the place and the route and runs together with the participants. Signing this declaration is optional and is not a condition of running with the group.",
];

/** What both surfaces close with: ownership, what the text is and is not, the data, the signature, who the organiser is. */
const closingRo = [
  "Îmi asum responsabilitatea pentru propria siguranță, pentru echipamentul meu și pentru deciziile pe care le iau pe traseu.",
  "Această declarație arată că am fost informat/ă despre riscurile de mai sus și că le accept, împreună cu obligațiile mele; nu mă lipsește de niciun drept pe care mi-l dă legea. Organizatorul nu poate fi tras la răspundere, în limitele permise de lege, pentru urmările propriilor mele alegeri pe traseu.",
  "Sunt informat/ă că datele din această declarație — numele, actul de identitate și adresa de email — sunt prelucrate conform Regulamentului (UE) 2016/679 (GDPR) și notei de confidențialitate a clubului, ca dovadă a declarației mele pentru această alergare, și că platforma clubului o șterge la șapte zile după alergare. O copie îmi este trimisă pe adresa de email pe care am dat-o, iar una, cu seria și numărul actului de identitate mascate (rămân cel mult primele două și ultimele două caractere), ajunge în arhiva clubului. Pentru drepturile mele — acces, rectificare, ștergere, opoziție — scriu la <EMAIL DE CONTACT>.",
  "Această declarație este semnată electronic: numele scris mai jos, bifa de acceptare, momentul semnării ({{signedAt}}) și amprenta textului citit sunt înregistrate împreună (semnătură electronică simplă, în sensul Regulamentului (UE) nr. 910/2014 (eIDAS) și al Legii nr. 214/2024 privind utilizarea semnăturii electronice).",
  "*Prin Organizator se înțelege <DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI>, cu sediul în <ADRESA SEDIULUI>, <NUMĂR DE ÎNREGISTRARE / CUI>.",
];

const closingEn = [
  "I take responsibility for my own safety, my equipment and the decisions I make on the course.",
  "This declaration shows that I have been informed of the risks above and that I accept them, together with my own obligations; it does not take away any right the law gives me. The organiser cannot be held liable, to the extent the law allows, for the consequences of my own choices on the course.",
  "I am informed that the data in this declaration — my name, my identity document and my email address — is processed under Regulation (EU) 2016/679 (GDPR) and the club's privacy notice, as evidence of my declaration for this run, and that the club's platform deletes it seven days after the run. A copy is sent to the email address I gave, and one, with the identity document's series and number masked (at most the first two and last two characters remain), to the club's archive. For my rights — access, rectification, erasure, objection — I write to <CONTACT EMAIL>.",
  "This declaration is signed electronically: the name written below, the acceptance tick, the moment of signing ({{signedAt}}) and the fingerprint of the text read are recorded together (a simple electronic signature under Regulation (EU) 910/2014 (eIDAS) and Romanian Law no. 214/2024 on the use of electronic signatures).",
  "*Organiser means <THE CLUB'S FULL LEGAL NAME>, with its registered seat at <REGISTERED ADDRESS>, <REGISTRATION NUMBER>.",
];

/**
 * On asphalt: traffic, the group's pace, the dark — and the ground and the weather as a road has
 * them. Each bullet in the race text's "• …;" style, the last with a full stop.
 */
const asphaltRisksRo = [
  "• Știu că traseul folosește drumuri publice, trotuare și treceri de pietoni, pe unde circulă mașini, bicicliști și trotinete: respect regulile de circulație, traversez doar pe unde și când este permis și nu mă bazez pe grup ca să fiu văzut/ă de șoferi;",
  "• Știu că grupul aleargă într-un ritm pe care nu îl aleg eu: alerg în ritmul meu, mă opresc sau mă întorc când nu mai pot ține pasul și știu că grupul nu așteaptă neapărat după mine;",
  "• Știu că după lăsarea întunericului vizibilitatea scade, pentru mine și pentru șoferi: la alergările care se desfășoară sau se termină după lăsarea întunericului port elemente reflectorizante și, unde drumul nu este luminat, o lanternă frontală funcțională;",
  "• Știu că vremea se poate schimba — căldură, frig, ploaie, polei — și că asfaltul ud sau înghețat, bordurile, gropile și capacele de canal pot provoca alunecări și căderi; accept riscul de cădere, entorsă, tăieturi sau lovituri;",
  "• Echipamentul este responsabilitatea mea: încălțăminte și îmbrăcăminte potrivite vremii, apă și un telefon mobil încărcat;",
  "• Starea mea de sănătate îmi permite efortul unei alergări în grup și nu am boli care să îmi interzică practicarea sportului; mă opresc dacă nu mă simt bine și, la nevoie, sun la 112;",
  "• Obiectele personale le am asupra mea sau le las pe răspunderea mea; accept că organizatorul nu răspunde, în limitele permise de lege, pentru pierderea sau deteriorarea lor.",
];

const asphaltRisksEn = [
  "• I know the route uses public roads, pavements and pedestrian crossings, where cars, bicycles and scooters move: I follow the traffic rules, cross only where and when it is allowed, and do not rely on the group to make me visible to drivers;",
  "• I know the group runs at a pace I do not choose: I run at my own pace, stop or turn back when I cannot keep up, and know that the group will not necessarily wait for me;",
  "• I know that visibility drops after dark, for me and for drivers: for runs that take place or end after dark I wear reflective elements and, where the road is not lit, a working headlamp;",
  "• I know the weather can change — heat, cold, rain, black ice — and that wet or icy asphalt, kerbs, potholes and manhole covers can cause slips and falls; I accept the risk of falls, sprains, cuts and knocks;",
  "• My equipment is my own responsibility: footwear and clothing suited to the weather, water and a charged mobile phone;",
  "• My state of health allows the effort of a group run and I have no illness that forbids me from doing sport; I stop if I feel unwell and, if needed, call 112;",
  "• I carry or leave my personal belongings at my own risk, and I accept that the organiser is not responsible, to the extent the law allows, for their loss or damage.",
];

/**
 * On a trail: the terrain and falls, wild animals and dogs, the weather and the dark, the runner's
 * own equipment (a headlamp after dark) and pace — the race declaration's wording (§357), for a run
 * nobody registered for.
 */
const trailRisksRo = [
  "• Știu că traseul este pe poteci de munte sau de pădure, cu porțiuni abrupte, rădăcini, pietre, noroi, frunze ude, gheață sau zăpadă, și accept riscul de cădere, alunecare, entorsă, tăieturi sau lovituri; îmi adaptez ritmul la teren și la condiții;",
  "• Știu că traseul poate traversa habitatul animalelor sălbatice — urși, mistreți, vipere, căpușe — și că pot întâlni câini, inclusiv câini de stână. Cunosc regulile de bază: păstrez distanța, nu hrănesc animalele și nu mă apropii de ele, nu fug de un urs, ci mă retrag încet și calm, anunț organizatorul și, la nevoie, sun la 112. Accept riscul unor astfel de întâlniri;",
  "• Știu că vremea la munte se poate schimba repede — căldură, frig, ploaie, furtună, fulgere, ceață — și că după lăsarea întunericului vizibilitatea scade; accept că organizatorul poate schimba, scurta sau opri alergarea pentru siguranța celor care aleargă;",
  "• Echipamentul este responsabilitatea mea: încălțăminte potrivită terenului (pantofi de trail), îmbrăcăminte potrivită vremii, apă și un telefon mobil încărcat; la alergările care se desfășoară sau se termină după lăsarea întunericului, o lanternă frontală funcțională, cu bateriile încărcate;",
  "• Alerg în ritmul meu și îmi cunosc limitele: mă opresc dacă nu mă simt bine, rămân pe traseul marcat și anunț organizatorul dacă mă despart de grup sau abandonez. Știu că o alergare de grup nu este o tură ghidată și că deciziile pe care le iau pe traseu îmi aparțin;",
  "• Știu că pe munte ajutorul poate ajunge greu și târziu: am telefonul la mine, cunosc numărul de urgență 112 și nu plec de pe traseu fără să anunț pe cineva din grup;",
  "• Starea mea de sănătate îmi permite efortul unei alergări pe munte și nu am boli care să îmi interzică practicarea sportului;",
  "• În ariile naturale protejate rămân pe traseele marcate și nu las în urmă niciun deșeu;",
  "• Obiectele personale le am asupra mea sau le las pe răspunderea mea; accept că organizatorul nu răspunde, în limitele permise de lege, pentru pierderea sau deteriorarea lor.",
];

const trailRisksEn = [
  "• I know the route runs on mountain or forest paths, with steep sections, roots, rocks, mud, wet leaves, ice or snow, and I accept the risk of falls, slips, sprains, cuts and knocks; I adapt my pace to the ground and the conditions;",
  "• I know the route may cross the habitat of wild animals — bears, wild boar, vipers, ticks — and that I may meet dogs, sheepdogs included. I know the basic rules: keep my distance, never feed or approach an animal, never run from a bear but back away slowly and calmly, tell the organiser and, if needed, call 112. I accept the risk of such encounters;",
  "• I know the weather in the mountains can change quickly — heat, cold, rain, storms, lightning, fog — and that visibility drops after dark; I accept that the organiser may change, shorten or stop the run for the runners' safety;",
  "• My equipment is my own responsibility: footwear suited to the terrain (trail shoes), clothing suited to the weather, water and a charged mobile phone; for runs that take place or end after dark, a working headlamp with charged batteries;",
  "• I run at my own pace and know my limits: I stop if I feel unwell, keep to the marked route and tell the organiser if I leave the group or drop out. I know that a group run is not a guided tour and that the decisions I make on the course are my own;",
  "• I know that in the mountains help can be slow and late to arrive: I carry my phone, know the emergency number 112, and do not leave the route without telling someone in the group;",
  "• My state of health allows the effort of a mountain run and I have no illness that forbids me from doing sport;",
  "• In protected natural areas I keep to the marked trails and leave no waste behind;",
  "• I carry or leave my personal belongings at my own risk, and I accept that the organiser is not responsible, to the extent the law allows, for their loss or damage.",
];

const body = (paragraphs: string[]): LegalDocumentBody => ({ sections: [{ paragraphs }] });

export const groupRunAsphaltRo: LegalDocumentBody = body([...openingRo, ...asphaltRisksRo, ...closingRo]);
export const groupRunAsphaltEn: LegalDocumentBody = body([...openingEn, ...asphaltRisksEn, ...closingEn]);
export const groupRunTrailRo: LegalDocumentBody = body([...openingRo, ...trailRisksRo, ...closingRo]);
export const groupRunTrailEn: LegalDocumentBody = body([...openingEn, ...trailRisksEn, ...closingEn]);
