import { readFileSync } from "node:fs";
import path from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ro from "../../../messages/ro.json";
import en from "../../../messages/en.json";
import { givePlaceDoorOpen } from "@/modules/registrations/domain/give-place-door";
import { staffEntryConfirm } from "@/modules/registrations/staff-entry-confirm";
import { fillFromForm, pickConfirm, type ConfirmSpec } from "@/shared/feedback/notice";

/**
 * `DECISIONS.md` §875 — the newest waiting-list verbs finished (BR-REQ-037-05): the two dialogs that vouch
 * for an address name it; «Adaugă pe lista de așteptare» is drawn only where the press can succeed.
 */

const root = process.cwd();
const source = (file: string) => readFileSync(path.join(root, file), "utf8");

const NOW = new Date("2026-11-01T10:00:00Z");
const open = { registrationMode: "INTERNAL", eventStatus: "SCHEDULED", startsAt: new Date("2026-11-20T08:00:00Z"), dateToBeAnnounced: false, timeToBeAnnounced: false };

describe("BR-REQ-037-05 «Adaugă pe lista de așteptare» is drawn only where the press can succeed", () => {
  it("is drawn on an internal, scheduled, dated event that has not started", () => {
    expect(givePlaceDoorOpen(open, NOW)).toBe(true);
  });

  it.each([
    ["started", { startsAt: new Date("2026-11-01T09:00:00Z") }],
    ["starting this very instant", { startsAt: NOW }],
    ["cancelled", { eventStatus: "CANCELLED" }],
    ["completed", { eventStatus: "COMPLETED" }],
    ["date to be announced", { dateToBeAnnounced: true }],
    ["time to be announced", { timeToBeAnnounced: true }],
    ["external", { registrationMode: "EXTERNAL" }],
    ["without registration", { registrationMode: "NONE" }],
  ])("is absent on a %s event", (_name, change) => {
    expect(givePlaceDoorOpen({ ...open, ...change }, NOW)).toBe(false);
  });

  it("is the one predicate of «Dă-i un loc acum», on both pages", () => {
    expect(source("src/modules/registrations/give-place-tip.ts")).toContain("givePlaceDoorOpen(row, now)");
    expect(source("src/app/[locale]/admin/events/[id]/page.tsx")).toContain("canManageRegistrations(staffUser.role) && givePlaceDoorOpen(event, now) ? addToWaitlistAction");
    const list = source("src/app/[locale]/admin/registrations/(list)/page.tsx");
    expect(list).toContain("waitlistAddDoorOpen(filters.eventId)");
    expect(list).toContain("{filters.eventId && mayManage && waitlistAddOpen && (");
  });
});

const catalogues = { ro, en } as const;
const typed = "ana@example.test";
const posted = (fields: Record<string, string>) => (field: string) => fields[field] ?? null;

describe("BR-REQ-037-05 the staff entry's dialog names the address only when it is vouched for", () => {
  for (const [locale, messages] of Object.entries(catalogues)) {
    const confirm = messages.Admin.confirm;
    const specs = staffEntryConfirm({
      title: confirm.createRegistrationTitle,
      body: confirm.createRegistrationBody,
      vouchBody: confirm.createRegistrationVouchBody,
      email: "email line",
      road: {} as never,
      confirmLabel: "Add",
      cancelLabel: "Cancel",
    });
    const asked = (fields: Record<string, string>): ConfirmSpec | null => {
      const spec = pickConfirm(specs, posted(fields));
      return spec && fillFromForm(spec, posted(fields));
    };

    it(`${locale}: with the tick on, it says the address is vouched for and names the typed one`, () => {
      const spec = asked({ vouchAddress: "on", email: ` ${typed} ` });
      expect(spec?.body).toContain(typed);
      expect(spec?.body).not.toContain("{email}");
      expect(spec?.body).toBe(confirm.createRegistrationVouchBody.replace("{email}", typed));
      expect(spec?.email).toBe("email line");
    });

    it(`${locale}: with the tick off, it is today's dialog, unchanged`, () => {
      expect(asked({ email: typed })?.body).toBe(confirm.createRegistrationBody);
    });

    it(`${locale}: under the fast track, which ignores the tick, it is today's dialog`, () => {
      expect(asked({ vouchAddress: "on", fastTrack: "on", email: typed })?.body).toBe(confirm.createRegistrationBody);
    });
  }

  it("the new page builds its dialogs through the pure builder", () => {
    expect(source("src/app/[locale]/admin/registrations/new/page.tsx")).toContain("confirm={staffEntryConfirm({");
  });
});

let currentLocale: "ro" | "en" = "ro";
const seen: { confirm?: ConfirmSpec } = {};

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: currentLocale, messages: currentLocale === "ro" ? ro : en, namespace: namespace as "Admin" }),
  };
});
vi.mock("@/i18n/navigation", () => ({ getPathname: () => "/admin/registrations/new" }));
vi.mock("@/shared/feedback/confirm-words", () => ({ confirmWords: async () => ({ cancel: "Cancel", email: () => "email line", road: () => ({}) }) }));
vi.mock("@/shared/forms/refusal-messages", () => ({ refusalMessages: async () => ({}) }));
vi.mock("@/shared/forms/ActionForm", () => ({ default: () => null }));
vi.mock("@/shared/forms/recall", () => ({ default: () => null }));
vi.mock("@/shared/ui/CheckboxField", () => ({ default: () => null }));
vi.mock("@/shared/ui/GlyphButton", () => ({ default: () => null }));

function findConfirm(node: ReactNode): ConfirmSpec | undefined {
  if (!isValidElement(node)) return undefined;
  const element = node as ReactElement<{ confirm?: ConfirmSpec; children?: ReactNode }>;
  if (element.props.confirm) return element.props.confirm;
  for (const child of Array.isArray(element.props.children) ? element.props.children : [element.props.children]) {
    const found = findConfirm(child);
    if (found) return found;
  }
  return undefined;
}

describe("BR-REQ-037-05 «Adaugă pe lista de așteptare» asks, naming the address typed in the form", () => {
  beforeEach(() => {
    seen.confirm = undefined;
  });

  it.each(["ro", "en"] as const)("%s: the dialog's body repeats the typed address", async (locale) => {
    currentLocale = locale;
    const { default: WaitlistAddForm } = await import("@/modules/registrations/ui/WaitlistAddForm");
    const tree = await WaitlistAddForm({ locale, eventId: "e1", waitlistAddAction: (async () => ({})) as never, scope: "s", heading: false });
    const confirm = findConfirm(tree);
    expect(confirm?.fillFrom).toEqual(["email"]);
    expect(confirm?.body).toContain("{email}");
    const filled = fillFromForm(confirm as ConfirmSpec, posted({ email: ` ${typed} ` }));
    expect(filled.body).toContain(typed);
    expect(filled.body).not.toContain("{email}");
    expect(filled.email).toBe("email line");
  });
});
