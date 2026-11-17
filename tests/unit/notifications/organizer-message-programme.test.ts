import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { emailMessageType } from "@/db/schema/email-outbox";
import { type EmailEventFacts, eventFactsBlock, eventProgrammeBlock } from "@/modules/notifications/domain/event-facts";
import { readOrganizerIncludeProgramme } from "@/modules/notifications/domain/organizer-message";
import { isRelayMessage } from "@/modules/notifications/domain/relay";
import { emailSampleData, emailSampleEventFacts, emailSampleFor } from "@/modules/notifications/email-copy-fields";
import { buildOutgoingEmail, buildTemplateContent, HIGHLIGHT_TEXT_MARK, type TemplateData } from "@/modules/notifications/templates";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * `DECISIONS.md` §958 — «Include programul evenimentului» on «Trimite un mesaj participanților» (the owner, 2026-11-17,
 * four days before the race, writing the race week's message: «Vreau încă o bifă in acel eveniment de "include
 * program"»; BR-REQ-080-01). The pure half: the row's flag, the one builder of the «Program» row that the facts block
 * and this message both call, and the block in the message — one row, under the organizers' words, each half in its own
 * language, nothing else of the message moved. The send, the renderer, the preview and the screens are
 * `tests/integration/notifications/participant-message-programme.test.ts` and `…-programme-page.test.ts`.
 */

/** A race day's programme as the event row stores it (§117): Saturday, 21 November 2026, on the club's clock (UTC+2). */
const ROWS = [
  { startsAt: "2026-11-21T06:30:00.000Z", endsAt: "2026-11-21T07:30:00.000Z", label: { ro: "Ridicarea kiturilor", en: "Kit pickup" }, place: "Sala Sporturilor" },
  { startsAt: "2026-11-21T08:00:00.000Z", endsAt: null, label: { ro: "Startul", en: "The start" }, place: null },
];
const RO_LINES = ["08:30–09:30 — Ridicarea kiturilor (Sala Sporturilor)", "10:00 — Startul"];
const EN_LINES = ["08:30–09:30 — Kit pickup (Sala Sporturilor)", "10:00 — The start"];

const facts = (locale: "ro" | "en", scheduleItems: unknown = ROWS): EmailEventFacts => ({ ...emailSampleEventFacts(locale), scheduleItems });

const WORDS = {
  subject: { ro: "Ultimele detalii pentru {eventTitle}", en: "The last details for {eventTitle}" },
  body: { ro: "Salut, {participantName}!\n\nNe vedem sâmbătă la start.", en: "Hi, {participantName}!\n\nSee you on Saturday at the start." },
};

const DATA: TemplateData = {
  participantName: "Ana Pop",
  eventTitle: "Crosul de toamnă",
  eventTitleOther: "The autumn cross",
  eventLocationName: "Parcul Tractorul",
  eventStartsAtFormatted: "sâmbătă, 21 nov. 2026, 10:00",
  eventStartsAtFormattedOther: "Saturday, 21 Nov 2026, 10:00",
  eventMapUrl: "https://example.test/#map",
  eventUrl: "https://example.test/ro/evenimente/crosul-de-toamna",
  eventScheduleUrl: "https://example.test/ro/evenimente/crosul-de-toamna#schedule",
  eventRulesUrl: "https://example.test/ro/evenimente/crosul-de-toamna#rules",
  eventsUrl: "https://example.test/ro/evenimente",
  contactUrl: "https://example.test/ro/contact",
  myRegistrationsUrl: "https://example.test/ro/inscrieri/ale-mele",
  cannotComeUrl: "https://example.test/ro/EXAMPLE#cancel",
  bibNumber: 42,
  organizerSubject: WORDS.subject.ro,
  organizerSubjectOther: WORDS.subject.en,
  organizerBody: WORDS.body.ro,
  organizerBodyOther: WORDS.body.en,
  // What the renderer hands every message about an event (§392): each half's facts. The organizers' message reads
  // them only for the programme, and only with the flag.
  eventFacts: facts("ro"),
  eventFactsOther: facts("en"),
};
/** What the renderer adds for a row whose send ticked the box: the flag, and nothing of the programme. */
const TICKED: TemplateData = { ...DATA, organizerProgramme: true };

const render = (locale: "ro" | "en", data: TemplateData, messageType: (typeof emailMessageType.enumValues)[number] = "ORGANIZER_MESSAGE") =>
  buildOutgoingEmail({ to: "ana@example.ro", locale, idempotencyKey: `test:organizer-programme:${messageType}:${locale}`, messageType, data, actionUrl: DATA.eventUrl });

/** Every block of the facts block's kind in a message, whole. */
const blocks = (html: string) => [...html.matchAll(/<div data-email-part="event-facts"[^]*?<\/div>/g)].map((match) => match[0]);
/** A message without them — what is left must be the message of a send that did not tick. */
const htmlWithoutBlocks = (html: string) => html.replace(/<div data-email-part="event-facts"[^]*?<\/div>\n/g, "");
const textWithoutBlocks = (text: string) => text.replace(/\n\nProgram(?:me)?: [^\n]*(?:\n {2}[^\n]*)*/g, "");

describe("§958 the row's flag", () => {
  it("reads the flag from the row's payload, and nothing else as a yes", () => {
    expect(readOrganizerIncludeProgramme({ subject: {}, body: {}, includeProgramme: true })).toBe(true);
    expect(readOrganizerIncludeProgramme({ includeProgramme: true, clubCopy: true })).toBe(true);
    for (const payload of [null, undefined, {}, { includeProgramme: "true" }, { includeProgramme: 1 }, { includeProgramme: "1" }, { sendQr: true }, { programme: true }, "includeProgramme", ["includeProgramme"]]) {
      expect(readOrganizerIncludeProgramme(payload), JSON.stringify(payload)).toBe(false);
    }
  });
});

describe("§958 one builder for the «Program» row: the facts block and the programme alone say it the same", () => {
  it("draws the timed rows as one block of one row, each language its own labels", () => {
    const romanian = eventProgrammeBlock(facts("ro"), "ro");
    expect(romanian?.text).toBe(`Program: ${RO_LINES[0]}\n  ${RO_LINES[1]}`);
    expect(blocks(romanian?.html ?? "")).toHaveLength(1);
    expect(romanian?.html).toContain(`<strong>Program</strong><br>${RO_LINES.join("<br>")}`);
    const english = eventProgrammeBlock(facts("en"), "en");
    expect(english?.text).toBe(`Programme: ${EN_LINES[0]}\n  ${EN_LINES[1]}`);
    expect(english?.html).toContain(`<strong>Programme</strong><br>${EN_LINES.join("<br>")}`);
    // One row and no other: none of the block's other questions.
    for (const block of [romanian, english]) expect(block?.text).not.toMatch(/Când|When|Unde|Where|Traseu|Route|Cost|Linkuri|Links/);
  });

  it("is the very row the facts block draws — the same label and the same lines, in the text and in the HTML", () => {
    for (const locale of ["ro", "en"] as const) {
      const alone = eventProgrammeBlock(facts(locale), locale)!;
      const whole = eventFactsBlock(facts(locale), locale);
      expect(whole.text, locale).toContain(alone.text);
      // In the HTML the row is the same paragraph; only its margin differs — the last row of a block has none under it.
      const row = (html: string) => html.match(/<p style="margin:[^"]*;font-size:15px;line-height:1\.5"><strong>Program(?:me)?<\/strong>[^]*?<\/p>/)?.[0].replace(/margin:[^;]*;/, "");
      expect(row(alone.html), locale).toBeDefined();
      expect(row(whole.html), locale).toBe(row(alone.html));
      // The same box around it.
      expect(alone.html.slice(0, alone.html.indexOf("<p"))).toBe(whole.html.slice(0, whole.html.indexOf("<p")));
    }
  });

  it("writes the day before the hour when the programme spans several days, as the facts block does", () => {
    const twoDays = [{ startsAt: "2026-11-20T15:00:00.000Z", endsAt: "2026-11-20T18:00:00.000Z", label: { ro: "Ridicarea kiturilor", en: "Kit pickup" }, place: null }, ROWS[1]];
    const alone = eventProgrammeBlock(facts("ro", twoDays), "ro")!;
    expect(alone.text).toBe("Program: Vin., 20 nov. 2026, 17:00–20:00 — Ridicarea kiturilor\n  Sâm., 21 nov. 2026, 10:00 — Startul");
    expect(eventFactsBlock(facts("ro", twoDays), "ro").text).toContain(alone.text);
  });

  it("is nothing without a timed row: no rows, none stored, a shape that is not a programme", () => {
    for (const scheduleItems of [[], null, "08:30 kituri", { ro: "Program" }, [{ startsAt: "nu e o oră", endsAt: null, label: { ro: "x", en: "y" }, place: null }]]) {
      expect(eventProgrammeBlock(facts("ro", scheduleItems), "ro"), JSON.stringify(scheduleItems)).toBeUndefined();
      // …and the facts block has no «Program» row then either: the same answer from the same builder.
      expect(eventFactsBlock(facts("ro", scheduleItems), "ro").text, JSON.stringify(scheduleItems)).not.toMatch(/^Program:/m);
    }
  });

  it("escapes what the club typed", () => {
    const html = eventProgrammeBlock(facts("ro", [{ ...ROWS[0], label: { ro: "<b>Kituri</b> & numere", en: "Kits" }, place: 'Sala "Mare"' }]), "ro")!.html;
    expect(html).toContain("&lt;b&gt;Kituri&lt;/b&gt; &amp; numere (Sala &quot;Mare&quot;)");
    expect(html).not.toContain("<b>Kituri</b>");
  });
});

describe("§958 the programme in the organizers' message: one block, under the organizers' words", () => {
  it("draws one block per half with the row «Program» alone, each half in its own language, in the HTML and in the text", () => {
    const email = render("ro", TICKED);
    const found = blocks(email.html);
    expect(found).toHaveLength(2);
    expect(found[0]).toContain(`<strong>Program</strong><br>${RO_LINES.join("<br>")}`);
    expect(found[1]).toContain(`<strong>Programme</strong><br>${EN_LINES.join("<br>")}`);
    // Never the other language's labels in a half, and never the rest of the facts block.
    expect(found[0]).not.toContain("Kit pickup");
    expect(found[1]).not.toContain("Ridicarea kiturilor");
    for (const block of found) expect(block).not.toMatch(/Când|When|Unde|Where|Traseu|Route|Cost|Linkuri|Links|<a /);

    const [romanian, english] = email.text.split("\n— — —\n");
    expect(romanian).toContain(`\n\nProgram: ${RO_LINES[0]}\n  ${RO_LINES[1]}\n`);
    expect(english).toContain(`\n\nProgramme: ${EN_LINES[0]}\n  ${EN_LINES[1]}\n`);
    expect(romanian).not.toContain("Kit pickup");
    expect(english).not.toContain("Ridicarea kiturilor");
  });

  it("stands after the organizers' words and above the buttons, in both halves", () => {
    const email = render("ro", TICKED);
    const order = (needles: string[]) => needles.map((needle) => email.html.indexOf(needle));
    const [words, block, button, cannotCome] = order(["Ne vedem sâmbătă la start.", 'data-email-part="event-facts"', ">Vezi pagina evenimentului</a>", 'data-email-part="cannot-come"']);
    expect(words).toBeGreaterThan(-1);
    expect(block).toBeGreaterThan(words);
    expect(button).toBeGreaterThan(block);
    expect(cannotCome).toBeGreaterThan(button);
    // The second half the same: its words, then its block.
    expect(email.html.lastIndexOf('data-email-part="event-facts"')).toBeGreaterThan(email.html.indexOf("See you on Saturday at the start."));
    const [romanian, english] = email.text.split("\n— — —\n");
    expect(romanian.indexOf("Program: ")).toBeGreaterThan(romanian.indexOf("Ne vedem sâmbătă la start."));
    expect(romanian.indexOf("Program: ")).toBeLessThan(romanian.indexOf("Vezi pagina evenimentului: "));
    expect(english.indexOf("Programme: ")).toBeGreaterThan(english.indexOf("See you on Saturday at the start."));
  });

  it("stands under the number and the desk code when «Trimite și numărul de concurs și codul QR» is ticked too, the QR under it", () => {
    const code = "K7Q2XRABCD";
    const qr = `https://example.test/api/registrations/qr/${code}.png`;
    const email = render("ro", { ...TICKED, organizerQr: { checkinCode: code, qrUrl: qr } });
    const band = email.html.indexOf('data-email-part="highlight"');
    const block = email.html.indexOf('data-email-part="event-facts"');
    const picture = email.html.indexOf(`<img src="${qr}"`);
    expect(band).toBeGreaterThan(email.html.indexOf("Ne vedem sâmbătă la start."));
    expect(block).toBeGreaterThan(band);
    expect(picture).toBeGreaterThan(block);
    const [romanian] = email.text.split("\n— — —\n");
    expect(romanian.indexOf("Program: ")).toBeGreaterThan(romanian.indexOf(`${HIGHLIGHT_TEXT_MARK}La ridicarea numărului de concurs`));
    expect(romanian.indexOf("Program: ")).toBeLessThan(romanian.indexOf(`: ${qr}`));
    // Still one block a half, and the picture once.
    expect(blocks(email.html)).toHaveLength(2);
    expect(email.html.split(`<img src="${qr}"`).length - 1).toBe(1);
  });

  it("reads English first for an English registration", () => {
    const email = render("en", {
      ...TICKED,
      eventTitle: "The autumn cross",
      eventTitleOther: "Crosul de toamnă",
      organizerSubject: WORDS.subject.en,
      organizerSubjectOther: WORDS.subject.ro,
      organizerBody: WORDS.body.en,
      organizerBodyOther: WORDS.body.ro,
      eventFacts: facts("en"),
      eventFactsOther: facts("ro"),
    });
    const found = blocks(email.html);
    expect(found).toHaveLength(2);
    expect(found[0]).toContain(`<strong>Programme</strong><br>${EN_LINES.join("<br>")}`);
    expect(found[1]).toContain(`<strong>Program</strong><br>${RO_LINES.join("<br>")}`);
    expect(email.text.indexOf("Programme: ")).toBeLessThan(email.text.indexOf("Program: "));
  });

  it("an event written in one language has both halves read its rows, each still in its own language's labels", () => {
    // No other-language row was read: the second half reads the first's facts, as every message does (§373).
    const email = render("ro", { ...TICKED, eventFactsOther: undefined });
    const found = blocks(email.html);
    expect(found).toHaveLength(2);
    expect(found[0]).toContain(RO_LINES[0]);
    expect(found[1]).toContain(EN_LINES[0]);
  });
});

describe("§958 nothing else of the organizers' message changes with the tick", () => {
  it("builds the very same message outside the block: the facts line, every link, the buttons, the closing", () => {
    for (const locale of ["ro", "en"] as const) {
      const ticked = buildTemplateContent("ORGANIZER_MESSAGE", locale, TICKED, DATA.eventUrl);
      const plain = buildTemplateContent("ORGANIZER_MESSAGE", locale, DATA, DATA.eventUrl);
      expect(plain.eventFacts, locale).toBeUndefined();
      expect(ticked.eventFacts, locale).toBeDefined();
      expect({ ...ticked, eventFacts: undefined }, locale).toEqual(plain);
      // Named one by one, so a failure says which part moved.
      expect(ticked.facts, locale).toEqual(plain.facts);
      expect(ticked.facts?.line, locale).toContain("Parcul Tractorul");
      expect(ticked.links, locale).toEqual(plain.links);
      expect(ticked.action, locale).toEqual(plain.action);
      expect(ticked.cannotCome, locale).toEqual(plain.cannotCome);
      expect(ticked.paragraphs, locale).toEqual(plain.paragraphs);
      expect(ticked.closing, locale).toBe(plain.closing);
    }
  });

  it("keeps the links list whole — the event's page, its programme and its rules among them — where the full block would drop them", () => {
    const links = buildTemplateContent("ORGANIZER_MESSAGE", "ro", TICKED, DATA.eventUrl).links?.map((link) => link.url) ?? [];
    for (const url of [DATA.eventScheduleUrl, DATA.eventRulesUrl, DATA.myRegistrationsUrl, DATA.eventsUrl, DATA.contactUrl]) expect(links).toContain(url);
    // The confirmation, which draws the whole block, lists none of the page's anchors under its button (§392).
    const confirmation = buildTemplateContent("REGISTRATION_CONFIRMED", "ro", TICKED, DATA.eventUrl).links?.map((link) => link.url) ?? [];
    expect(confirmation).not.toContain(DATA.eventScheduleUrl);
  });

  it("as it leaves: the ticked message with its blocks taken out is the unticked message, byte for byte", () => {
    for (const locale of ["ro", "en"] as const) {
      const ticked = render(locale, TICKED);
      const plain = render(locale, DATA);
      expect(blocks(plain.html), locale).toHaveLength(0);
      expect(plain.text, locale).not.toMatch(/^Program(me)?: /m);
      expect(ticked.subject, locale).toBe(plain.subject);
      expect(htmlWithoutBlocks(ticked.html), locale).toBe(plain.html);
      expect(textWithoutBlocks(ticked.text), locale).toBe(plain.text);
    }
  });

  it("with the flag and no timed row as the message leaves, the message is exactly the one without the tick", () => {
    for (const scheduleItems of [[], null, "program scris liber"]) {
      const empty: TemplateData = { ...TICKED, eventFacts: facts("ro", scheduleItems), eventFactsOther: facts("en", scheduleItems) };
      const plain: TemplateData = { ...DATA, eventFacts: facts("ro", scheduleItems), eventFactsOther: facts("en", scheduleItems) };
      const email = render("ro", empty);
      expect(email.html, JSON.stringify(scheduleItems)).toBe(render("ro", plain).html);
      expect(email.text, JSON.stringify(scheduleItems)).toBe(render("ro", plain).text);
      expect(buildTemplateContent("ORGANIZER_MESSAGE", "ro", empty, DATA.eventUrl).eventFacts).toBeUndefined();
    }
    // …and so is one about no event's facts at all: the flag alone draws nothing.
    const noFacts = render("ro", { ...TICKED, eventFacts: undefined, eventFactsOther: undefined });
    expect(noFacts.html).toBe(render("ro", { ...DATA, eventFacts: undefined, eventFactsOther: undefined }).html);
  });

  it("draws nothing without the flag, whatever facts the message is handed — the samples of «Setări» → «Emailuri» among them", () => {
    expect(blocks(render("ro", DATA).html)).toHaveLength(0);
    for (const value of [false, undefined, "true", 1]) {
      expect(blocks(render("ro", { ...DATA, organizerProgramme: value as unknown as boolean }).html), String(value)).toHaveLength(0);
    }
    for (const locale of ["ro", "en"] as const) {
      for (const data of [emailSampleFor("ORGANIZER_MESSAGE", locale), emailSampleData(locale)]) {
        // The samples carry the sample event's facts, programme and all, and no flag: the preview there shows no block.
        expect(data.organizerProgramme).toBeUndefined();
        expect(data.eventFacts).toBeDefined();
        expect(blocks(render(locale, data).html)).toHaveLength(0);
      }
    }
  });
});

describe("§958 the club's copy, and every other message", () => {
  it("the club's copy carries the block — the copy of one message or the send's one copy: the programme is nobody's", () => {
    for (const copy of [{ clubCopy: true }, { clubCopy: true, clubCopyRecipients: 12, participantName: "" }]) {
      const email = render("ro", { ...TICKED, ...copy });
      expect(email.subject.startsWith("[Copie club] ")).toBe(true);
      const found = blocks(email.html);
      expect(found).toHaveLength(2);
      expect(found[0]).toContain(`<strong>Program</strong><br>${RO_LINES.join("<br>")}`);
      expect(found[1]).toContain(`<strong>Programme</strong><br>${EN_LINES.join("<br>")}`);
      expect(email.text).toContain(`Program: ${RO_LINES[0]}\n  ${RO_LINES[1]}`);
      // …and still nothing that is one participant's own (§320): no button of theirs.
      expect(email.html).not.toContain('data-email-part="cannot-come"');
      // Without the tick the copy has none, as the participants' emails have none.
      expect(blocks(render("ro", { ...DATA, ...copy }).html)).toHaveLength(0);
    }
  });

  it("is drawn by no other message from the flag, whatever it is handed: every type renders the same with it and without", () => {
    for (const messageType of emailMessageType.enumValues) {
      // A relayed message has no template (the relay composes it): nothing of this file's reaches it.
      if (messageType === "ORGANIZER_MESSAGE" || isRelayMessage(messageType)) continue;
      for (const locale of ["ro", "en"] as const) {
        const sample = { ...emailSampleFor(messageType, locale), eventFacts: facts(locale), eventFactsOther: facts(locale === "ro" ? "en" : "ro") };
        const flagged = render(locale, { ...sample, organizerProgramme: true }, messageType);
        const plain = render(locale, sample, messageType);
        expect(flagged.html, `${messageType} (${locale})`).toBe(plain.html);
        expect(flagged.text, `${messageType} (${locale})`).toBe(plain.text);
      }
    }
    // Among them the ones that draw no facts block at all: the forged flag puts no programme into them.
    for (const messageType of ["EVENT_UPDATE_NOTICE", "WAITLIST_SPOT_OFFER", "REGISTRATION_CANCELLED", "EVENT_THANKS", "WAITLIST_JOINED", "BIB_ASSIGNED"] as const) {
      const email = render("ro", { ...emailSampleFor(messageType, "ro"), eventFacts: facts("ro"), eventFactsOther: facts("en"), organizerProgramme: true }, messageType);
      expect(blocks(email.html), messageType).toHaveLength(0);
      expect(email.text, messageType).not.toContain(RO_LINES[0]);
    }
  });
});

describe("§958 the tick's words, in both catalogues", () => {
  const wordsOf = (catalogue: typeof ro) => catalogue.Admin.participantMessages;

  it("names the tick, says what it adds, why it cannot be ticked and where the programme is written, and the question's line", () => {
    expect(wordsOf(ro).includeProgramme).toBe("Include programul evenimentului");
    expect(wordsOf(en).includeProgramme).toBe("Include the event's programme");
    expect(wordsOf(ro).includeProgrammeHelp).toBe("Sub cuvintele tale apare programul evenimentului, oră cu oră, așa cum e pe pagina lui.");
    expect(wordsOf(en).includeProgrammeHelp).toBe("Under your words the email shows the event's programme, hour by hour, as it is on its page.");
    // The editor's card is named by its own title, filled in by the page: never a second name for it.
    expect(wordsOf(ro).includeProgrammeNone).toBe("Evenimentul nu are încă un program cu ore. Îl adaugi în editorul evenimentului, la „{card}”.");
    expect(wordsOf(en).includeProgrammeNone).toBe("The event has no timed programme yet. You add it in the event's editor, under “{card}”.");
    expect(wordsOf(ro).confirmProgramme).toBe("Emailul include programul evenimentului.");
    expect(wordsOf(en).confirmProgramme).toBe("The email includes the event's programme.");
    // One plain sentence of help each (§511), the card's title filled in.
    for (const catalogue of [ro, en]) {
      const card = catalogue.Admin.editor.boxes.programme.title;
      for (const text of [wordsOf(catalogue).includeProgramme, wordsOf(catalogue).includeProgrammeHelp, wordsOf(catalogue).includeProgrammeNone.replace("{card}", card), wordsOf(catalogue).confirmProgramme]) {
        expect(text.length, text).toBeLessThanOrEqual(200);
      }
    }
  });

  it("adds no second word for the block's label: it is the facts block's own, the page's «Program»", () => {
    expect(ro.Event.calendar.programme).toBe("Program");
    expect(en.Event.calendar.programme).toBe("Programme");
  });

  it("is a step of the guide's task, by the tick's own label", () => {
    for (const catalogue of [ro, en]) {
      const steps = catalogue.Admin.guide.sections.flatMap((section) => section.tasks.flatMap((task) => task.steps));
      expect(steps.filter((step) => step.includes(`«${wordsOf(catalogue).includeProgramme}»`))).toHaveLength(1);
    }
  });
});

/**
 * The structural half of «the flag decides a block of an email, and nothing else» (§958), in the style of the two ticks
 * before it: the files that name the flag, its reader, the template's field or the block's builder are a reviewed list —
 * none of the allocator's, the capacity formula's, a state's or a deadline's is on it.
 */
describe("§958 the flag decides a block of an email, and nothing else", () => {
  const ROOT = process.cwd();
  const NAMES_THE_FLAG = /\bincludeProgramme\b|readOrganizerIncludeProgramme|\borganizerProgramme\b|\beventProgrammeBlock\b/;
  const READERS = [
    // The tick on the form, the action that reads it, and the page that hands the composer its words and the question's line.
    "src/app/[locale]/admin/events/[id]/mesaje/actions.ts",
    "src/app/[locale]/admin/events/[id]/mesaje/page.tsx",
    "src/modules/notifications/ui/ParticipantMessageComposer.tsx",
    // The reader, the send that sets the flag on every row, and the renderer that hands it to the template.
    "src/modules/notifications/domain/organizer-message.ts",
    "src/modules/notifications/participant-messages.ts",
    "src/modules/notifications/render.ts",
    // The template that draws the block, and the one builder of its row.
    "src/modules/notifications/templates.ts",
    "src/modules/notifications/domain/event-facts.ts",
  ];

  function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) sourceFiles(full, acc);
      else if (/\.tsx?$/.test(entry)) acc.push(full);
    }
    return acc;
  }

  it("is named by no file but the reviewed ones — never the allocator, the capacity formula, a state or a deadline", () => {
    const naming = sourceFiles(path.join(ROOT, "src"))
      .filter((file) => NAMES_THE_FLAG.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(ROOT, file).replaceAll("\\", "/"))
      .sort();
    expect(naming, "a new reader of the flag must be a reviewed edit of this list").toEqual([...READERS].sort());
    for (const file of naming) {
      expect(file.startsWith("src/modules/registrations/"), file).toBe(false);
      expect(file.startsWith("src/modules/deadlines/"), file).toBe(false);
      expect(file.startsWith("src/db/"), file).toBe(false);
    }
  });

  it("the full facts block is not this message's: the organizers' message is not among the messages that carry it", () => {
    const templates = readFileSync(path.join(ROOT, "src/modules/notifications/templates.ts"), "utf8");
    const list = templates.match(/const EVENT_FACTS_MESSAGES: ReadonlySet<EmailMessageType> = new Set\(\[([^]*?)\]\);/)?.[1];
    expect(list).toBeDefined();
    expect(list).toContain('"REGISTRATION_CONFIRMED"');
    expect(list).not.toContain("ORGANIZER_MESSAGE");
  });
});
