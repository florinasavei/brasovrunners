import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §529 — the owner, 2026-09-28: "vreau să pot vedea exact când pleacă emailurile și să pot face
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
  overdueCadenceMinutes: 120,
};

const QUEUE: Props["queue"] = {
  total: 3,
  due: 2,
  held: { total: 0, family: 0, retry: 0, reserve: 0, until: null },
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
      familyHeld: false,
      sentNow: false,
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
      familyHeld: false,
      sentNow: false,
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
      familyHeld: false,
      sentNow: false,
    },
  ],
};

const VOLUME = { remaining: 90 } as Props["volume"];

/** The element carrying `data-testid` in the panel's tree, before rendering: its props are what a client island receives. */
function findByTestId(node: unknown, testId: string): { props: Record<string, unknown> } | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByTestId(child, testId);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return null;
  const element = node as { props: Record<string, unknown> };
  if (element.props["data-testid"] === testId) return element;
  return findByTestId(element.props.children, testId);
}

async function render(locale: "ro" | "en", overrides: Partial<Props> = {}): Promise<string> {
  state.locale = locale;
  const element = await OutboxQueuePanel({ locale, queue: QUEUE, volume: VOLUME, mayEdit: true, delivery: DELIVERY, now: NOW, mayEditTiming: true, ...overrides });
  return renderToStaticMarkup(element as ReactElement).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}

