import type { LegalDocumentBody } from "../domain/content-hash";

/**
 * The club's declaration, as the paper one reads (`DECISIONS.md` §95) — the text the organiser
 * handed over on 2026-09-18, with the blanks as merge fields (`domain/merge-fields.ts`) so one
 * approved version serves every event: the participant, the identity document, the event, its
 * date and its place are filled in when the declaration is shown, signed and printed.
 *
 * Written for the club to approve in `/admin/legal` (the "start from the platform's text"
 * link prefills it). The one fact left to the club is its own legal name, in the footnote.
 *
 * Since a minor's declaration is always signed by the parent or guardian, and — only from age 14,
 * and only where the text asks for it — co-signed by the minor too (§330), the text opens with
 * the participant and their own document (`{{participant}}`, `{{participantIdDocument}}`) and
 * names the parent in a sentence of its own (`{{guardian}}`, `{{guardianIdDocument}}`), which for
 * an adult reads an em dash in both places — the paper form's "for minors" line left empty. Under
 * 14 the minor signs nothing and is asked for no document; the parent or guardian signs alone, in
 * the minor's name, as legal representative. `{{declarant}}` and `{{idDocument}}` still work in
 * every text the club approved before; this template simply no longer needs them.
 *
 * **The runner takes ownership (§357).** The owner, 2026-09-24: the declaration must "cover us on
 * the encounters with wild animals, proper equipment (shoes, headlamp for night running), falling,
 * etc — basically the runner takes ownership of everything". So the bullets name those risks —
 * the terrain and falls, wild animals and dogs, the weather and the dark, the runner's own
 * equipment (a headlamp after dark), their own pace and decisions, their belongings, protected
 * areas — and a sentence of the owner's closes them. They are written as **informed acceptance of
 * a risk plus the runner's own obligations**, never as a promise that nobody answers for anything:
 * under the Civil Code (art. 1355) liability for intent or gross fault cannot be excluded, harm to
 * the body or health cannot be excused except as the law allows, and accepting a risk is not by
 * itself a waiver of damages; what the text *can* do is inform, and set out the conduct the runner
 * owes, which counts when a harm was the victim's own doing (art. 1371). For the same reason every
 * sentence that says the organiser does not answer for something — the liability paragraph and the
 * belongings bullet — carries "în limitele permise de lege" ("to the extent the law allows").
 *
 * **Production-ready per the counsel review of 2026-09-25 (§418).** The paper form's waiver "for any
 * damage, injury, death… caused to me or by me" is gone: void for injury, death, intent and gross
 * fault, and binding on nobody's heirs. The liability paragraph is now informed acceptance of the
 * risks, a statement that the acceptance is no waiver (art. 1355(4)), the organiser's non-liability
 * only for what is solely the runner's or a third party's doing (art. 1352, 1371), and the runner's
 * own liability to others; the signing box accepts it expressly (art. 1203). The opening no longer
 * threatens the criminal "false statements" offence — it asks for the truth and the runner answers
 * for it. A minor of 14 or over signs with the parent's prior consent; under 14 the parent signs
 * alone as legal representative (Civil Code art. 41, 43) — TODO(legal-soon): the signing page, the
 * service and the desk still ask a minor under 14 to sign beside the parent whenever the text names
 * `{{participantIdDocument}}`; they must ask it only from 14 on the event day (`ageOnRaceDay`)
 * before any event whose minimum age is below 14 (the default is 14). Minors the runner brings along stay in
 * their care — the runner cannot release the club toward a child whose claims are the child's own.
 * Photographs are acknowledged, not claimed as the organiser's property. The signature paragraph
 * is true of both paths, the link and the paper at the desk, and says the ID on the paper original
 * is covered within seven days.
 *
 * **A Romanian lawyer should read it before the club approves it.** These notes are the platform's
 * reading of the Civil Code, not legal advice: the text limits itself to what the law allows, but
 * only a lawyer can say that it does, and the club is the one that approves and relies on it in
 * `/admin/legal`. The liability paragraph is the one to ask about first.
 *
 * **No hardcoded value (§357).** One approved declaration serves every event, so nothing in it
 * names an event, a place, a date or a distance — those are the merge fields — and nothing names
 * the club but the footnote's placeholder: "the trails the event uses", never a mountain or a town.
 * `tests/unit/legal-documents/no-hardcoded-values.test.ts` holds all three templates to it.
 */
