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
 * Since a minor's declaration is signed by the minor and a parent or guardian together (§330),
 * the text opens with the participant and their own document (`{{participant}}`,
 * `{{participantIdDocument}}`) and names the parent in a sentence of its own (`{{guardian}}`,
 * `{{guardianIdDocument}}`), which for an adult reads an em dash in both places — the paper form's
 * "for minors" line left empty. `{{declarant}}` and `{{idDocument}}` still work in every text the
 * club approved before; this template simply no longer needs them.
 *
 * **The runner takes ownership (§NNN).** The owner, 2026-09-24: the declaration must "cover us on
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
 * sentence that says the organiser does not answer for something — the liability paragraph, the
 * belongings bullet, the paragraph on minors the runner brings along — carries "în limitele
 * permise de lege" ("to the extent the law allows").
 *
 * **A Romanian lawyer should read it before the club approves it.** These notes are the platform's
 * reading of the Civil Code, not legal advice: the text limits itself to what the law allows, but
 * only a lawyer can say that it does, and the club is the one that approves and relies on it in
 * `/admin/legal`. The paragraphs carried over from the club's paper form — the liability
 * paragraph and the one on minors — are the ones to ask about first.
 *
 * **No hardcoded value (§NNN).** One approved declaration serves every event, so nothing in it
 * names an event, a place, a date or a distance — those are the merge fields — and nothing names
 * the club but the footnote's placeholder: "the trails the event uses", never a mountain or a town.
 * `tests/unit/legal-documents/no-hardcoded-values.test.ts` holds all three templates to it.
 */
