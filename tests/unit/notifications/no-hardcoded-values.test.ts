import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "@/../messages/en.json";
import ro from "@/../messages/ro.json";
import { buildOutgoingEmail, type TemplateData } from "@/modules/notifications/templates";
import type { EmailMessageType } from "@/db/schema/email-outbox";
import { formatSenderIdentity } from "@/infrastructure/email/sender";
import { contactDeliveryFor } from "@/modules/contact/delivery";
import { buildCalendar, type CalendarLabels, calendarFeedFileName } from "@/modules/events/ical";
import { envSchema } from "@/shared/config/env";
import { CLUB_NAME, CLUB_SHORT_NAME } from "@/theme/brand";

/**
 * §357 — the owner, 2026-09-24: "I do not [want] hardcoded stuff in the document and emails
 * anymore!"
 *
 * The emails' own sentences name the club through the platform's one constant (`CLUB_NAME`,
 * §215) and an event only through its data. Two sentences stated a number that is not the
 * platform's but the event's or the send's: "we remind you a week before the start" (the
 * participation window is each event's own, §104) and "is two days away" (a runner confirmed
 * late is reminded a day after confirming, nearer the start, §126). And a cancellation with no
 * title named the club where the event's name belongs.
 */
const DATA: TemplateData = {
  participantName: "Ana Pop",
  eventTitle: "Crosul aniversar",
  eventStartsAtFormatted: "duminică, 11 oct. 2026, 09:00",
};

function render(messageType: EmailMessageType, data: TemplateData) {
  return buildOutgoingEmail({ to: "ana@example.ro", locale: "ro", idempotencyKey: `test:${messageType}`, messageType, data, actionUrl: "https://example.test/ro/x/secret" });
}

describe("§357 no hardcoded value in the emails' own sentences", () => {
  it("writes the club's name nowhere in the templates but through the constant", () => {
    const source = readFileSync(path.join(process.cwd(), "src/modules/notifications/templates.ts"), "utf8");
    expect(source).not.toContain(CLUB_NAME);
    expect(source).not.toMatch(/Bra(?:ș|s|&#536;)ov/);
    // And the constant is what the messages read: the sign-off and the banner's words.
    const email = render("REGISTRATION_CONFIRMED", DATA);
    expect(email.text).toContain(`Echipa ${CLUB_NAME}`);
    expect(email.text).toContain(`The ${CLUB_NAME} team`);
    expect(email.html).toContain(`alt="${CLUB_NAME}"`);
  });

  it("says the confirmation is asked when the event's own window opens, never a fixed week", () => {
    const email = render("COMPLETE_DECLARATION", { ...DATA, confirmLater: true, holdExpiresAtFormatted: "joi, 19 nov. 2026, 09:00" });
    expect(email.text).toContain("sau când îți reamintim, înainte de start.");
    expect(email.text).toContain("or when we remind you before the start.");
    expect(email.text).not.toMatch(/săptămân|a week before/);
  });

  it("says the event is coming up, not how many days away it is", () => {
    const email = render("EVENT_REMINDER", DATA);
    expect(email.text).toContain("Crosul aniversar se apropie.");
    expect(email.text).toContain("Crosul aniversar is coming up.");
    expect(email.text).not.toMatch(/două zile|two days/);
  });

  it("names no event rather than the club when a cancelled event's title is missing", () => {
    const email = render("EVENT_CANCELLED", { participantName: "Ana Pop" });
    expect(email.subject).toBe("Evenimentul a fost anulat / The event has been cancelled");
    expect(email.text).toContain("Ne pare rău: evenimentul a fost anulat.");
    expect(email.text).toContain("We are sorry: the event has been cancelled.");
    expect(email.text).not.toContain(`„${CLUB_NAME}”`);
    expect(email.text).not.toContain(`“${CLUB_NAME}”`);
    // With a title, the sentence is the one it always was.
    expect(render("EVENT_CANCELLED", DATA).subject).toBe("Evenimentul „Crosul aniversar” a fost anulat / “Crosul aniversar” has been cancelled");
  });

  it("names the club in the invitation and the registrations link through the constant", () => {
    expect(render("STAFF_INVITATION", DATA).subject).toBe(`[echipa] Ești în echipa ${CLUB_NAME} / You are on the ${CLUB_NAME} team`);
    expect(render("PROFILE_MANAGE_LINK", DATA).subject).toBe(`Înscrierile tale la ${CLUB_NAME} / Your registrations at ${CLUB_NAME}`);
  });

  it("names the club through the constant in the email Zitadel sends for us and in the bib sheet's metadata", () => {
    // Zitadel's invitation carries `applicationName` into its own email; the bib sheet's PDF
    // carries its Author. Neither is one of our templates, and both still leave with the name.
    // The From line's default, the share picture's lockup (the club's name is its artwork, §609), the calendar's product id and file
    // name, and a legal document PDF's Author are the same kind of thing (§369): each leaves the
    // platform with the name on it.
    for (const file of [
      "src/modules/staff-identity/zitadel-users.ts",
      "src/modules/registrations/bibs-pdf.ts",
      "src/modules/events/share-image.tsx",
      "src/modules/events/ical.ts",
      "src/app/api/admin/legal/[id]/pdf/route.ts",
    ]) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source, file).not.toMatch(/Bra(?:ș|s)ov Runners/);
      expect(source, file).toContain('from "@/theme/brand"');
    }
    // The From line's default reads the same file `brand.ts` does (§882): env.ts may not import the theme.
    const envSource = readFileSync(path.join(process.cwd(), "src/shared/config/env.ts"), "utf8");
    expect(envSource).not.toMatch(/Bra(?:ș|s)ov Runners/);
    expect(envSource).toContain('from "@/club/config"');
    expect(envSource).toContain("default(CLUB.name)");
  });
});

