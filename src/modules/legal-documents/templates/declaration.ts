import type { LegalDocumentBody } from "../domain/content-hash";

/**
 * The club's declaration, as the paper one reads (`DECISIONS.md` §95) — the text the organiser
 * handed over on 2026-09-18, with the blanks as merge fields (`domain/merge-fields.ts`) so one
 * approved version serves every event: the participant, the identity document, the event, its
 * date and its place are filled in when the declaration is shown, signed and printed.
 *
 * Written for the club to approve in `/admin/legal` (the "start from the platform's text"
 * link prefills it). The one fact left to the club is its own legal name, in the footnote.
 */
export const declarationRo: LegalDocumentBody = {
  sections: [
    {
      paragraphs: [
        "Subsemnatul/a {{declarant}}, posesor/posesoare al actului de identitate {{idDocument}} — în nume propriu sau, pentru un participant minor, în calitate de părinte ori tutore legal —, declar că particip pe proprie răspundere la evenimentul {{event}}, care va avea loc în data de {{eventDate}}, în locația {{eventLocation}}. Având în vedere prevederile legale privind falsul în declarații, declar că am citit cu atenție regulamentul și detaliile evenimentului de pe pagina lui de pe site-ul clubului și sunt de acord cu acestea în totalitate.",
        "Prin semnarea acestei declarații, accept și sunt de acord cu faptul că organizatorul*, precum și alți participanți la eveniment, nu pot fi răspunzători în niciun fel pentru orice pagubă, rănire, deces sau pierdere de orice fel cauzată mie sau de mine în timpul sau ca urmare a participării mele la eveniment, în limitele permise de lege.",
        "• Voi respecta regulamentul evenimentului, îndrumările și indicațiile organizatorului și ale voluntarilor de traseu;",
        "• Cunosc și accept riscurile participării la evenimente de alergare: teren neregulat, condiții meteo schimbătoare, trafic acolo unde traseul folosește drumuri publice, accidentare sau agravarea unei afecțiuni preexistente;",
        "• Starea mea de sănătate este corespunzătoare pentru a suporta efort intens și nu am boli care să îmi interzică practicarea sportului;",
        "• Voi concura în spiritul sportivității și al fair-play-ului, în limita capacităților mele, evitând expunerea la riscuri inutile;",
        "• Kitul de participare se ridică personal, pe baza actului de identitate menționat mai sus.",
        "Am luat la cunoștință că la eveniment se fac fotografii și filmări, care rămân proprietatea intelectuală a organizatorului și pe care acesta le poate publica pentru a povesti evenimentul, în condițiile descrise în nota de confidențialitate — unde este descris și cum pot cere oricând să nu apar. Sunt de acord cu termenii, condițiile și regulamentul evenimentului.",
        "În cazul în care voi fi însoțit/însoțită de persoane minore, îmi asum integral răspunderea pentru siguranța acestora pe parcursul evenimentului. Înțeleg că organizatorul nu poate fi tras la răspundere pentru eventualele accidente sau incidente care ar putea surveni.",
        "De asemenea, sunt informat/ă că datele cu caracter personal din această declarație sunt prelucrate conform Regulamentului (UE) 2016/679 (GDPR) și notei de confidențialitate a clubului, pentru organizarea și desfășurarea acestui eveniment și, după el, ca dovadă a declarației, și că sunt păstrate trei ani de la data evenimentului (seria și numărul actului de identitate, șapte zile de la eveniment).",
        "Această declarație este semnată electronic: numele scris mai jos, bifa de acceptare, momentul semnării și amprenta textului citit sunt înregistrate împreună (semnătură electronică simplă, în sensul Regulamentului (UE) nr. 910/2014 (eIDAS) și al Legii nr. 214/2024 privind utilizarea semnăturii electronice). O copie îmi este trimisă pe adresa de email confirmată, iar una, fără seria și numărul actului de identitate, ajunge în arhiva clubului.",
        "*Prin Organizator se înțelege <DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI>.",
      ],
    },
  ],
};

export const declarationEn: LegalDocumentBody = {
  sections: [
    {
      paragraphs: [
        "I, {{declarant}}, holder of identity document {{idDocument}} — in my own name or, for a minor participant, as parent or legal guardian —, declare that I take part at my own responsibility in the event {{event}}, which takes place on {{eventDate}} at {{eventLocation}}. Aware of the legal provisions on false statements, I declare that I have read the event's rules and details carefully on its page on the club's website and that I agree with them in full.",
        "By signing this declaration I accept and agree that the organiser*, as well as the other participants in the event, cannot be held liable in any way for any damage, injury, death or loss of any kind caused to me or by me during or as a result of my taking part in the event, to the extent the law allows.",
        "• I will follow the event's rules and the instructions of the organiser and the course marshals;",
        "• I know and accept the risks of taking part in running events: uneven ground, changing weather, traffic where the course uses public roads, injury, or the worsening of an existing condition;",
        "• My state of health is adequate for intense effort and I have no illness that forbids me from doing sport;",
        "• I will compete in the spirit of sportsmanship and fair play, within my abilities, avoiding needless risks;",
        "• The race kit is collected in person, against the identity document named above.",
        "I acknowledge that photographs and film are made at the event, that they remain the organiser's intellectual property and that the organiser may publish them to tell the event's story, under the conditions described in the privacy notice — which also says how I can ask at any time not to appear. I agree with the event's terms, conditions and rules.",
        "If I am accompanied by minors, I take full responsibility for their safety throughout the event. I understand that the organiser cannot be held liable for any accident or incident that may occur.",
        "I am also informed that the personal data in this declaration is processed under Regulation (EU) 2016/679 (GDPR) and the club's privacy notice, to organise and run this event and, afterwards, as evidence of the declaration, and is kept for three years from the date of the event (the identity document's series and number, seven days from the event).",
        "This declaration is signed electronically: the name written below, the acceptance tick, the moment of signing and the fingerprint of the text read are recorded together (a simple electronic signature under Regulation (EU) 910/2014 (eIDAS) and Romanian Law no. 214/2024 on the use of electronic signatures). A copy is sent to my confirmed email address, and one, without my identity document's series and number, to the club's archive.",
        "*Organiser means <THE CLUB'S FULL LEGAL NAME>.",
      ],
    },
  ],
};