export const declarationRo: LegalDocumentBody = {
  sections: [
    {
      paragraphs: [
        "Subsemnatul/a {{participant}}, posesor/posesoare al/a actului de identitate {{participantIdDocument}}, declar că particip pe propria răspundere la evenimentul {{event}}, care va avea loc în data de {{eventDate}}, în locația {{eventLocation}}. Declar că datele și cele afirmate în această declarație sunt adevărate, că am citit cu atenție regulamentul și detaliile evenimentului de pe pagina lui de pe site-ul clubului și că sunt de acord cu acestea în totalitate. Știu că, dacă cele declarate nu sunt adevărate, răspund eu pentru urmările acestui fapt.",
        "Dacă participantul este minor, declarația este semnată și de părintele sau tutorele legal: {{guardian}}, posesor/posesoare al/a actului de identitate {{guardianIdDocument}}. Pentru un minor care a împlinit 14 ani, acesta își dă încuviințarea prealabilă ca minorul să participe și să semneze. Pentru un minor sub 14 ani, semnează singur, în numele minorului, ca reprezentant legal, și își asumă cele declarate aici; minorul nu semnează și nu i se cere actul de identitate.",
        "Particip de bunăvoie, știind că alergarea — mai ales pe teren accidentat, pe vreme schimbătoare, după lăsarea întunericului sau pe drumuri deschise circulației — presupune riscuri pe care nici organizatorul*, nici eu nu le putem înlătura în întregime și pe care le enumăr mai jos. Le accept în cunoștință de cauză și îmi asum obligațiile de mai jos. Știu că această acceptare nu înseamnă, prin ea însăși, că renunț la dreptul de a fi despăgubit (art. 1355 alin. (4) din Codul civil) și că nu înlătură răspunderea organizatorului pentru prejudiciile cauzate cu intenție sau din culpă gravă ori pentru vătămarea integrității corporale sau a sănătății, în afara cazurilor prevăzute de lege. Organizatorul nu răspunde, în limitele permise de lege, pentru prejudiciile datorate exclusiv faptei mele, nerespectării de către mine a regulamentului, a indicațiilor organizatorului ori a obligațiilor din această declarație, sau faptei unui terț pentru care organizatorul nu este ținut să răspundă (art. 1352 și art. 1371 din Codul civil). Răspund, potrivit legii, pentru prejudiciile pe care le cauzez altor persoane.",
        "• Voi respecta regulamentul evenimentului, îndrumările și indicațiile organizatorului și ale voluntarilor de traseu;",
        "• Cunosc și accept riscurile participării la evenimente de alergare: teren neregulat, condiții meteo schimbătoare, trafic acolo unde traseul folosește drumuri publice, accidentare sau agravarea unei afecțiuni preexistente;",
        "• Unde traseul folosește drumuri deschise circulației, respect regulile de circulație și indicațiile poliției, ale organizatorului și ale voluntarilor; știu că drumul nu este închis traficului decât dacă pagina evenimentului o spune;",
        "• Știu că traseele pot avea porțiuni abrupte, rădăcini, pietre, noroi, frunze ude, gheață sau zăpadă și accept riscul de cădere, alunecare, entorsă, tăieturi sau lovituri; îmi adaptez ritmul la teren și la condiții;",
        "• Știu că traseele pe care se desfășoară evenimentul pot traversa habitatul animalelor sălbatice — urși, mistreți, vipere, căpușe — și că pot întâlni câini, inclusiv câini de stână. Cunosc regulile de bază: păstrez distanța, nu hrănesc animalele și nu mă apropii de ele, nu fug de un urs, ci mă retrag încet și calm, anunț organizatorul și, la nevoie, sun la 112. Accept riscul unor astfel de întâlniri;",
        "• Știu că vremea se poate schimba — căldură, frig, ploaie, furtună, fulgere — și că după lăsarea întunericului vizibilitatea scade; accept că organizatorul poate modifica, scurta, opri sau anula evenimentul pentru siguranța participanților;",
        "• Știu că efortul pe căldură, frig, vânt sau ploaie poate duce la deshidratare, epuizare termică sau hipotermie: beau apă, mă echipez pentru vreme și mă opresc la primele semne;",
        "• Echipamentul este responsabilitatea mea: încălțăminte potrivită terenului (pe traseele montane, pantofi de trail), îmbrăcăminte potrivită vremii, apă și un telefon mobil încărcat; la alergările care se desfășoară sau se termină după lăsarea întunericului, o lanternă frontală funcțională, cu bateriile încărcate, iar pe drumuri, elemente reflectorizante. Știu că organizatorul poate refuza startul unui participant care nu are echipamentul obligatoriu anunțat în regulamentul evenimentului;",
        "• După cunoștința mea, starea mea de sănătate îmi permite efortul acestui eveniment și niciun medic nu mi-a interzis un astfel de efort. Știu că efortul intens poate provoca, rar, probleme grave, inclusiv cardiace, și că, dacă am o afecțiune cunoscută, trebuie să cer înainte sfatul medicului;",
        "• Alerg în ritmul meu și îmi cunosc limitele: mă opresc dacă nu mă simt bine, urmez traseul marcat și anunț organizatorul dacă abandonez sau părăsesc traseul. Știu că pe unele porțiuni ajutorul poate ajunge greu și târziu, de aceea am telefonul la mine și, la nevoie, sun la 112. Nu particip sub influența alcoolului, a drogurilor sau a medicamentelor care îmi scad atenția. Accept să primesc primul ajutor și să fiu oprit/ă din eveniment dacă organizatorul sau echipajul medical o consideră necesar. Deciziile pe care le iau pe traseu îmi aparțin;",
        "• Voi participa în spiritul sportivității și al fair-play-ului, în limita capacităților mele, evitând expunerea la riscuri inutile;",
        "• În ariile naturale protejate rămân pe traseele marcate și nu las în urmă niciun deșeu;",
        "• Obiectele personale le am asupra mea sau le las pe răspunderea mea; accept că organizatorul nu răspunde, în limitele permise de lege, pentru pierderea sau deteriorarea lor;",
        "• Kitul de participare se ridică personal, pe baza actului de identitate menționat lângă semnătura proprie — pentru un participant minor sub 14 ani, al părintelui ori tutorelui legal, care ridică kitul în locul lui; pentru unul de 14–17 ani, propriul act de identitate al minorului.",
        "Îmi asum responsabilitatea pentru propria siguranță, pentru echipamentul meu și pentru deciziile pe care le iau pe traseu.",
        "Am luat la cunoștință că la eveniment se fac fotografii și filmări, iar pe cele făcute de organizator sau în numele lui acesta le poate publica pentru a povesti evenimentul, în condițiile descrise în nota de confidențialitate — unde este descris și cum pot cere oricând să nu apar. Sunt de acord cu termenii și condițiile clubului, în versiunea acceptată la înscriere, și cu regulamentul evenimentului.",
        "Dacă vin la eveniment însoțit/însoțită de minori care nu sunt înscriși, aceștia rămân în grija și sub supravegherea mea pe toată durata evenimentului. Organizatorul nu preia supravegherea lor, iar un minor care nu este înscris nu poate lua parte la cursă.",
        "De asemenea, sunt informat/ă că datele cu caracter personal din această declarație sunt prelucrate conform Regulamentului (UE) 2016/679 (GDPR) și notei de confidențialitate a clubului, pentru organizarea și desfășurarea acestui eveniment și, după el, ca dovadă a declarației, și că sunt păstrate trei ani de la data evenimentului (seria și numărul actelor de identitate, șapte zile de la eveniment).",
        "Dacă semnez electronic, din linkul trimis pe adresa de email confirmată, numele scris mai jos (pentru un participant minor, al minorului și al părintelui ori tutorelui legal), bifa de acceptare, momentul semnării și amprenta textului citit sunt înregistrate împreună: este o semnătură electronică simplă, căreia nu i se poate refuza efectul juridic doar pentru că este electronică (art. 25 alin. (1) din Regulamentul (UE) nr. 910/2014 (eIDAS); Legea nr. 214/2024 privind utilizarea semnăturii electronice, a mărcii temporale și prestarea serviciilor de încredere bazate pe acestea). Semnez personal; o înscriere făcută de altcineva, pe adresa sa de email, nu îi dă dreptul să semneze în locul meu. Dacă semnez pe hârtie, la masa de înscrieri, un membru al echipei înregistrează semnătura în platformă, cu numele său, iar clubul păstrează originalul. În ambele cazuri primesc o copie pe adresa de email confirmată, iar arhiva clubului păstrează o copie cu seria și numărul actelor de identitate mascate (rămân cel mult primele două și ultimele două caractere); pe originalul de hârtie, clubul le acoperă în cel mult șapte zile de la eveniment.",
        "*Prin Organizator se înțelege <DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI>.",
      ],
    },
  ],
};

