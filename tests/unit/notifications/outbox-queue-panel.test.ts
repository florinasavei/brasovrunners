import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §NNN — the owner, 2026-09-28: "vreau să pot vedea exact când pleacă emailurile și să pot face
 * on/off la acea setare". The queue panel on «Setări» → «Emailuri» opens with when the queue leaves
 * — the switch's state, the outbox job's next and last real run, what holds the scheduled round
 * back — and every row says its own departure, late in red past the health check's threshold. The
 * switch is the Administrator's; everybody who reads the queue reads the timing. Both languages.
 */
const state = vi.hoisted(() => ({ locale: "ro" as "ro" | "en" }));

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const catalogues = { ro: (await import("../../../messages/ro.json")).default, en: (await import("../../../messages/en.json")).default };
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: state.locale, messages: catalogues[state.locale], namespace: namespace as "Admin" }),
    getLocale: async () => state.locale,
  };
});
vi.mock("@/app/[locale]/admin/settings/emails/actions", () => ({
  sendOutboxNowFromEmailsAction: async () => null,
  updateDeliveryTimingFromEmailsAction: async () => null,
}));

const { default: OutboxQueuePanel } = await import("@/modules/notifications/ui/OutboxQueuePanel");
type Props = Parameters<typeof OutboxQueuePanel>[0];

// 10:04 in Brașov (UTC+3 in October): a day hour.
const NOW = new Date("2026-10-01T07:04:00.000Z");

const DELIVERY: Props["delivery"] = {
  timing: "scheduled",
  pending: 2,
  waitMinutes: 120,
  scheduledWait: { day: 120, night: 120 },
  nextTickAt: "2026-10-01T09:00:00.000Z",
  lastRunAt: "2026-10-01T07:00:40.000Z",
  holds: { pingerMinutes: 60, intervalMinutes: 120, governorFloorMinutes: 0 },
};

const QUEUE: Props["queue"] = {
  total: 3,
  rows: [
    {
      id: "a",
      messageType: "VERIFY_REGISTRATION_EMAIL",
      recipientEmail: "ana@example.org",
      status: "PENDING",
      attemptCount: 0,
      nextAttemptAt: null,
      lastError: null,
      createdAt: new Date("2026-10-01T07:02:00.000Z"),
      isManualResend: false,
    },
    {
      id: "b",
      messageType: "COMPLETE_DECLARATION",
      recipientEmail: "ion@example.org",
      status: "PENDING",
      attemptCount: 1,
      nextAttemptAt: null,
      lastError: null,
      // Five hours ago: no schedule explains it.
      createdAt: new Date("2026-10-01T02:00:00.000Z"),
      isManualResend: false,
    },
    {
      id: "c",
      messageType: "REGISTRATION_CONFIRMED",
      recipientEmail: "eva@example.org",
      status: "FAILED",
      attemptCount: 6,
      nextAttemptAt: null,
      lastError: "550 mailbox unavailable",
      createdAt: new Date("2026-09-30T07:00:00.000Z"),
      isManualResend: false,
    },
  ],
};

const VOLUME = { remaining: 90 } as Props["volume"];

async function render(locale: "ro" | "en", overrides: Partial<Props> = {}): Promise<string> {
  state.locale = locale;
  const element = await OutboxQueuePanel({ locale, queue: QUEUE, volume: VOLUME, mayEdit: true, delivery: DELIVERY, now: NOW, mayEditTiming: true, ...overrides });
  return renderToStaticMarkup(element as ReactElement).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}

describe("§NNN the queue panel says when the emails leave", () => {
  it("names the switch's state, the next and the last round, and what holds the round back, in Romanian", async () => {
    const html = await render("ro");
    expect(html).toContain(ro.Admin.emails.queue.when.on);
    expect(html).toMatch(/data-testid="outbox-when-state"[^>]*data-timing="scheduled"/);
    // The next round at 12:00 club time, the wait the longest hold: the two-hour interval.
    expect(html).toMatch(/Următoarea trecere: [^<]*12:00\. Un email pus în coadă acum așteaptă cel mult 2 ore\./);
    expect(html).toContain("monitorul care apelează site-ul, o dată la o oră");
    expect(html).toContain("cel mult o dată la 2 ore");
    expect(html).toMatch(/Ultima trecere programată: [^<]*10:00\./);
    // The closed line says the state beside the count.
    expect(html).toContain("3 în așteptare · trimitere programată");
  });

  it("says each row's departure: the next round, late in red past the threshold, now, never", async () => {
    const html = await render("ro");
    const leaves = [...html.matchAll(/data-testid="outbox-row-leaves"[^>]*>([^<]*)</g)].map((match) => match[1]);
    expect(leaves).toHaveLength(3);
    expect(leaves[0]).toMatch(/^Pleacă: .*12:00 \(estimat\)\.$/);
    expect(leaves[1]).toMatch(/^Întârziat: trebuia să fi plecat deja\./);
    expect(leaves[2]).toBe(ro.Admin.emails.queue.leaves.never);
    expect(html).toContain(ro.Admin.emails.queue.leaves.never);
  });

  it("offers the Administrator the switch to the other value, asking first", async () => {
    const on = await render("ro");
    expect(on).toMatch(/data-testid="outbox-timing-form"/);
    expect(on).toMatch(/<input type="hidden" name="timing" value="immediate"\/>/);
    expect(on).toContain(ro.Admin.emails.queue.when.turnOff);

    const off = await render("ro", { delivery: { ...DELIVERY, timing: "immediate", waitMinutes: null } });
    expect(off).toContain(ro.Admin.emails.queue.when.off);
    expect(off).toMatch(/<input type="hidden" name="timing" value="scheduled"\/>/);
    expect(off).toContain(ro.Admin.emails.queue.when.turnOn);
    expect(off).toMatch(/Fiecare email pleacă imediat după cererea care l-a pus în coadă\./);
  });

  it("shows anybody else the timing and no switch", async () => {
    const html = await render("ro", { mayEditTiming: false, mayEdit: false });
    expect(html).toContain(ro.Admin.emails.queue.when.on);
    expect(html).not.toContain("outbox-timing-form");
    expect(html).not.toContain('name="timing"');
  });

  it("says a round never recorded, and leaves the interval and the brake out when neither is set", async () => {
    const html = await render("ro", {
      delivery: { ...DELIVERY, waitMinutes: 15, lastRunAt: null, holds: { pingerMinutes: 15, intervalMinutes: 0, governorFloorMinutes: 0 } },
    });
    expect(html).toContain(ro.Admin.emails.queue.when.neverRan);
    expect(html).not.toContain("Cât de des verifică site-ul");
    expect(html).not.toContain("frâna de buget");
  });

  it("says the same in English", async () => {
    const html = await render("en");
    expect(html).toContain(en.Admin.emails.queue.when.on);
    expect(html).toMatch(/Next round: [^<]*12:00\. An email queued now waits at most 2 hours\./);
    expect(html).toContain(en.Admin.emails.queue.when.turnOff);
    expect(html).toMatch(/Leaves: [^<]*12:00 \(estimated\)\./);
  });
});
