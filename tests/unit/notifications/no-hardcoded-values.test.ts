import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { buildOutgoingEmail, type TemplateData } from "@/modules/notifications/templates";
import type { EmailMessageType } from "@/db/schema/email-outbox";
import { formatSenderIdentity } from "@/infrastructure/email/sender";
import { contactDeliveryFor } from "@/modules/contact/delivery";
import { buildCalendar, type CalendarLabels, calendarFeedFileName } from "@/modules/events/ical";
import { envSchema } from "@/shared/config/env";
import { CLUB_NAME } from "@/theme/brand";

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
    expect(render("STAFF_INVITATION", DATA).subject).toBe(`Ești în echipa ${CLUB_NAME} / You are on the ${CLUB_NAME} team`);
    expect(render("PROFILE_MANAGE_LINK", DATA).subject).toBe(`Înscrierile tale la ${CLUB_NAME} / Your registrations at ${CLUB_NAME}`);
  });

  it("names the club through the constant in the email Zitadel sends for us and in the bib sheet's metadata", () => {
    // Zitadel's invitation carries `applicationName` into its own email; the bib sheet's PDF
    // carries its Author. Neither is one of our templates, and both still leave with the name.
    // The From line's default, the share picture's heading, the calendar's product id and file
    // name, and a legal document PDF's Author are the same kind of thing (§NNN): each leaves the
    // platform with the name on it.
    for (const file of [
      "src/modules/staff-identity/zitadel-users.ts",
      "src/modules/registrations/bibs-pdf.ts",
      "src/shared/config/env.ts",
      "src/modules/events/share-image.tsx",
      "src/modules/events/ical.ts",
      "src/app/api/admin/legal/[id]/pdf/route.ts",
    ]) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source, file).not.toMatch(/Bra(?:ș|s)ov Runners/);
      expect(source, file).toContain('from "@/theme/brand"');
    }
  });
});

/** Diacritics and case folded, so "Brașov Runners", "BRASOV RUNNERS" and "brasov-runners" are one name. */
const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const CLUB_NAME_PATTERN = new RegExp(fold(CLUB_NAME).replace(/\s+/g, "[\\s-]"));

/**
 * Every string a program can hand a person or another system — a string literal, each piece of a
 * template literal, and the text between JSX tags — that names the club. Comments are not nodes of
 * the tree, so the owner's own words quoted in a comment are not counted.
 */
function clubNamesIn(file: string, text: string): string[] {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    const words =
      ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)
        ? node.text
        : null;
    if (words !== null && CLUB_NAME_PATTERN.test(fold(words))) found.push(words.trim());
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/**
 * Where the name may be written: the constant itself, and the sample data a developer seeds — a
 * made-up event may be called anything, and a test fixture reads it by that title.
 */
const MAY_NAME_THE_CLUB = (relative: string) => relative === "src/theme/brand.ts" || relative.startsWith("src/db/seeds/");

describe("§NNN the club's name leaves the platform only through the constant", () => {
  it("finds the name in a string, a template and JSX text, and not in a comment", () => {
    const found = clubNamesIn(
      "probe.tsx",
      [
        "// Brașov Runners, in a comment",
        'const a = "Echipa Brașov Runners";',
        "const b = `-//Brasov Runners//${x}`;",
        "const c = `x ${y} brasov-runners-${z}.ics`;",
        "const d = <div>BRASOV RUNNERS</div>;",
        'const e = "@brasovrunners";',
      ].join("\n"),
    );
    expect(found).toEqual(["Echipa Brașov Runners", "-//Brasov Runners//", "brasov-runners-", "BRASOV RUNNERS"]);
  });

  it("no string in src/ names the club outside theme/brand.ts and the seeds", () => {
    const root = process.cwd();
    const offenders = sourceFiles(path.join(root, "src"))
      .map((file) => ({ file: path.relative(root, file).split(path.sep).join("/"), text: readFileSync(file, "utf8") }))
      .filter(({ file }) => !MAY_NAME_THE_CLUB(file))
      .flatMap(({ file, text }) => clubNamesIn(file, text).map((words) => `${file}: ${words}`));
    expect(offenders).toEqual([]);
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
