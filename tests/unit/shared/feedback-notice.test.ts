import { describe, expect, it } from "vitest";
import {
  confirmOnKey,
  decodeFlash,
  EMPTY_TOAST_QUEUE,
  encodeFlash,
  FLASH_COOKIE,
  noticeOf,
  pickConfirm,
  TOAST_AUTO_HIDE_MS,
  toastQueueReducer,
} from "@/shared/feedback/notice";

/**
 * `DECISIONS.md` §NNN — one mechanism for "it worked" and "are you sure" across the backoffice.
 *
 * The pure half, held down in Node: the toast queue (one at a time, in order, dismiss brings the
 * next), the flash's encoding (a cookie the browser could rewrite), the notice a redirect's
 * outcome becomes, which dialog a form's values pick, and what Enter does. The islands that draw
 * them are `ToastProvider` and `ConfirmDialog`; the browser side is
 * `tests/e2e/toasts-and-confirms.spec.ts`.
 */
describe("§NNN the toast queue", () => {
  const saved = { kind: "success" as const, key: "event" };
  const archived = { kind: "success" as const, key: "eventsArchived", values: { count: "3" } };

  it("shows the first notice at once and queues the rest behind it — one at a time", () => {
    let queue = toastQueueReducer(EMPTY_TOAST_QUEUE, { type: "show", notice: saved });
    expect(queue.current).toEqual({ ...saved, id: 1 });
    expect(queue.waiting).toEqual([]);

    queue = toastQueueReducer(queue, { type: "show", notice: archived });
    expect(queue.current).toEqual({ ...saved, id: 1 });
    expect(queue.waiting).toEqual([archived]);
  });

  it("dismissing brings the next one up, with a new id so the Snackbar re-enters; then nothing", () => {
    let queue = toastQueueReducer(EMPTY_TOAST_QUEUE, { type: "show", notice: saved });
    queue = toastQueueReducer(queue, { type: "show", notice: archived });
    queue = toastQueueReducer(queue, { type: "dismiss" });
    expect(queue.current).toEqual({ ...archived, id: 2 });
    expect(queue.waiting).toEqual([]);
    queue = toastQueueReducer(queue, { type: "dismiss" });
    expect(queue.current).toBeNull();
    // A dismiss with nothing showing is harmless.
    expect(toastQueueReducer(queue, { type: "dismiss" }).current).toBeNull();
  });

  it("stays between five and six seconds, the owner's brief", () => {
    expect(TOAST_AUTO_HIDE_MS).toBeGreaterThanOrEqual(5000);
    expect(TOAST_AUTO_HIDE_MS).toBeLessThanOrEqual(6000);
  });
});

describe("§NNN the notice a redirect's outcome becomes", () => {
  it("names the sentence by the `saved` code and carries the other parameters as values", () => {
    // `offered` rides along as a value; it counts nothing the sentence pluralises, so no `count`.
    expect(noticeOf({ saved: "event", offered: "2" })).toEqual({ kind: "success", key: "event", values: { offered: "2" } });
    expect(noticeOf({ saved: "bibSet" })).toEqual({ kind: "success", key: "bibSet" });
  });

  it("takes the first counting parameter as `count`, so a counted sentence needs no ICU plural", () => {
    expect(noticeOf({ saved: "eventsArchived", archived: "3", failed: "1" })?.values).toEqual({ archived: "3", failed: "1", count: "3" });
    expect(noticeOf({ saved: "outboxSent", sent: 7 })?.values).toEqual({ sent: "7", count: "7" });
    // An explicit count wins.
    expect(noticeOf({ saved: "x", count: "9", sent: "7" })?.values?.count).toBe("9");
  });

  it("is nothing for a refusal, an absent outcome or a code that is not a key", () => {
    expect(noticeOf({ error: "CONFLICT" })).toBeNull();
    expect(noticeOf({})).toBeNull();
    expect(noticeOf({ saved: "not a key!" })).toBeNull();
    expect(noticeOf({ saved: "event", "bad name": "x" })?.values).toBeUndefined();
  });
});