export const declarationRo: LegalDocumentBody = {
  sections: [
    {
      paragraphs: [
        "Subsemnatul/a {{participant}}, posesor/posesoare al actului de identitate {{participantIdDocument}}, declar că particip pe proprie răspundere la evenimentul {{event}}, care va avea loc în data de {{eventDate}}, în locația {{eventLocation}}. Având în vedere prevederile legale privind falsul în declarații, declar că am citit cu atenție regulamentul și detaliile evenimentului de pe pagina lui de pe site-ul clubului și sunt de acord cu acestea în totalitate.",
        "Dacă participantul este minor, declarația este semnată și de părintele sau tutorele legal: {{guardian}}, posesor/posesoare al actului de identitate {{guardianIdDocument}}, care își dă acordul pentru participarea minorului și își asumă, în numele lui, cele declarate aici.",
        "Prin semnarea acestei declarații, accept și sunt de acord cu faptul că organizatorul*, precum și alți participanți la eveniment, nu pot fi răspunzători în niciun fel pentru orice pagubă, rănire, deces sau pierdere de orice fel cauzată mie sau de mine în timpul sau ca urmare a participării mele la eveniment, în limitele permise de lege.",
        "• Voi respecta regulamentul evenimentului, îndrumările și indicațiile organizatorului și ale voluntarilor de traseu;",
        "• Cunosc și accept riscurile participării la evenimente de alergare: teren neregulat, condiții meteo schimbătoare, trafic acolo unde traseul folosește drumuri publice, accidentare sau agravarea unei afecțiuni preexistente;",
        "• Știu că traseele pot avea porțiuni abrupte, rădăcini, pietre, noroi, frunze ude, gheață sau zăpadă și accept riscul de cădere, alunecare, entorsă, tăieturi sau lovituri; îmi adaptez ritmul la teren și la condiții;",
        "• Știu că traseele pe care se desfășoară evenimentul pot traversa habitatul animalelor sălbatice — urși, mistreți, vipere, căpușe — și că pot întâlni câini, inclusiv câini de stână. Cunosc regulile de bază: păstrez distanța, nu hrănesc animalele și nu mă apropii de ele, nu fug de un urs, ci mă retrag încet și calm, anunț organizatorul și, la nevoie, sun la 112. Accept riscul unor astfel de întâlniri;",
        "• Știu că vremea se poate schimba — căldură, frig, ploaie, furtună, fulgere — și că după lăsarea întunericului vizibilitatea scade; accept că organizatorul poate modifica, scurta, opri sau anula evenimentul pentru siguranța participanților;",
        "• Echipamentul este responsabilitatea mea: încălțăminte potrivită terenului (pe traseele montane, pantofi de trail), îmbrăcăminte potrivită vremii, apă și un telefon mobil încărcat; la alergările care se desfășoară sau se termină după lăsarea întunericului, o lanternă frontală funcțională, cu bateriile încărcate, iar pe drumuri, elemente reflectorizante. Știu că organizatorul poate refuza startul unui participant care nu are echipamentul obligatoriu anunțat în regulamentul evenimentului;",
        "• Starea mea de sănătate este corespunzătoare pentru a suporta efort intens și nu am boli care să îmi interzică practicarea sportului;",
        "• Alerg în ritmul meu și îmi cunosc limitele: mă opresc dacă nu mă simt bine, urmez traseul marcat și anunț organizatorul dacă abandonez. Știu că o alergare în grup nu este o tură ghidată și că deciziile pe care le iau pe traseu îmi aparțin;",
        "• Voi concura în spiritul sportivității și al fair-play-ului, în limita capacităților mele, evitând expunerea la riscuri inutile;",
        "• În ariile naturale protejate rămân pe traseele marcate și nu las în urmă niciun deșeu;",
        "• Obiectele personale le am asupra mea sau le las pe răspunderea mea; accept că organizatorul nu răspunde, în limitele permise de lege, pentru pierderea sau deteriorarea lor;",
        "• Kitul de participare se ridică personal, pe baza actului de identitate menționat mai sus — pentru un participant minor, al minorului sau al părintelui ori tutorelui legal.",
        "Îmi asum responsabilitatea pentru propria siguranță, pentru echipamentul meu și pentru deciziile pe care le iau pe traseu.",
        "Am luat la cunoștință că la eveniment se fac fotografii și filmări, care rămân proprietatea intelectuală a organizatorului și pe care acesta le poate publica pentru a povesti evenimentul, în condițiile descrise în nota de confidențialitate — unde este descris și cum pot cere oricând să nu apar. Sunt de acord cu termenii, condițiile și regulamentul evenimentului.",
        "În cazul în care voi fi însoțit/însoțită de persoane minore, îmi asum integral răspunderea pentru siguranța acestora pe parcursul evenimentului. Înțeleg că organizatorul nu poate fi tras la răspundere, în limitele permise de lege, pentru eventualele accidente sau incidente care ar putea surveni.",
        "De asemenea, sunt informat/ă că datele cu caracter personal din această declarație sunt prelucrate conform Regulamentului (UE) 2016/679 (GDPR) și notei de confidențialitate a clubului, pentru organizarea și desfășurarea acestui eveniment și, după el, ca dovadă a declarației, și că sunt păstrate trei ani de la data evenimentului (seria și numărul actelor de identitate, șapte zile de la eveniment).",
        "Această declarație este semnată electronic: numele scris mai jos (pentru un participant minor, al minorului și al părintelui ori tutorelui legal), bifa de acceptare, momentul semnării și amprenta textului citit sunt înregistrate împreună (semnătură electronică simplă, în sensul Regulamentului (UE) nr. 910/2014 (eIDAS) și al Legii nr. 214/2024 privind utilizarea semnăturii electronice). O copie îmi este trimisă pe adresa de email confirmată, iar una, cu seria și numărul actelor de identitate mascate (rămân cel mult primele două și ultimele două caractere), ajunge în arhiva clubului.",
        "*Prin Organizator se înțelege <DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI>.",
      ],
    },
  ],
};