/** Diacritics and case folded, so "Brașov Runners", "BRASOV RUNNERS" and "brasov-runners" are one name. */
const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
/*
  The scans that refused the name in a string of `src/` and in a message of either catalogue moved to
  `tests/unit/club/club-literals.test.ts` (§882), which builds every forbidden word — the name among them —
  from `club/club.json` and scans more than `src/`. The pins below stay: they say where the name is read.
*/

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** Every message of a catalogue by its dotted key; an array's items by their index. */
function flatMessages(messages: unknown, prefix = ""): Record<string, string> {
  if (typeof messages === "string") return { [prefix]: messages };
  if (!messages || typeof messages !== "object") return {};
  return Object.assign(
    {},
    ...Object.entries(messages).map(([key, value]) => flatMessages(value, prefix ? `${prefix}.${key}` : key)),
  );
}

describe("§369 the club's name leaves the platform only through the constant", () => {
  it("fills every {club} with the constant, at each place the sentence is read", () => {
    // Which sentences ask, pinned: a new one is a new call site, and it has to pass the name.
    for (const catalogue of [ro, en]) {
      const asking = Object.entries(flatMessages(catalogue))
        .filter(([, text]) => text.includes("{club}"))
        .map(([key]) => key)
        .sort();
      expect(asking).toEqual(
        [
          // «Pune bifa» on a row of the members' list (§645): the club the list will name.
          "Admin.confirm.memberSetBody",
          "Admin.pages.intro",
          // «Datele înscrierii» (§645): the club box's help, the tick's label and its help.
          "Admin.registrations.answers.clubNameHelp",
          "Admin.registrations.answers.fields.clubMemberDeclared",
          "Admin.registrations.answers.memberHelp",
          // The list's members' tick and its help (§650), and the guide's step that names it.
          "Admin.registrations.clubMemberOnly",
          "Admin.registrations.clubMemberOnlyHelp",
          // The Excel's statistics block (§787): the club's lines and the sentence that says who counts as the club,
          // read through `statisticsWordsFrom`, which hands each the constant (`statistics-footer.test.ts` reads them filled).
          "Admin.registrations.statistics.club",
          "Admin.registrations.statistics.clubConfirmed",
          "Admin.registrations.statistics.clubTicked",
          "Admin.registrations.statistics.legendMember",
          "Admin.registrations.statistics.notClub",
          "Admin.registrations.statistics.note2",
          "Admin.registrations.statistics.note3",
          "Admin.registrations.statistics.note7",
          "Admin.guide.sections.4.tasks.17.steps.2",
          "Admin.tasks.items.contactForm.how.1",
          "Admin.tasks.items.inviteKey.how.0",
          // «Beneficiile membrilor» without the club's words (§524).
          "Members.lead",
          // The network check's report heading (§436).
          "Network.page.report.heading",
          "Registration.clubMemberDeclared",
          "Registration.disclosure.race",
          // The same fold's title for an event without a T-shirt (§554).
          "Registration.disclosure.raceNoShirt",
          // «Vreau să primesc oferte și beneficii de la {club} și partenerii săi.» (§562).
          "Registration.promo.label",
          // The mark beside a shown member's name on «Cine vine» (§831): its accessible name, «Membru {club}», read through `RsvpCount`, which hands it the constant.
          "Event.rsvp.memberLabel",
          "Team.lead",
          // «Întrebări frecvente» (§525): the page's lead and its description.
          "Faq.lead",
          // The home page's numbers band's heading, read by a screen reader (§714).
          "HomeSections.numbers.title",
          // A group run's safety rules (§556): the first line names the club's run, by surface.
          "Event.safetyRules.intro",
          "Event.safetyRules.introMountain",
          // The club's legal identity (§565): «<legal name> (<site name>) · CIF …», filled with the
          // environment's facts and the constant — `club-identity-render.test.ts` reads it filled.
          "Identity.line",
          "Identity.lineNoCif",
          // The members' race number (§664): the designer's switch and label help, the label's default
          // (the sheet's and the picture's, in their language), and the form's wish's help.
          "Admin.editor.bibDesign.member.enabledHelp",
          "Admin.editor.bibDesign.member.labelHelp",
          "Admin.bibs.memberLabelDefault",
          "Registration.memberBibWantedHelp",
          // The home page's title in a search result (§714): the club's name first.
          "Home.meta.title",
          // The header's «Urmărește-ne» marks, each named by the club and the network (§722).
          "Site.followOn.facebook",
          "Site.followOn.instagram",
          "Site.followOn.strava",
          "Site.followOn.youtube",
          // The calendar's subscribe box under «Tema v2» (the facelift's phase 4): «Adaugă calendarul {club} …».
          "Events.calendar.look.subscribe.intro",
          // «Clubul pe lista publică» (§753): the editor's help and the first mode, «Doar {club}».
          "Admin.editor.publicListClubHelp",
          "Admin.editor.publicListClubMembersOnly",
          // The volunteers' club-group tick (§765): the public form's, the entry's and the row's chip — the person's own claim, like the member tick.
          "Event.volunteers.profile.club",
          "Admin.volunteers.person.club",
          "Admin.volunteers.chips.club",
        ].sort(),
      );
    }
    // Each call names the key as its namespace sees it and hands it the constant; a call without
    // the argument would print "{club}" on QA and production, where a missing value is quiet.
    const calls: Record<string, number> = {
      clubMemberDeclared: 2,
      "disclosure.race": 1,
      "disclosure.raceNoShirt": 1,
      "registrations.clubMemberOnly": 1,
      "registrations.clubMemberOnlyHelp": 1,
      "pages.intro": 1,
      "page.report.heading": 1,
      // «Echipa» (§459), «Întrebări frecvente» (§525) and «Beneficiile membrilor» (§524): each page and its description for search engines.
      lead: 6,
      "safetyRules.intro": 1,
      "safetyRules.introMountain": 1,
      // The register form's box (§562); the declaration page reads it as `formCopy`, the notice through `promo-consent-words.ts`.
      "promo.label": 1,
      // The members' race number (§664): the form's wish and the designer's switch.
      memberBibWantedHelp: 1,
      "editor.bibDesign.member.enabledHelp": 1,
      // The home page's title (§714), in the root's metadata.
      "meta.title": 1,
      // The home page's numbers band (§714).
      "numbers.title": 1,
      // «Clubul pe lista publică» (§753): the editor's help and the first mode.
      "editor.publicListClubHelp": 1,
      "editor.publicListClubMembersOnly": 1,
      // The volunteers' club-group tick (§765): the form's, the entry's, and the row's chip (the card's and the person's page).
      "volunteers.profile.club": 1,
      "volunteers.person.club": 1,
      "volunteers.chips.club": 2,
    };
    const sources = sourceFiles(path.join(process.cwd(), "src")).map((file) => readFileSync(file, "utf8"));
    for (const [key, expected] of Object.entries(calls)) {
      const pattern = new RegExp(`\\b(?:t|rt)\\(\\s*"${key.replace(".", "\\.")}"\\s*([,)])[^)]*`, "g");
      const found = sources.flatMap((text) => [...text.matchAll(pattern)].map((match) => match[0]));
      expect(found, key).toHaveLength(expected);
      for (const call of found) expect(call, key).toMatch(/,\s*\{\s*club:\s*CLUB_NAME\s*\}$/);
    }
    // The header's marks (§722) are read through one template key, which the scan above cannot count: the call hands each the constant.
    const headerSocials = readFileSync(path.join(process.cwd(), "src/shared/ui/HeaderSocials.tsx"), "utf8");
    expect(headerSocials).toMatch(/site\(`followOn\.\$\{network\}`, \{ club: CLUB_NAME \}\)/);
    // The task steps are read raw and filled by the page from its own values.
    const tasks = readFileSync(path.join(process.cwd(), "src/app/[locale]/admin/tasks/page.tsx"), "utf8");
    expect(tasks).toMatch(/club:\s*CLUB_NAME,/);
    // So are the guide's (§650: the members' filter is named by its tick, which names the club).
    const guide = readFileSync(path.join(process.cwd(), "src/app/[locale]/admin/guide/page.tsx"), "utf8");
    expect(guide).toMatch(/club:\s*CLUB_NAME[,\s}]/);
    // And a filled sentence reads the name in both languages.
    for (const [locale, messages] of [
      ["ro", ro],
      ["en", en],
    ] as const) {
      const t = createTranslator({ locale, messages, namespace: "Registration" });
      expect(t("disclosure.race", { club: CLUB_NAME })).toContain(CLUB_NAME);
      expect(t("disclosure.raceNoShirt", { club: CLUB_NAME })).toContain(CLUB_NAME);
    }
  });

  it("sends from the constant by default, and the setting still wins", () => {
    const defaults = envSchema.parse({});
    expect(defaults.EMAIL_FROM_NAME).toBe(CLUB_NAME);
    expect(formatSenderIdentity({ EMAIL_FROM_NAME: defaults.EMAIL_FROM_NAME, MAILGUN_DOMAIN: "mail.example.test" })).toBe(
      `"${CLUB_NAME}" <noreply@mail.example.test>`,
    );
    expect(envSchema.parse({ EMAIL_FROM_NAME: "Alt nume" }).EMAIL_FROM_NAME).toBe("Alt nume");
    // The contact form's sender reads the same setting.
    expect(contactDeliveryFor(envSchema.parse({ CONTACT_FORM_MODE: "capture" }), null)?.from.name).toBe(CLUB_NAME);
  });

  it("writes the calendar's product id and the feed's file name from the constant, byte for byte as before", () => {
    // No entry, so no label is read; the head of the file is what is asserted.
    const labels = { locale: "ro", t: (key: string) => key } as unknown as CalendarLabels;
    const calendar = buildCalendar({ events: [], baseUrl: "https://example.test", name: "Calendar", labels });
    // The same ASCII product id calendar apps have read from the start.
    expect(calendar).toContain("PRODID:-//Brasov Runners//events//RO\r\n");
    expect(calendar).toContain(`PRODID:-//${fold(CLUB_NAME).replace(/\b\w/g, (letter) => letter.toUpperCase())}//events//RO`);
    expect(calendarFeedFileName("ro")).toBe("brasov-runners-ro.ics");
    expect(calendarFeedFileName("en")).toBe(`${fold(CLUB_NAME).replace(/\s+/g, "-")}-en.ics`);
  });
});

