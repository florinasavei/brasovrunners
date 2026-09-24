import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BR-REQ-090-03 criterion 11 (§NNN) — the drain after a request tells the outbox job about what it
 * could not send.
 *
 * The request that queues a message drains the outbox once, after its response (§68). Whatever it
 * leaves — a retry after a transient failure, a batch longer than twenty, every message when the
 * club chose "scheduled" delivery (§221) — is the outbox job's again, and that job may be
 * answering "nothing due" from the cache. So the drain forgets the job's cached quiet exactly when
 * the leftover is due sooner than a real run would find it; a queue it emptied tells nobody.
 */
const state = vi.hoisted(() => ({
  timing: "immediate" as "immediate" | "scheduled",
  left: null as Date | null,
  failing: false,
  callback: null as null | (() => Promise<void>),
}));

vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("next/server", () => ({
  after: (callback: () => Promise<void>) => {
    state.callback = callback;
  },
}));
vi.mock("@/shared/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/config/env")>();
  // Not `test`: the drain is silent there by design, and this is the drain being tested.
  return { env: { ...actual.env, APP_ENV: "local" } };
});
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/infrastructure/email/sender", () => ({ createEmailSenderForEnvironment: () => ({ sender: {} }) }));
vi.mock("@/modules/notifications/render", () => ({ renderOutboxMessage: async () => ({}) }));
vi.mock("@/modules/notifications/delivery-timing", () => ({ readDeliveryTiming: async () => ({ timing: state.timing }) }));
vi.mock("@/modules/notifications/outbox", () => ({
  processOutboxBatch: async () => {
    if (state.failing) throw new Error("the provider is away");
    return { claimed: 1, sent: 1, retrying: 0, deferred: 0, failed: 0, bounced: 0 };
  },
}));
vi.mock("@/modules/jobs/next-work", () => ({ nextOutboxWork: async () => state.left }));

const { fakeNextCache } = await import("../../helpers/next-cache");
const { drainOutboxAfterResponse } = await import("@/modules/notifications/drain");

async function drain(): Promise<string[]> {
  drainOutboxAfterResponse();
  await state.callback?.();
  return [...fakeNextCache.invalidated];
}

beforeEach(() => {
  state.timing = "immediate";
  state.left = null;
  state.failing = false;
  state.callback = null;
  fakeNextCache.reset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("BR-REQ-090-03 criterion 11 the drain wakes the outbox job only for what it leaves behind", () => {
  it("tells nobody when it emptied the queue", async () => {
    expect(await drain()).toEqual([]);
  });

  it("wakes the job for a retry a minute away", async () => {
    state.left = new Date(Date.now() + 60_000);
    expect(await drain()).toEqual(["br-jobs:due:email-outbox"]);
  });

  it("leaves a row deferred to the allowance reset to the job's own hourly look", async () => {
    state.left = new Date(Date.now() + 10 * 60 * 60_000);
    expect(await drain()).toEqual([]);
  });

  it("wakes the job at once when the club chose scheduled delivery", async () => {
    state.timing = "scheduled";
    expect(await drain()).toEqual(["br-jobs:due:email-outbox"]);
  });

  it("wakes the job when the drain itself failed", async () => {
    state.failing = true;
    expect(await drain()).toEqual(["br-jobs:due:email-outbox"]);
  });
});