describe("§529 the queue panel says when the emails leave", () => {
  it("names the switch's state, the next and the last round, and what holds the round back, in Romanian", async () => {
    const html = await render("ro");
    expect(html).toMatch(/data-testid="outbox-when-state"[^>]*data-timing="scheduled"/);
    // The next round at 12:00 club time, the wait the longest hold: the two-hour interval.
    expect(html).toMatch(/Emailurile pleacă la trecerea programată; următoarea: [^<]*12:00\./);
    expect(html).toContain("Un email pus în coadă acum așteaptă cel mult 2 ore.");
    expect(html).toContain("monitorul care apelează site-ul, o dată la o oră");
    expect(html).toContain("cel mult o dată la 2 ore");
    expect(html).toMatch(/Ultima trecere programată: [^<]*10:00\./);
    // The closed line says the waiting count alone: the state is said once, under the switch (review).
    expect(html).toContain("3 în așteptare</span>");
  });

  it("says each row's departure: the next round, late in red past the threshold, now, never", async () => {
    const html = await render("ro");
    const leaves = [...html.matchAll(/data-testid="outbox-row-leaves"[^>]*>([^<]*)</g)].map((match) => match[1]);
    expect(leaves).toHaveLength(3);
    // Today on the club's clock: the hour alone, in the words the screen after the form uses (`emailLeavesWords`, §536).
    expect(leaves[0]).toBe("Pleacă: 12:00 (estimat).");
    expect(leaves[1]).toMatch(/^Întârziat: trebuia să fi plecat deja\./);
    expect(leaves[2]).toBe(ro.Admin.emails.queue.leaves.never);
    expect(html).toContain(ro.Admin.emails.queue.leaves.never);
  });

  it("says another day's departure as the short day with its own «la», as the screen after the form does (§536)", async () => {
    const html = await render("ro", { delivery: { ...DELIVERY, nextTickAt: "2026-10-02T06:00:00.000Z" } });
    const leaves = [...html.matchAll(/data-testid="outbox-row-leaves"[^>]*>([^<]*)</g)].map((match) => match[1]);
    expect(leaves[0]).toBe("Pleacă: vin., 2 oct. 2026, la 09:00 (estimat).");
  });

  it("offers the Administrator the switch to the other value, asking first", async () => {
    const on = await render("ro");
    expect(on).toMatch(/data-testid="outbox-timing-form"/);
    expect(on).toMatch(/<input type="hidden" name="timing" value="immediate"\/>/);
    // Without JavaScript the button beside the switch posts the same form (§540).
    expect(on).toContain(ro.Admin.emails.queue.when.turnOff);

    const off = await render("ro", { delivery: { ...DELIVERY, timing: "immediate", waitMinutes: null } });
    expect(off).toContain(ro.Admin.emails.queue.when.stateOff);
    expect(off).toMatch(/<input type="hidden" name="timing" value="scheduled"\/>/);
    expect(off).toContain(ro.Admin.emails.queue.when.turnOn);
  });

  /** The switch's own input: MUI draws it as a checkbox with the `switch` role. */
  const switchInput = (html: string) => html.match(/<input[^>]*role="switch"[^>]*>/)?.[0] ?? "";

  it("is a switch labelled «Trimite la trecerea programată», checked under the scheduled setting, with one sentence of the mode (§540)", async () => {
    const on = await render("ro");
    expect(on).toContain(ro.Admin.emails.queue.when.turnOn);
    expect(switchInput(on)).toMatch(/checked=""/);
    expect(switchInput(on)).toMatch(/aria-describedby="outbox-when-state"/);
    expect(on).toMatch(/id="outbox-when-state"[^>]*>Emailurile pleacă la trecerea programată; următoarea: [^<]*12:00\.</);
    // The mode is said once: no chip in the «Când pleacă emailurile» box, and the panel's aside is the
    // waiting count alone, never «· la trecerea programată» (review).
    const whenBox = on.slice(on.indexOf('data-testid="outbox-when"'), on.indexOf('data-testid="outbox-when-last"'));
    expect(whenBox.length).toBeGreaterThan(0);
    expect(whenBox).not.toContain("MuiChip-root");
    expect(on).not.toContain("· la trecerea programată");
    expect(on).not.toContain("· imediat după cerere");

    const off = await render("ro", { delivery: { ...DELIVERY, timing: "immediate", waitMinutes: null } });
    expect(switchInput(off)).not.toMatch(/checked=""/);
    expect(off).toMatch(/id="outbox-when-state"[^>]*>Emailurile pleacă imediat după cererea care le-a pus în coadă\.</);
    expect(off).toContain("Ce rămâne (o nouă încercare, o amânare) pleacă la trecerea programată; următoarea:");

    const english = await render("en");
    expect(english).toContain("Send on the scheduled round");
    expect(english).toMatch(/id="outbox-when-state"[^>]*>Emails leave on the scheduled round; the next: [^<]*12:00\.</);
    const englishOff = await render("en", { delivery: { ...DELIVERY, timing: "immediate", waitMinutes: null } });
    expect(englishOff).toMatch(/id="outbox-when-state"[^>]*>Emails leave right after the request that queued them\.</);
  });

  it("shows anybody else the timing and no switch", async () => {
    const html = await render("ro", { mayEditTiming: false, mayEdit: false });
    expect(html).toMatch(/data-testid="outbox-when-state"[^>]*>Emailurile pleacă la trecerea programată;/);
    expect(html).not.toContain('role="switch"');
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
    expect(html).toMatch(/Emails leave on the scheduled round; the next: [^<]*12:00\./);
    expect(html).toContain("An email queued now waits at most 2 hours.");
    expect(html).toContain(en.Admin.emails.queue.when.turnOff);
    expect(html).toContain("Leaves: 12:00 (estimated).");
  });

  it("names the switch in «Termene»'s own words, both values", async () => {
    const on = await render("ro");
    expect(on).toContain("Emailurile pleacă la trecerea programată;");
    expect(on).toContain("Trimite imediat după cerere");
    const off = await render("en", { delivery: { ...DELIVERY, timing: "immediate", waitMinutes: null } });
    expect(off).toContain("Emails leave right after the request that queued them.");
    expect(off).toContain("Send on the scheduled round");
  });

  it("marks a row late by health's own cadence, the planned interval included", async () => {
    // Four hours past its turn: late against 90 + 120 minutes, not against 90 + 180 — the interval
    // the last real run planned under, which /api/health still allows after the brake dropped.
    const row = { ...QUEUE.rows[0]!, id: "d", createdAt: new Date(NOW.getTime() - 240 * 60_000) };
    const queue = { ...QUEUE, total: 1, rows: [row] };
    const strict = await render("ro", { queue });
    expect(strict).toMatch(/data-testid="outbox-row-leaves"[^>]*>Întârziat/);
    const planned = await render("ro", { queue, delivery: { ...DELIVERY, overdueCadenceMinutes: 180 } });
    expect(planned).not.toContain("Întârziat");
  });

  it("says a family's held row waits until its hold ends, then the round after it", async () => {
    const held = { ...QUEUE.rows[0]!, id: "f", familyHeld: true, nextAttemptAt: new Date("2026-10-01T08:30:00.000Z") };
    const html = await render("ro", { queue: { ...QUEUE, total: 1, due: 0, held: { total: 1, family: 1, retry: 0, reserve: 0, until: held.nextAttemptAt }, rows: [held] } });
    const leaves = [...html.matchAll(/data-testid="outbox-row-leaves"[^>]*>([^<]*)</g)].map((match) => match[1]);
    // Held until 11:30 club time; the first round at or after it is the 12:00 one.
    expect(leaves[0]).toMatch(/^Ținut până [^:]*11:30: o familie încă semnează\. Apoi pleacă la trecerea următoare: .*12:00 \(estimat\)\.$/);
  });

  it("«Trimite acum» names the due messages it sends and the held ones it leaves, with why", async () => {
    state.locale = "ro";
    const queue: Props["queue"] = {
      ...QUEUE,
      total: 5,
      due: 1,
      held: { total: 3, family: 2, retry: 1, reserve: 0, until: new Date("2026-10-01T08:30:00.000Z") },
    };
    const element = await OutboxQueuePanel({ locale: "ro", queue, volume: VOLUME, mayEdit: true, delivery: DELIVERY, now: NOW, mayEditTiming: true });
    const form = findByTestId(element, "send-now-form");
    const confirm = form?.props.confirm as { body: string; email: string };
    expect(confirm.email).toBe("Se trimite acum 1 email din coadă.");
    expect(confirm.body).toContain(ro.Admin.confirm.sendNowBody);
    expect(confirm.body).toMatch(/Rămân ținute: 3, primul până [^:]*11:30: familie care încă semnează: 2 · reîncercare sau amânare: 1\.$/);

    state.locale = "en";
    const english = await OutboxQueuePanel({ locale: "en", queue, volume: VOLUME, mayEdit: true, delivery: DELIVERY, now: NOW, mayEditTiming: true });
    const englishConfirm = findByTestId(english, "send-now-form")?.props.confirm as { body: string };
    expect(englishConfirm.body).toMatch(/Still held: 3, the first until [^:]*11:30: a family still signing: 2 · a retry or a deferral: 1\.$/);
  });

  it("says «Pleacă acum» for a row a press sent past the round, and its retry's time once tried (§540)", async () => {
    const now = { ...QUEUE.rows[0]!, id: "n", isManualResend: true, sentNow: true };
    const html = await render("ro", { queue: { ...QUEUE, total: 1, rows: [now] } });
    const leaves = [...html.matchAll(/data-testid="outbox-row-leaves"[^>]*>([^<]*)</g)].map((match) => match[1]);
    expect(leaves).toEqual([ro.Admin.emails.queue.leaves.leavesNow]);
    expect(await render("en", { queue: { ...QUEUE, total: 1, rows: [now] } })).toContain("Leaves now, without waiting for the scheduled round.");
    // Tried once and put back for a retry: the drain after the press is over, the row says its round.
    const retried = { ...now, attemptCount: 1 };
    const again = await render("ro", { queue: { ...QUEUE, total: 1, rows: [retried] } });
    expect(again).not.toContain(ro.Admin.emails.queue.leaves.leavesNow);
  });

  it("says under the round that a backoffice resend may leave at once, only while the round holds mail (§540)", async () => {
    expect(await render("ro")).toContain(ro.Admin.emails.deliveryTiming.bypassHelp);
    const off = await render("ro", { delivery: { ...DELIVERY, timing: "immediate", waitMinutes: null } });
    expect(off).not.toContain(ro.Admin.emails.deliveryTiming.bypassHelp);
  });

  it("offers no «Trimite acum» while nothing is due, and says why", async () => {
    const queue: Props["queue"] = { ...QUEUE, total: 2, due: 0, held: { total: 2, family: 0, retry: 0, reserve: 2, until: new Date("2026-10-02T00:00:00.000Z") } };
    const html = await render("ro", { queue });
    expect(html).not.toContain("send-now-form");
    expect(html).toContain(ro.Admin.emails.queue.sendNow.nothingDue);
  });
});

describe("OutboxQueuePanel for a reader who cannot send (§529)", () => {
  it("tells a late row's reader to tell the administrator, and a Gmail-paced retry is never a family's hold", async () => {
    const html = await render("ro", { mayEdit: false });
    expect(html).toContain("sau anunță administratorul.");
    expect(html).not.toContain("apasă «Trimite acum»");
    const paced = { ...QUEUE.rows[0]!, id: "p", nextAttemptAt: new Date(NOW.getTime() + 30_000) };
    const again = await render("ro", { queue: { ...QUEUE, total: 1, due: 0, rows: [paced] } });
    expect(again).not.toContain("Ținut până");
  });
});