/**
 * §887 — the club's other words arrive as arguments too, so a fork with an empty overlay (`club/messages`) is already
 * right: its short mark (`{short}`, `brand.ts#CLUB_SHORT_NAME`), its identity card example (`{idExample}`,
 * `place.ts#ID_DOCUMENT_EXAMPLE`), its safety form's name (`{safetyName}`, `brand.ts#SAFETY_PROGRAMME`, in the reader's
 * language), its slug (`{slug}`), its media bucket (`{bucket}`, `R2_BUCKET`) and its zone (`{timeZone}`, `{zoneWords}`,
 * `dates.ts`). next-intl 4 has no default values, and a missing one is quiet on QA and production (§353): each call site
 * is pinned here and hands the value from its one constant.
 */
describe("§887 the club's short mark, card example, safety form, slug, bucket and zone arrive as arguments", () => {
  // Line endings normalised: the pins below span lines with `\n`, and a Windows checkout writes `\r\n`.
  const sources = new Map(
    sourceFiles(path.join(process.cwd(), "src")).map((file) => [path.relative(process.cwd(), file).split(path.sep).join("/"), readFileSync(file, "utf8").replace(/\r\n/g, "\n")]),
  );
  const read = (file: string) => {
    const text = sources.get(file);
    expect(text, file).toBeDefined();
    return text ?? "";
  };

  it("pins which sentences ask for each", () => {
    const asking = (argument: string) =>
      Object.entries(flatMessages(ro))
        .filter(([, text]) => text.includes(`{${argument}}`))
        .map(([key]) => key)
        .sort();
    expect(asking("short")).toEqual(
      [
        // the short mark: the calendar's name in a phone's list, the member chip, the editor's tick, the legend, the task row
        "Events.calendar.androidSync",
        "Event.calendar.feedName",
        "Event.rsvp.memberMark",
        "Admin.editor.membersOnly",
        "Admin.legal.tokens.rsvpMember",
        "Admin.tasks.items.rsvpMemberNotice.done",
        "Admin.tasks.items.rsvpMemberNotice.how.0",
        // a different value under the same name: an email's short name on a registration's row (§626)
        "Admin.registrations.rejected.line.missing",
      ].sort(),
    );
    expect(asking("idExample")).toEqual(
      [
        "Event.groupRunDeclaration.page.idDocumentHelp",
        "Registrations.declare.documentRefusedNothingRecorded",
        "Registrations.declare.idDocumentHelp",
        "Registrations.declare.idDocumentPlaceholder",
        "Registrations.declare.minorIdDocumentHelp",
      ].sort(),
    );
    expect(asking("safetyName")).toEqual(
      [
        "Admin.emails.feedbackForms.branches.safety",
        "Admin.emails.feedbackForms.via.fallbackHelp",
        "Admin.emails.feedbackForms.via.fallbackNotice",
        "Admin.emails.feedbackForms.via.gmailNotice",
        "Admin.emails.feedbackForms.via.safetyNote",
        "Admin.legal.tokens.feedbackSafetyGmail",
        "Admin.tasks.items.feedbackSafetyGmailNotice.done",
        "Admin.tasks.items.feedbackSafetyGmailNotice.how.0",
        "Admin.tasks.items.feedbackSafetyGmailNotice.how.1",
        "Admin.tasks.items.feedbackSafetyGmailNotice.title",
        "Admin.tasks.items.feedbackSafetyGmailNotice.todo",
        "Tell.branches.safety.label",
        // the relayed message's footer, which moved out of `feedback/domain/branches.ts`
        "Tell.relay.footer.safety",
      ].sort(),
    );
    expect(asking("slug")).toEqual(
      [
        "Admin.tasks.items.botCheck.how.1",
        "Admin.tasks.items.botCheck.howMisconfigured.0",
        "Admin.tasks.items.botCheck.todo",
        "Admin.tasks.items.inviteKey.how.0",
        "Admin.tasks.items.inviteKey.how.1",
        "Admin.tasks.items.inviteKey.howBroken.0",
        "Admin.tasks.items.mediaStorage.how.4",
        "Admin.tasks.items.vercelUsage.how.0",
        // a different value under the same name: an imported event's page address (§539)
        "Admin.eventJson.notes.slugSuffixed",
      ].sort(),
    );
    expect(asking("bucket")).toEqual(["Admin.tasks.items.mediaStorage.how.2", "Admin.tasks.items.mediaStorage.how.6"]);
    expect(asking("timeZone")).toEqual(["Admin.tasks.items.scheduler.how.0"]);
    expect(asking("zoneWords")).toEqual(["Admin.editor.boxes.summary.timezone.home", "Admin.tasks.emailStalled.deferred"]);
  });

  it("hands each call the value from its constant", () => {
    // Each call names the key as its namespace sees it; every one carries the argument from the constant.
    const calls: Array<[key: string, count: number, value: RegExp]> = [
      ["calendar.androidSync", 2, /short: CLUB_SHORT_NAME/],
      ["calendar.feedName", 1, /short: CLUB_SHORT_NAME/],
      ["rsvp.memberMark", 4, /short: CLUB_SHORT_NAME/],
      ["editor.membersOnly", 1, /short: CLUB_SHORT_NAME/],
      ["declare.documentRefusedNothingRecorded", 1, /idExample: ID_DOCUMENT_EXAMPLE/],
      ["declare.idDocumentHelp", 2, /idExample: ID_DOCUMENT_EXAMPLE/],
      ["declare.idDocumentPlaceholder", 4, /idExample: ID_DOCUMENT_EXAMPLE/],
      ["declare.minorIdDocumentHelp", 1, /idExample: ID_DOCUMENT_EXAMPLE/],
      ["groupRunDeclaration.page.idDocumentHelp", 1, /idExample: ID_DOCUMENT_EXAMPLE/],
      ["emails.feedbackForms.via.safetyNote", 1, /, safety\)$/],
      ["emails.feedbackForms.via.fallbackHelp", 1, /, safety\)$/],
      ["emails.feedbackForms.via.fallbackNotice", 1, /, safety\)$/],
    ];
    for (const [key, expected, value] of calls) {
      const pattern = new RegExp(`\\b(?:t|tEvent|tDeclare)\\(\\s*"${key.replace(/\./g, "\\.")}"\\s*([,)])[^)]*\\)?`, "g");
      const found = [...sources.values()].flatMap((text) => [...text.matchAll(pattern)].map((match) => match[0]));
      expect(found, key).toHaveLength(expected);
      for (const call of found) expect(call, key).toMatch(value);
    }
    // The keys read through a template or a lambda, which the scan above cannot count: each hands the value too.
    const pins: Array<[file: string, pattern: RegExp]> = [
      ["src/modules/feedback/ui/FeedbackFormsPanel.tsx", /const safety = \{ safetyName: SAFETY_PROGRAMME\[locale\] \};/],
      ["src/modules/feedback/ui/FeedbackFormsPanel.tsx", /roadWords\(\(key\) => t\(key as never, safety as never\)\)/],
      ["src/modules/feedback/ui/FeedbackFormsPanel.tsx", /t\(`emails\.feedbackForms\.branches\.\$\{branch\}`, safety\)/],
      ["src/modules/contact/ui/ContactRecipientsPanel.tsx", /roadWords\(\(key\) => t\(key as never, \{ safetyName: SAFETY_PROGRAMME\[/],
      ["src/modules/feedback/ui/BranchChoice.tsx", /t\(`branches\.\$\{branch\}\.label`, \{ safetyName: SAFETY_PROGRAMME\[/],
      ["src/app/[locale]/contact/feedback/page.tsx", /t\(`branches\.\$\{branch\}\.label`, \{ safetyName: SAFETY_PROGRAMME\[locale\] \}\)/],
      ["src/modules/legal-documents/ui/TokenLegend.tsx", /t\(`tokens\.\$\{entry\.messageKey\}`, \{ short: CLUB_SHORT_NAME, safetyName: SAFETY_PROGRAMME\[first\] \}\)/],
      ["src/modules/feedback/domain/branches.ts", /relayWords\("relay\.footer\.safety", \{ safetyName: SAFETY_PROGRAMME\.ro \}\)/],
      ["src/modules/rsvp/notice-words.ts", /\("rsvp\.memberMark", \{ short: CLUB_SHORT_NAME \}\)/],
      ["src/modules/content/events/ui/box-summaries.ts", /fillIn\(words\.timezone\.home, \{ zone, zoneWords: ZONE_WORDS\[/],
      // «Sarcini» fills its rows' titles, sentences and steps from one set of values (`howValues`).
      ["src/app/[locale]/admin/tasks/page.tsx", /short: CLUB_SHORT_NAME,\n\s*slug: CLUB_SLUG,\n\s*timeZone: CLUB_TIME_ZONE,\n\s*safetyName: SAFETY_PROGRAMME\[/],
      ["src/app/[locale]/admin/tasks/page.tsx", /bucket: env\.R2_BUCKET \?\? `\$\{CLUB_SLUG\}-media`,/],
      ["src/app/[locale]/admin/tasks/page.tsx", /t\(`items\.\$\{task\.id\}\.title`, howValues\)/],
      // The stalled email's alert says when the outbox resumes in the club's own zone words, not the overlay's.
      ["src/app/[locale]/admin/tasks/page.tsx", /t\("emailStalled\.deferred", \{[\s\S]{0,400}?zoneWords: ZONE_WORDS\[locale === "en" \? "en" : "ro"\],\n\s*\}\)/],
    ];
    for (const [file, pattern] of pins) expect(read(file), `${file}: ${pattern}`).toMatch(pattern);
  });

  it("fills every one with this club's words, so Brașov reads what it read", () => {
    for (const [locale, messages] of [
      ["ro", ro],
      ["en", en],
    ] as const) {
      const t = createTranslator({ locale, messages, namespace: "Event" });
      expect(t("rsvp.memberMark", { short: CLUB_SHORT_NAME })).toBe(CLUB_SHORT_NAME);
      expect(t("calendar.feedName", { short: CLUB_SHORT_NAME })).toContain(CLUB_SHORT_NAME);
    }
  });
});
