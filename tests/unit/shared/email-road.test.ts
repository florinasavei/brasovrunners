import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { DEFAULT_EMAIL_TRANSPORT, EMAIL_GROUPS, RECOMMENDED_ROAD, rowTransport } from "@/modules/notifications/domain/email-transport";
import { decodeEmailRoadChoice, EMAIL_ROAD_COOKIE, EMAIL_ROAD_MAX_AGE_SECONDS, emailRoadCookieLine, encodeEmailRoadChoice } from "@/shared/feedback/email-road";
import { encodeFlash } from "@/shared/feedback/notice";

/**
 * §841 — the road one press sends its email by: the dialog says it and lets the reader switch for
 * that press, the cookie carries the choice to the action, the toast names it.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");
const NOW = Date.parse("2026-10-21T15:00:00.000Z");

describe("§841 the road choice cookie", () => {
  it("round-trips a road and a group, and stops counting after twenty seconds", () => {
    const value = encodeEmailRoadChoice({ road: "gmail", group: "links" }, NOW);
    expect(value).toBe(`gmail.links.${NOW + EMAIL_ROAD_MAX_AGE_SECONDS * 1000}`);
    expect(decodeEmailRoadChoice(value, NOW)).toEqual({ road: "gmail", group: "links" });
    expect(decodeEmailRoadChoice(value, NOW + EMAIL_ROAD_MAX_AGE_SECONDS * 1000 - 1)).toEqual({ road: "gmail", group: "links" });
    expect(decodeEmailRoadChoice(value, NOW + EMAIL_ROAD_MAX_AGE_SECONDS * 1000 + 1)).toBeNull();
  });

  it("refuses anything that is not a road and a group — the cookie is the browser's to rewrite", () => {
    for (const raw of [undefined, null, "", "gmail", "sms.links.9999999999999", "gmail.everything.9999999999999", "gmail.links.soon", "gmail.links.", `gmail.links.${"9".repeat(40)}`]) {
      expect(decodeEmailRoadChoice(raw, NOW), String(raw)).toBeNull();
    }
  });

  it("is written for the press's own seconds, on every path, never beyond", () => {
    expect(emailRoadCookieLine({ road: "mailgun", group: "confirmations" }, NOW)).toBe(`${EMAIL_ROAD_COOKIE}=mailgun.confirmations.${NOW + 20_000}; Max-Age=20; Path=/; SameSite=Lax`);
  });
});

describe("§841 the row's road", () => {
  const setting = { ...DEFAULT_EMAIL_TRANSPORT, groups: { ...DEFAULT_EMAIL_TRANSPORT.groups, confirmations: "gmail" as const } };

  it("is the stamp when the press chose one, else the group's setting", () => {
    expect(rowTransport(setting, { messageType: "REGISTRATION_CONFIRMED", road: null }, false)).toBe("gmail");
    expect(rowTransport(setting, { messageType: "REGISTRATION_CONFIRMED", road: "mailgun" }, false)).toBe("mailgun");
    expect(rowTransport(setting, { messageType: "VERIFY_REGISTRATION_EMAIL", road: null }, false)).toBe("mailgun");
    expect(rowTransport(setting, { messageType: "VERIFY_REGISTRATION_EMAIL", road: "gmail" }, false)).toBe("gmail");
  });

  it("falls back to the group's road for a Gmail stamp where Gmail is not configured — the message still leaves", () => {
    expect(rowTransport(setting, { messageType: "VERIFY_REGISTRATION_EMAIL", road: "gmail" }, false, false)).toBe("mailgun");
    expect(rowTransport(setting, { messageType: "REGISTRATION_CONFIRMED", road: "mailgun" }, false, false)).toBe("mailgun");
  });

  it("recommends a road for every group — Gmail only for the club's own mailboxes", () => {
    for (const group of EMAIL_GROUPS) expect(RECOMMENDED_ROAD[group]).toBe(group === "club" ? "gmail" : "mailgun");
  });
});

describe("§841 the dialog's road line", () => {
  const dialog = read("src/shared/feedback/ConfirmDialog.tsx");

  it("says the road under the email line, and offers the two roads only where both exist", () => {
    expect(dialog).toMatch(/\{spec\.email && spec\.road && !spec\.road\.switchable && \([\s\S]*?data-testid="confirm-road"/);
    expect(dialog).toMatch(/\{spec\.email && spec\.road && spec\.road\.switchable && \([\s\S]*?<RadioGroup[\s\S]*?data-testid=\{`confirm-road-\$\{name\}`\}/);
    // The recommended road is marked on its own label, and the reason sits under the choices.
    expect(dialog).toContain("name === spec.road?.recommended ? `${spec.road.names[name]} · ${spec.road.recommendedMark}`");
    expect(dialog).toMatch(/data-testid="confirm-road-why"/);
  });

  it("writes the road into the cookie on either way forward — the button, Enter, and the quiet answer", () => {
    expect(dialog).toContain("document.cookie = emailRoadCookieLine({ road, group: spec.road.group }, Date.now());");
    expect(dialog).toContain("const confirm = withRoad(onConfirm);");
    expect(dialog).toContain("onClick={withRoad(alternative.onClick)}");
    expect(dialog).toContain("onClick={confirm}");
    expect(dialog).not.toContain("onClick={onConfirm}");
  });

  it("starts from the group's setting, not from the recommendation — the club's choice stands until the reader moves it", () => {
    expect(dialog).toContain('const road = picked.spec === spec ? picked.road : (spec?.road?.current ?? "mailgun");');
    // A new question starts afresh, even in a dialog kept mounted between two of them.
    expect(dialog).toContain("if (picked.spec !== spec) setPicked({ spec, road });");
  });
});

describe("§841 the toast names the road", () => {
  it("has the two sentences in both catalogues, and a reason for every group", () => {
    for (const catalogue of [ro, en]) {
      expect(typeof catalogue.Feedback.via.mailgun).toBe("string");
      expect(typeof catalogue.Feedback.via.gmail).toBe("string");
      for (const group of EMAIL_GROUPS) expect(typeof catalogue.Admin.confirm.road.why[group], group).toBe("string");
      expect(catalogue.Admin.confirm.road.leaves).toContain("{road}");
    }
  });

  it("appends the road's sentence to whatever the toast says", () => {
    const source = read("src/shared/feedback/ToastProvider.tsx");
    expect(source).toContain('const via = values.via === "mailgun" || values.via === "gmail" ? ` ${t(`via.${values.via}`)}` : "";');
    expect(source).toContain("return `${said}${via}`;");
  });

  it("flashes the chosen road as `via` beside the outcome's numbers, and nothing when no press chose one", async () => {
    const jar = { cookies: new Map<string, string>(), set: [] as { name: string; value: string }[], deleted: [] as string[] };
    vi.doMock("next/headers", () => ({
      cookies: async () => ({
        get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name) } : undefined),
        set: (name: string, value: string) => jar.set.push({ name, value }),
        delete: (name: string) => jar.deleted.push(name),
      }),
    }));
    const { flashOutcome } = await import("@/shared/feedback/flash");

    jar.cookies.set(EMAIL_ROAD_COOKIE, encodeEmailRoadChoice({ road: "gmail", group: "confirmations" }, Date.now()));
    await flashOutcome({ saved: "resent" });
    expect(jar.set).toHaveLength(1);
    expect(jar.set[0]).toMatchObject({ name: "br-flash", value: encodeFlash({ kind: "success", key: "resent", values: { via: "gmail" } }) });
    // Used and gone: the next press's request finds no choice of this one.
    expect(jar.deleted).toEqual([EMAIL_ROAD_COOKIE]);

    jar.cookies.clear();
    await flashOutcome({ saved: "participantMessageSent", sent: "3" });
    expect(jar.set[1].value).toBe(encodeFlash({ kind: "success", key: "participantMessageSent", values: { count: "3" } }));

    // An expired choice is no choice.
    jar.cookies.set(EMAIL_ROAD_COOKIE, encodeEmailRoadChoice({ road: "gmail", group: "links" }, Date.now() - 60_000));
    await flashOutcome({ saved: "resent" });
    expect(jar.set[2].value).toBe(encodeFlash({ kind: "success", key: "resent" }));
    vi.doUnmock("next/headers");
  });
});
