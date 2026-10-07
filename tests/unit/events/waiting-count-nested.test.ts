import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { EditableEvent } from "@/modules/content/events/repository";
import { publicFill, publicNumbersShown, registrationCta, type RegistrationCtaInput, waitlistCountShown } from "@/modules/events/domain/registration-cta";

/**
 * BR-REQ-039-01 (§669) — «Arată public câți așteaptă» nested under «Arată public numărătoarea». The owner,
 * looking at the event editor on production: "These 2 checkboxes need to be nested, they refer to the same
 * thing pretty much". The parent unticked already hides every number on the event's public pages, so the
 * waiting count is one of them: one pure rule (`waitlistCountShown`) beside `publicNumbersShown`, and the
 * editor draws the child under the parent, indented, shown only while the parent is ticked and still posted
 * while hidden. `waitlist-joined-position.test.ts` and `waitlist-position.test.ts` prove the person's own
 * sentence from a database; `what-to-tell-words.test.ts` the admin's «Ce îi spui».
 */
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages: ro, namespace: namespace as "Admin" }),
    getLocale: async () => "ro",
  };
});

const { default: StartListBox } = await import("@/modules/content/events/ui/boxes/StartListBox");

const DURING = new Date("2026-09-15T12:00:00Z");

function event(overrides: Partial<RegistrationCtaInput> = {}): RegistrationCtaInput {
  return {
    registrationMode: "INTERNAL",
    eventStatus: "SCHEDULED",
    startsAt: new Date("2026-10-04T07:00:00Z"),
    registrationOpensAt: null,
    registrationOpensSoon: false,
    registrationClosesAt: null,
    publishedAt: new Date("2026-09-01T10:00:00Z"),
    externalRegistrationUrl: null,
    externalProvider: null,
    availablePlaces: null,
    ...overrides,
  };
}

const RACE = {
  id: "11111111-1111-1111-1111-111111111111",
  type: "RACE",
  eventStatus: "SCHEDULED",
  registrationMode: "INTERNAL",
  participantListVisibility: "HIDDEN",
  waitlistPublic: false,
  waitlistCountPublic: true,
  participantCountPublic: true,
  hiddenListEnabled: false,
} as unknown as EditableEvent;

async function render(value: EditableEvent | null) {
  const element = await StartListBox({ event: value, mayEditSettings: true });
  const { NextIntlClientProvider } = await import("next-intl");
  const stream = await renderToReadableStream(
    createElement(NextIntlClientProvider, { locale: "ro", messages: ro } as unknown as ComponentProps<typeof NextIntlClientProvider>, element as ReactElement),
  );
  await stream.allReady;
  return new Response(stream).text();
}

/** The `ShownWhen` block around the child, from its opening tag to the child's own. */
const childBlock = (html: string) => {
  const at = html.indexOf('data-testid="waitlist-count-public"');
  return html.slice(html.lastIndexOf("<div", html.lastIndexOf("<div", at) - 1), at);
};