export const declarationEn: LegalDocumentBody = {
  sections: [
    {
      paragraphs: [
        "I, {{participant}}, holder of identity document {{participantIdDocument}}, declare that I take part at my own risk in the event {{event}}, which takes place on {{eventDate}} at {{eventLocation}}. I declare that the information and statements in this declaration are true, that I have read the event's rules and details carefully on its page on the club's website and that I agree with them in full. I know that if what I declare is not true, I answer for the consequences.",
        "If the participant is a minor, this declaration is also signed by the parent or legal guardian: {{guardian}}, holder of identity document {{guardianIdDocument}}. For a minor aged 14 or over, the parent or guardian gives prior consent to the minor taking part and signing. For a minor under 14, the parent or guardian signs alone, in the minor's name, as legal representative, and takes on what is declared here; the minor does not sign and is not asked for an identity document.",
        "I take part of my own free will, knowing that running — especially on rough ground, in changing weather, after dark or on roads open to traffic — carries risks that neither the organiser* nor I can remove entirely, and which I list below. I accept them knowingly and take on the obligations below. I know that this acceptance is not, by itself, a waiver of my right to compensation (art. 1355(4) of the Romanian Civil Code), and that it does not exclude the organiser's liability for harm caused intentionally or through gross negligence, or for harm to bodily integrity or health, except where the law provides. The organiser is not responsible, to the extent the law allows, for harm due solely to my own conduct, to my failure to follow the event's rules, the organiser's instructions or the obligations in this declaration, or to the act of a third party for whom the organiser is not answerable (art. 1352 and art. 1371 of the Civil Code). I am liable, under the law, for harm I cause to others.",
        "• I will follow the event's rules and the instructions of the organiser and the course marshals;",
        "• I know and accept the risks of taking part in running events: uneven ground, changing weather, traffic where the course uses public roads, injury, or the worsening of an existing condition;",
        "• Where the course uses roads open to traffic, I follow the traffic rules and the instructions of the police, the organiser and the marshals; I know the road is not closed to traffic unless the event's page says so;",
        "• I know the course may have steep sections, roots, rocks, mud, wet leaves, ice or snow, and I accept the risk of falls, slips, sprains, cuts and knocks; I adapt my pace to the ground and the conditions;",
        "• I know the trails the event uses may cross the habitat of wild animals — bears, wild boar, vipers, ticks — and that I may meet dogs, sheepdogs included. I know the basic rules: keep my distance, never feed or approach an animal, never run from a bear but back away slowly and calmly, tell the organiser and, if needed, call 112. I accept the risk of such encounters;",
        "• I know the weather can change — heat, cold, rain, storms, lightning — and that visibility drops after dark; I accept that the organiser may change, shorten, stop or cancel the event for the participants' safety;",
        "• I know that effort in heat, cold, wind or rain can lead to dehydration, heat exhaustion or hypothermia: I drink, dress for the weather and stop at the first signs;",
        "• My equipment is my own responsibility: footwear suited to the terrain (trail shoes on mountain trails), clothing suited to the weather, water and a charged mobile phone; for runs that take place or end after dark, a working headlamp with charged batteries and, on roads, reflective elements. I know the organiser may refuse the start to a participant without the mandatory equipment the event's rules announce;",
        "• To the best of my knowledge my health allows the effort of this event, and no doctor has told me to avoid such effort. I know that intense effort can, rarely, cause serious problems, including cardiac ones, and that if I have a known condition I should ask a doctor's advice beforehand;",
        "• I run at my own pace and know my limits: I stop if I feel unwell, keep to the marked course and tell the organiser if I drop out or leave the course. I know that on parts of the course help can be slow and late to arrive, so I carry my phone and, if needed, call 112. I do not take part under the influence of alcohol, drugs or medicines that impair my attention. I accept receiving first aid and being stopped from continuing if the organiser or the medical crew judge it necessary. The decisions I make on the course are my own;",
        "• I will take part in the spirit of sportsmanship and fair play, within my abilities, avoiding needless risks;",
        "• In protected natural areas I keep to the marked trails and leave no waste behind;",
        "• I carry or leave my personal belongings at my own risk, and I accept that the organiser is not responsible, to the extent the law allows, for their loss or damage;",
        "• The race kit is collected in person, against the identity document named beside that signature — for a minor participant under 14, the parent's or legal guardian's, who collects the kit on the minor's behalf; for one aged 14–17, the minor's own identity document.",
        "I take responsibility for my own safety, my equipment and the decisions I make on the course.",
        "I acknowledge that photographs and film are made at the event and that the organiser may publish those made by it or on its behalf to tell the event's story, under the conditions described in the privacy notice — which also says how I can ask at any time not to appear. I agree with the club's terms and conditions, in the version accepted when registering, and with the event's rules.",
        "If I come to the event with minors who are not registered, they remain in my care and under my supervision throughout the event. The organiser does not take over their supervision, and a minor who is not registered may not take part in the race.",
        "I am also informed that the personal data in this declaration is processed under Regulation (EU) 2016/679 (GDPR) and the club's privacy notice, to organise and run this event and, afterwards, as evidence of the declaration, and is kept for three years from the date of the event (the identity documents' series and numbers, seven days from the event).",
        "If I sign electronically, from the link sent to my confirmed email address, the name written below (for a minor participant, the minor's and the parent's or legal guardian's), the acceptance tick, the moment of signing and the fingerprint of the text read are recorded together: this is a simple electronic signature, which cannot be denied legal effect solely because it is electronic (art. 25(1) of Regulation (EU) No 910/2014 (eIDAS); Romanian Law no. 214/2024 on the use of electronic signatures, time stamps and the provision of trust services based on them). I sign personally; a registration made by someone else, on their own email address, does not entitle them to sign in my place. If I sign on paper at the registration desk, a team member records the signature in the platform under their own name, and the club keeps the original. Either way a copy is sent to my confirmed email address, and the club's archive keeps a copy with the identity documents' series and numbers masked (at most the first two and last two characters remain); on the paper original, the club covers them within seven days of the event.",
        "*Organiser means <THE CLUB'S FULL LEGAL NAME>.",
      ],
    },
  ],
};
