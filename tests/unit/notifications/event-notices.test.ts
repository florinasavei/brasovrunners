import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NEVER_QUEUED_MESSAGE_TYPES } from "@/modules/notifications/domain/never-queued";
import { buildOutgoingEmail, type TemplateData } from "@/modules/notifications/templates";

/**
 * `DECISIONS.md` §331 — "Detalii actualizate" and "Eveniment anulat", as they are built: one line
 * per fact the save changed, read from the event as it stands; the organizer's own words as plain
 * text; nothing to act on. And the three message types nothing queues, held to that by the source.
 */
const DATA: TemplateData = {
  participantName: "Ana Pop",
  eventTitle: "Crosul de toamnă",
  eventLocationName: "Poiana Brașov, la telecabină",
  eventStartsAtFormatted: "duminică, 11 octombrie 2026, 09:00",
  eventStartsAtFormattedOther: "Sunday 11 October 2026, 09:00",
  eventUrl: "https://example.test/ro/evenimente/crosul-de-toamna",
  contactUrl: "https://example.test/ro/contact",
  eventsUrl: "https://example.test/ro/evenimente",
};

const build = (messageType: "EVENT_UPDATE_NOTICE" | "EVENT_CANCELLED", data: Partial<TemplateData>, actionUrl?: string) =>
  buildOutgoingEmail({ to: "ana@example.ro", locale: "ro", idempotencyKey: `test:${messageType}`, messageType, data: { ...DATA, ...data }, actionUrl });

describe("§331 the update notice", () => {
  it("names each fact the save changed, in both languages, and only those", () => {
    const email = build("EVENT_UPDATE_NOTICE", { updateChanges: ["place", "time"] }, DATA.eventUrl);
    expect(email.subject).toBe("Detalii actualizate pentru Crosul de toamnă / Updated details for Crosul de toamnă");
    expect(email.text).toContain("Locul de întâlnire este acum: Poiana Brașov, la telecabină.");
    expect(email.text).toContain("Data și ora sunt acum: duminică, 11 octombrie 2026, 09:00.");
    expect(email.text).toContain("The meeting point is now: Poiana Brașov, la telecabină.");
    expect(email.text).toContain("The date and time are now: Sunday 11 October 2026, 09:00.");
    expect(email.text).not.toContain("Programul actualizat");
    expect(email.text).toContain(`Vezi pagina evenimentului: ${DATA.eventUrl}`);
  });

  it("a race's gun time rides with the start, and the programme's rows with the programme", () => {
    const email = build("EVENT_UPDATE_NOTICE", {
      updateChanges: ["time", "programme"],
      eventRaceStartsAtFormatted: "10:00",
      eventProgramme: ["09:00 Ridicarea kiturilor (Cort)"],
    });
    expect(email.text).toContain("Data și ora sunt acum: duminică, 11 octombrie 2026, 09:00; startul cursei la 10:00.");
    expect(email.text).toContain("Programul actualizat: 09:00 Ridicarea kiturilor (Cort).");
  });

  it("prints the organizer's note as plain text: escaped, its lines kept, no emphasis read into it", () => {
    const email = build("EVENT_UPDATE_NOTICE", { updateChanges: [], organizerNote: "Adu <frontala> & **apă**.\nParcarea e închisă." });
    expect(email.text).toContain("Mesajul organizatorilor:\nAdu <frontala> & **apă**.\nParcarea e închisă.");
    expect(email.html).toContain("Adu &lt;frontala&gt; &amp; **apă**.<br>Parcarea e închisă.");
    expect(email.html).not.toContain("<strong>apă</strong>");
  });

  it("the club's copy carries no button (§320)", () => {
    const email = build("EVENT_UPDATE_NOTICE", { updateChanges: ["place"], clubCopy: true }, DATA.eventUrl);
    expect(email.subject.startsWith("[Copie club] ")).toBe(true);
    expect(email.text).not.toContain("Vezi pagina evenimentului:");
    expect(email.text).toContain("Locul de întâlnire este acum: Poiana Brașov, la telecabină.");
  });
});

describe("§331 the cancellation", () => {
  it("says the event is cancelled, why, that the registration stays and nothing is owed, and where to ask", () => {
    const email = build("EVENT_CANCELLED", { cancellationReason: "Avertizare meteo: traseul nu e sigur.", replyTo: "contact@example.test" }, "https://example.test/ignored");
    expect(email.subject).toBe("Evenimentul „Crosul de toamnă” a fost anulat / “Crosul de toamnă” has been cancelled");
    expect(email.text).toContain("Motivul:\nAvertizare meteo: traseul nu e sigur.");
    expect(email.text).toContain("The reason:\nAvertizare meteo: traseul nu e sigur.");
    expect(email.text).toContain("Înscrierea ta rămâne la noi ca înregistrare și nu trebuie să faci nimic");
    expect(email.text).toContain("sau răspunde la acest email");
    expect(email.text).toContain("Scrie-ne: https://example.test/ro/contact");
    // No action of its own, whatever the caller handed over.
    expect(email.text).not.toContain("https://example.test/ignored");
  });
});

/** Every `.ts`/`.tsx` under `src/`, as text. */
function sources(dir: string): { path: string; text: string }[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "migrations" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) ? [{ path, text: readFileSync(path, "utf8") }] : [];
  });
}

describe("§331 the message types nothing queues", () => {
  it("are queued nowhere in the source — no `messageType:` names them", () => {
    const offenders = sources(join(process.cwd(), "src")).flatMap(({ path, text }) =>
      [...NEVER_QUEUED_MESSAGE_TYPES].filter((type) => new RegExp(`messageType:\\s*"${type}"`).test(text)).map((type) => `${path}: ${type}`),
    );
    expect(offenders).toEqual([]);
  });
});