export const declarationEn: LegalDocumentBody = {
  sections: [
    {
      paragraphs: [
        "I, {{participant}}, holder of identity document {{participantIdDocument}}, declare that I take part at my own responsibility in the event {{event}}, which takes place on {{eventDate}} at {{eventLocation}}. Aware of the legal provisions on false statements, I declare that I have read the event's rules and details carefully on its page on the club's website and that I agree with them in full.",
        "If the participant is a minor, this declaration is also signed by the parent or legal guardian: {{guardian}}, holder of identity document {{guardianIdDocument}}, who consents to the minor taking part and takes on, in the minor's name, what is declared here.",
        "By signing this declaration I accept and agree that the organiser*, as well as the other participants in the event, cannot be held liable in any way for any damage, injury, death or loss of any kind caused to me or by me during or as a result of my taking part in the event, to the extent the law allows.",
        "• I will follow the event's rules and the instructions of the organiser and the course marshals;",
        "• I know and accept the risks of taking part in running events: uneven ground, changing weather, traffic where the course uses public roads, injury, or the worsening of an existing condition;",
        "• I know the course may have steep sections, roots, rocks, mud, wet leaves, ice or snow, and I accept the risk of falls, slips, sprains, cuts and knocks; I adapt my pace to the ground and the conditions;",
        "• I know the trails the event uses may cross the habitat of wild animals — bears, wild boar, vipers, ticks — and that I may meet dogs, sheepdogs included. I know the basic rules: keep my distance, never feed or approach an animal, never run from a bear but back away slowly and calmly, tell the organiser and, if needed, call 112. I accept the risk of such encounters;",
        "• I know the weather can change — heat, cold, rain, storms, lightning — and that visibility drops after dark; I accept that the organiser may change, shorten, stop or cancel the event for the participants' safety;",
        "• My equipment is my own responsibility: footwear suited to the terrain (trail shoes on mountain trails), clothing suited to the weather, water and a charged mobile phone; for runs that take place or end after dark, a working headlamp with charged batteries and, on roads, reflective elements. I know the organiser may refuse the start to a participant without the mandatory equipment the event's rules announce;",
        "• My state of health is adequate for intense effort and I have no illness that forbids me from doing sport;",
        "• I run at my own pace and know my limits: I stop if I feel unwell, keep to the marked course and tell the organiser if I drop out. I know that a group run is not a guided tour and that the decisions I make on the course are my own;",
        "• I will compete in the spirit of sportsmanship and fair play, within my abilities, avoiding needless risks;",
        "• In protected natural areas I keep to the marked trails and leave no waste behind;",
        "• I carry or leave my personal belongings at my own risk, and I accept that the organiser is not responsible, to the extent the law allows, for their loss or damage;",
        "• The race kit is collected in person, against the identity document named above — for a minor participant, the minor's or the parent's or legal guardian's.",
        "I take responsibility for my own safety, my equipment and the decisions I make on the course.",
        "I acknowledge that photographs and film are made at the event, that they remain the organiser's intellectual property and that the organiser may publish them to tell the event's story, under the conditions described in the privacy notice — which also says how I can ask at any time not to appear. I agree with the event's terms, conditions and rules.",
        "If I am accompanied by minors, I take full responsibility for their safety throughout the event. I understand that the organiser cannot be held liable, to the extent the law allows, for any accident or incident that may occur.",
        "I am also informed that the personal data in this declaration is processed under Regulation (EU) 2016/679 (GDPR) and the club's privacy notice, to organise and run this event and, afterwards, as evidence of the declaration, and is kept for three years from the date of the event (the identity documents' series and numbers, seven days from the event).",
        "This declaration is signed electronically: the name written below (for a minor participant, the minor's and the parent's or legal guardian's), the acceptance tick, the moment of signing and the fingerprint of the text read are recorded together (a simple electronic signature under Regulation (EU) 910/2014 (eIDAS) and Romanian Law no. 214/2024 on the use of electronic signatures). A copy is sent to my confirmed email address, and one, with the identity documents' series and numbers masked (at most the first two and last two characters remain), to the club's archive.",
        "*Organiser means <THE CLUB'S FULL LEGAL NAME>.",
      ],
    },
  ],
};
