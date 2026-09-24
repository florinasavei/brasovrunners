import { describe, expect, it } from "vitest";
import { mergeFieldsIn } from "@/modules/legal-documents/domain/merge-fields";
import { declarationEn, declarationRo } from "@/modules/legal-documents/templates/declaration";

/**
 * §NNN — the owner, 2026-09-24: the declaration must "cover us on the encounters with wild
 * animals, proper equipment (shoes, headlamp for night running), falling, etc — basically the
 * runner takes ownership of everything".
 *
 * The platform's declaration names each of those risks, in both languages, as a bullet in the
 * text's own "• …;" style, and closes them with the owner's sentence. It is written as informed
 * acceptance of a risk plus the runner's own obligations — the Civil Code does not let a text
 * remove liability for intent or gross fault, or for harm to the body or health except as the
 * law allows (art. 1355), and accepting a risk is not a waiver of damages — so the new bullets
 * promise nobody immunity, and the liability paragraph keeps its "to the extent the law allows".
 */
const paragraphs = { ro: declarationRo.sections.flatMap((s) => s.paragraphs), en: declarationEn.sections.flatMap((s) => s.paragraphs) };
const bullets = { ro: paragraphs.ro.filter((p) => p.startsWith("• ")), en: paragraphs.en.filter((p) => p.startsWith("• ")) };

/** Each risk the owner named, and the words that say it in each language. */
const RISKS: ReadonlyArray<{ risk: string; ro: RegExp[]; en: RegExp[] }> = [
  { risk: "wild animals and dogs", ro: [/animalelor sălbatice/, /urși/, /mistreți/, /vipere/, /căpușe/, /câini de stână/], en: [/wild animals/, /bears/, /wild boar/, /vipers/, /ticks/, /sheepdogs/] },
  {
    risk: "what to do when one is met",
    ro: [/păstrez distanța/, /nu hrănesc/, /nu mă apropii/, /nu fug de un urs/, /mă retrag încet și calm/, /anunț organizatorul/, /112/],
    en: [/keep my distance/, /never feed or approach/, /never run from a bear/, /back away slowly and calmly/, /tell the organiser/, /112/],
  },
  { risk: "terrain and falls", ro: [/porțiuni abrupte/, /rădăcini/, /gheață sau zăpadă/, /cădere/, /entorsă/, /îmi adaptez ritmul/], en: [/steep sections/, /roots/, /ice or snow/, /falls/, /sprains/, /adapt my pace/] },
  { risk: "the weather and the dark", ro: [/fulgere/, /întunericului/, /modifica, scurta, opri sau anula/], en: [/lightning/, /after dark/, /change, shorten, stop or cancel/] },
  {
    risk: "the runner's own equipment, a headlamp after dark",
    ro: [/Echipamentul este responsabilitatea mea/, /pantofi de trail/, /telefon mobil încărcat/, /lanternă frontală funcțională/, /bateriile încărcate/, /elemente reflectorizante/, /refuza startul/],
    en: [/equipment is my own responsibility/, /trail shoes/, /charged mobile phone/, /working headlamp/, /charged batteries/, /reflective elements/, /refuse the start/],
  },
  { risk: "own pace and decisions", ro: [/în ritmul meu/, /mă opresc dacă nu mă simt bine/, /traseul marcat/, /abandonez/, /nu este o tură ghidată/], en: [/at my own pace/, /stop if I feel unwell/, /marked course/, /drop out/, /not a guided tour/] },
  { risk: "personal belongings", ro: [/Obiectele personale/, /pierderea sau deteriorarea/], en: [/personal belongings/, /loss or damage/] },
  { risk: "protected areas", ro: [/ariile naturale protejate/, /niciun deșeu/], en: [/protected natural areas/, /no waste/] },
];

describe("§NNN the runner takes ownership — the declaration's risks", () => {
  for (const { risk, ro, en } of RISKS) {
    it(`names ${risk}, in both languages, in a bullet`, () => {
      for (const pattern of ro) expect(bullets.ro.some((b) => pattern.test(b)), `ro ${pattern}`).toBe(true);
      for (const pattern of en) expect(bullets.en.some((b) => pattern.test(b)), `en ${pattern}`).toBe(true);
    });
  }

  it("closes the bullets with the owner's sentence, as a paragraph of its own", () => {
    const ro = paragraphs.ro.indexOf("Îmi asum responsabilitatea pentru propria siguranță, pentru echipamentul meu și pentru deciziile pe care le iau pe traseu.");
    const en = paragraphs.en.indexOf("I take responsibility for my own safety, my equipment and the decisions I make on the course.");
    expect(ro).toBeGreaterThan(-1);
    expect(en).toBeGreaterThan(-1);
    // Straight after the last bullet, in the same place in both languages.
    expect(paragraphs.ro[ro - 1].startsWith("• ")).toBe(true);
    expect(paragraphs.en[en - 1].startsWith("• ")).toBe(true);
    expect(ro).toBe(en);
  });

  it("keeps the text's bullet style: each ends with a semicolon, the last with a full stop", () => {
    for (const locale of ["ro", "en"] as const) {
      const list = bullets[locale];
      expect(list.length, locale).toBe(12);
      for (const bullet of list.slice(0, -1)) expect(bullet.endsWith(";"), `${locale}: ${bullet.slice(0, 40)}`).toBe(true);
      expect(list.at(-1)!.endsWith("."), locale).toBe(true);
    }
    // One text per language, the same shape: paragraph for paragraph.
    expect(paragraphs.ro.length).toBe(paragraphs.en.length);
    paragraphs.ro.forEach((p, i) => expect(p.startsWith("• "), `paragraph ${i}`).toBe(paragraphs.en[i].startsWith("• ")));
  });

  it("promises nobody immunity: the new bullets accept a risk and set out conduct, and the liability paragraph keeps its limit", () => {
    const immunity = { ro: /în niciun fel|nu (?:pot|poate) fi (?:tras|trasă|trași|răspunz)|renunț/i, en: /in any way|cannot be held liable|waive/i };
    for (const locale of ["ro", "en"] as const) {
      const owned = bullets[locale].filter((b) => RISKS.some((risk) => risk[locale].some((pattern) => pattern.test(b))));
      expect(owned.length, locale).toBeGreaterThanOrEqual(7);
      for (const bullet of owned) expect(bullet, `${locale}: ${bullet.slice(0, 40)}`).not.toMatch(immunity[locale]);
    }
    expect(paragraphs.ro.some((p) => p.includes("nu pot fi răspunzători") && p.includes("în limitele permise de lege"))).toBe(true);
    expect(paragraphs.en.some((p) => p.includes("cannot be held liable") && p.includes("to the extent the law allows"))).toBe(true);
  });

  it("keeps every merge field exactly as before, and the club's name as the footnote's placeholder", () => {
    const expected = ["event", "eventDate", "eventLocation", "guardian", "guardianIdDocument", "participant", "participantIdDocument"];
    expect([...mergeFieldsIn(declarationRo)].sort()).toEqual(expected);
    expect([...mergeFieldsIn(declarationEn)].sort()).toEqual(expected);
    expect(paragraphs.ro.at(-1)).toBe("*Prin Organizator se înțelege <DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI>.");
    expect(paragraphs.en.at(-1)).toBe("*Organiser means <THE CLUB'S FULL LEGAL NAME>.");
  });
});