describe("§NNN the flash cookie", () => {
  it("round-trips a notice, values as strings, in a value a cookie header can carry", () => {
    const notice = { kind: "info" as const, key: "participantMessageDuplicate", values: { count: "2", test: "1" } };
    const encoded = encodeFlash(notice);
    expect(encoded).not.toMatch(/[;"\s]/);
    expect(decodeFlash(encoded)).toEqual(notice);
    expect(decodeFlash(encodeFlash({ kind: "success", key: "event" }))).toEqual({ kind: "success", key: "event" });
  });

  it("refuses anything that is not a notice — the cookie is the browser's to rewrite", () => {
    expect(decodeFlash(undefined)).toBeNull();
    expect(decodeFlash("")).toBeNull();
    expect(decodeFlash("not json")).toBeNull();
    expect(decodeFlash(encodeURIComponent(JSON.stringify({ k: "danger", n: "x" })))).toBeNull();
    expect(decodeFlash(encodeURIComponent(JSON.stringify({ k: "success", n: "<script>" })))).toBeNull();
    // A value that is not a string is dropped, never spread into the sentence.
    expect(decodeFlash(encodeURIComponent(JSON.stringify({ k: "success", n: "event", v: { count: { a: 1 }, offered: 2 } })))).toEqual({
      kind: "success",
      key: "event",
      values: { offered: "2" },
    });
    expect(decodeFlash("x".repeat(3000))).toBeNull();
    expect(FLASH_COOKIE).toBe("br-flash");
  });
});

describe("§NNN which question a form's values pick", () => {
  const cancelNotify = { when: [{ field: "event.eventStatus", equals: "CANCELLED" }, { field: "cancel.notify", equals: "on" }], title: "cancel+email", body: "", confirmLabel: "", cancelLabel: "" };
  const cancelQuiet = { when: [{ field: "event.eventStatus", equals: "CANCELLED" }], title: "cancel", body: "", confirmLabel: "", cancelLabel: "" };
  const notice = { when: [{ field: "notice.notify", equals: "on" }], title: "notice", body: "", confirmLabel: "", cancelLabel: "" };
  const specs = [cancelNotify, cancelQuiet, notice];
  const values = (fields: Record<string, string>) => (field: string) => fields[field] ?? null;

  it("takes the first spec whose every condition holds, in order", () => {
    expect(pickConfirm(specs, values({ "event.eventStatus": "CANCELLED", "cancel.notify": "on" }))?.title).toBe("cancel+email");
    expect(pickConfirm(specs, values({ "event.eventStatus": "CANCELLED" }))?.title).toBe("cancel");
    expect(pickConfirm(specs, values({ "event.eventStatus": "SCHEDULED", "notice.notify": "on" }))?.title).toBe("notice");
  });

  it("asks nothing when no spec matches — the save that changes nothing outward", () => {
    expect(pickConfirm(specs, values({ "event.eventStatus": "SCHEDULED" }))).toBeNull();
    expect(pickConfirm(undefined, values({}))).toBeNull();
  });

  it("a spec without conditions always matches, and `notEquals` reads an absent value as different", () => {
    const always = { title: "always", body: "", confirmLabel: "", cancelLabel: "" };
    expect(pickConfirm(always, values({}))?.title).toBe("always");
    expect(pickConfirm([notice, always], values({}))?.title).toBe("always");
    const unless = { when: [{ field: "direction", notEquals: "undo" }], title: "in", body: "", confirmLabel: "", cancelLabel: "" };
    expect(pickConfirm(unless, values({ direction: "in" }))?.title).toBe("in");
    expect(pickConfirm(unless, values({ direction: "undo" }))).toBeNull();
  });
});

describe("§NNN what Enter does in the dialog", () => {
  it("confirms a dialog that is not destructive, and nothing else", () => {
    expect(confirmOnKey("Enter", false)).toBe("confirm");
    expect(confirmOnKey("Enter", undefined)).toBe("confirm");
    expect(confirmOnKey("Enter", true)).toBeNull();
    expect(confirmOnKey("Escape", false)).toBeNull();
    expect(confirmOnKey(" ", false)).toBeNull();
  });
});