describe("§669 waitlistCountShown: the waiting count is one of the public numbers", () => {
  it("is on only with both switches on, absent reading as on", () => {
    expect(waitlistCountShown({ participantCountPublic: true, waitlistCountPublic: true })).toBe(true);
    expect(waitlistCountShown({})).toBe(true);
    expect(waitlistCountShown(null)).toBe(true);
    expect(waitlistCountShown({ participantCountPublic: null, waitlistCountPublic: null })).toBe(true);
    expect(waitlistCountShown({ participantCountPublic: true, waitlistCountPublic: false })).toBe(false);
    expect(waitlistCountShown({ participantCountPublic: false, waitlistCountPublic: true })).toBe(false);
    expect(waitlistCountShown({ participantCountPublic: false, waitlistCountPublic: false })).toBe(false);
  });

  it("never says the count where the parent says no number", () => {
    for (const participantCountPublic of [true, false, null, undefined]) {
      for (const waitlistCountPublic of [true, false, null, undefined]) {
        const switches = { participantCountPublic, waitlistCountPublic };
        if (!publicNumbersShown(switches)) expect(waitlistCountShown(switches)).toBe(false);
      }
    }
  });

  it("the door and the places line follow it: the parent off hides the line's length with the child left on", () => {
    const full = event({ availablePlaces: 0, waitlistRoom: 4, waiting: 3, waitlisted: 3 });
    expect(registrationCta({ ...full, participantCountPublic: false, waitlistCountPublic: true }, DURING)).toEqual({ kind: "FULL", waitlistRoom: null, waiting: null });
    expect(registrationCta({ ...full, participantCountPublic: true, waitlistCountPublic: true }, DURING)).toEqual({ kind: "FULL", waitlistRoom: 4, waiting: 3 });
    expect(publicFill(10, 0, { occupied: 10, confirmed: 8, waitlisted: 3, participantCountPublic: false, waitlistCountPublic: true })).toBeNull();
    expect(publicFill(10, 0, { occupied: 10, confirmed: 8, waitlisted: 3, participantCountPublic: true, waitlistCountPublic: false })).not.toHaveProperty("waitlisted");
  });
});

describe("§669 the editor: «Arată public câți așteaptă» under «Arată public numărătoarea»", () => {
  it("draws the parent first and the child after it, inside the parent's own block", async () => {
    const html = await render(RACE);
    const parentAt = html.indexOf('data-testid="participant-count-public"');
    const childAt = html.indexOf('data-testid="waitlist-count-public"');
    expect(parentAt).toBeGreaterThan(-1);
    expect(childAt).toBeGreaterThan(parentAt);
    // The parent's help comes before the child: the child is the parent's last part, not a sibling ahead of it.
    expect(html.indexOf(ro.Admin.editor.participantCountPublicHelp)).toBeLessThan(childAt);
    expect(html.indexOf(ro.Admin.editor.waitlistCountPublicHelp)).toBeGreaterThan(childAt);
    expect(childAt).toBeLessThan(html.indexOf('data-testid="hidden-list-settings"'));
    // Shown while the parent is ticked.
    expect(childBlock(html)).not.toContain("data-hidden-block");
  });

  it("hides the child while the parent is unticked, but keeps it in the form with its value and marker", async () => {
    const html = await render({ ...RACE, participantCountPublic: false, waitlistCountPublic: true } as unknown as EditableEvent);
    expect(html).not.toMatch(/<input[^>]*name="event.participantCountPublic"[^>]*checked/);
    expect(childBlock(html)).toContain("data-hidden-block");
    expect(html).toMatch(/<input[^>]*name="event.waitlistCountPublic"[^>]*checked/);
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="event.waitlistCountPublic.present"[^>]*value="1"/);
  });

  it("a new event starts with both ticked and the child shown", async () => {
    const html = await render(null);
    expect(html).toMatch(/<input[^>]*name="event.participantCountPublic"[^>]*checked/);
    expect(html).toMatch(/<input[^>]*name="event.waitlistCountPublic"[^>]*checked/);
    expect(childBlock(html)).not.toContain("data-hidden-block");
  });

  it("says the nesting in the helps and the «Ghid», both languages, each under 200 characters", () => {
    for (const messages of [ro, en]) {
      expect(messages.Admin.editor.participantCountPublicHelp.length).toBeLessThan(200);
      expect(messages.Admin.editor.waitlistCountPublicHelp.length).toBeLessThan(200);
    }
    expect(ro.Admin.editor.participantCountPublicHelp).toContain("nici câți așteaptă");
    expect(en.Admin.editor.participantCountPublicHelp).toContain("not even how many wait");
    const ghid = (messages: unknown) =>
      JSON.stringify(messages)
        .split('"')
        .filter((text) => text.includes("cu «Arată public câți așteaptă» sub el") || text.includes("with «Show publicly how many are waiting» under it"));
    expect(ghid(ro)).toHaveLength(1);
    expect(ghid(en)).toHaveLength(1);
    for (const step of [...ghid(ro), ...ghid(en)]) expect(step.length).toBeLessThan(200);
  });
});
