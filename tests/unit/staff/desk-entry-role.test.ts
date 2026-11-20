import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sparesTipText } from "@/modules/registrations/ui/SparesTip";
import {
  canEnterAtDesk,
  canManageRegistrations,
  canReadRegistrations,
  canWorkTheDesk,
  STAFF_ROLES,
  type StaffRole,
} from "@/modules/staff-identity/domain/roles";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §1025, BR-REQ-060-01, BR-REQ-037-07, BR-REQ-037-08 — «Adaugă pe cineva» is the organizers' (the owner, 2026-11-20: «Si
 * voluntarii nu pot adauga pe cineva, doar organizatorii si administratorii pot»), and the desk's spares line explains itself
 * («scrie aici și ceva tooltip cum se dau aceste numere de rezervă libere»).
 *
 * - the predicate is the readers' set by construction, for a role and for an actor with grants: the Organizer, the
 *   Administrator and the Superadministrator — never the desk's Volunteer, the Redactor, Tehnic or a member;
 * - it is what the desk's button, the entry page, the entry's action and its service ask, and the service asks it first;
 * - the «i» beside the spares says, per role, only what that role can press or needs to know, every line in both languages,
 *   at most 200 characters, every «…» it quotes a label the backoffice shows in that language.
 */
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const catalogues = { ro, en } as const;

describe("§1025 BR-REQ-060-01 who enters somebody at the desk", () => {
  it.each(STAFF_ROLES.map((role) => [role] as const))("lets %s enter exactly when it reads the registrations, by role or as an actor", (role) => {
    expect(canEnterAtDesk(role)).toBe(canReadRegistrations(role));
    // A grant neither gives the entry nor takes it away.
    expect(canEnterAtDesk({ role, permissions: new Set(["shop.manage"] as const) })).toBe(canReadRegistrations(role));
    expect(canEnterAtDesk({ role })).toBe(canReadRegistrations(role));
  });

  it("is the Organizer's, the Administrator's and the Superadministrator's; every other desk role calls one of them", () => {
    expect(STAFF_ROLES.filter((role) => canEnterAtDesk(role))).toEqual(["MODERATOR", "ADMIN", "SUPERADMIN"]);
    expect(STAFF_ROLES.filter((role) => canWorkTheDesk(role) && !canEnterAtDesk(role))).toEqual(["CONTRIBUTOR", "COPYWRITER", "DEV"]);
    expect(canEnterAtDesk("MEMBER")).toBe(false);
    // Whoever enters works the desk: the entry is a narrower desk verb, never a way in for somebody without a desk.
    for (const role of STAFF_ROLES) if (canEnterAtDesk(role)) expect(canWorkTheDesk(role), role).toBe(true);
  });

  it("is what the desk's button, the entry page, the entry's action and its service ask", () => {
    const desk = read("src/app/[locale]/admin/checkin/page.tsx");
    expect(desk).toContain("const mayEnter = canEnterAtDesk(actor);");
    expect(desk).toMatch(/const walkInHref = eventId && mayEnter\s*\?/);
    expect(desk).toContain("{!mayEnter && (");
    expect(read("src/app/[locale]/admin/registrations/new/page.tsx")).toContain("if (!canEnterAtDesk(actor.role)) notFound();");

    const actions = read("src/app/[locale]/admin/registrations/actions.ts");
    const create = actions.slice(actions.indexOf("export async function createRegistrationAction"));
    expect(create.slice(0, create.indexOf("\nexport ", 1))).toContain("await requireStaffCapability(canEnterAtDesk)");

    const service = read("src/modules/registrations/admin-service.ts");
    expect(service).toMatch(/function assertDeskEntry\(actor: Pick<StaffUser, "role">\): void \{\s*if \(!canEnterAtDesk\(actor\.role\)\)/);
    const entry = service.slice(service.indexOf("export async function createRegistrationByStaff"));
    // The first statement of the entry: refused before anything is read or written.
    expect(entry.slice(entry.indexOf("{\n") + 2).trimStart().startsWith("assertDeskEntry(actor);")).toBe(true);
  });
});

describe("§1025 the spares' «i»: words by role", () => {
  const keysFor = (role: StaffRole) => sparesTipText((key) => key, role).split("\n");

  it("tells a desk role that cannot enter to call an organizer, and nothing it cannot press", () => {
    for (const role of ["CONTRIBUTOR", "COPYWRITER", "DEV"] as const) {
      expect(keysFor(role), role).toEqual(["desk.sparesTip.what", "desk.sparesTip.desk", "desk.sparesTip.callOrganizer", "desk.sparesTip.given"]);
    }
  });

  it("tells the Organizer the entry's spare and «Dă-i un BIB gol» on a runner with no number", () => {
    expect(keysFor("MODERATOR")).toEqual([
      "desk.sparesTip.what",
      "desk.sparesTip.desk",
      "desk.sparesTip.walkIn",
      "desk.sparesTip.blankBib",
      "desk.sparesTip.invitation",
      "desk.sparesTip.given",
    ]);
  });

  it("tells the Administrators that «Dă-i un BIB gol» also replaces a number", () => {
    for (const role of ["ADMIN", "SUPERADMIN"] as const) {
      expect(keysFor(role), role).toEqual([
        "desk.sparesTip.what",
        "desk.sparesTip.desk",
        "desk.sparesTip.walkIn",
        "desk.sparesTip.blankBibReplace",
        "desk.sparesTip.invitation",
        "desk.sparesTip.given",
      ]);
      // The replace line is the role's that may replace a number (§548, §989), and only theirs.
      expect(canManageRegistrations(role)).toBe(true);
    }
  });

  /** Every string of a catalogue, for the labels the tip quotes. */
  const strings = (value: unknown, out: string[] = []): string[] => {
    if (typeof value === "string") out.push(value);
    else if (value && typeof value === "object") for (const child of Object.values(value)) strings(child, out);
    return out;
  };

  for (const locale of ["ro", "en"] as const) {
    it(`${locale}: every line and the button's-place line at most 200 characters, every «…» a label the backoffice shows`, () => {
      const desk = catalogues[locale].Admin.desk as unknown as { sparesTip: Record<string, string>; walkInCall: string };
      const lines = [...Object.values(desk.sparesTip), desk.walkInCall];
      expect(Object.keys(desk.sparesTip).sort()).toEqual(["blankBib", "blankBibReplace", "callOrganizer", "desk", "given", "invitation", "walkIn", "what"]);
      const labels = new Set(strings(catalogues[locale]));
      for (const line of lines) {
        expect(line.length, line).toBeLessThanOrEqual(200);
        for (const [, quoted] of line.matchAll(/«([^»]+)»/g)) expect(labels.has(quoted), `${locale}: «${quoted}»`).toBe(true);
      }
      // What the desk's other roles read: never the presses they do not have.
      const volunteer = sparesTipText((key) => (desk.sparesTip as Record<string, string>)[key.slice("desk.sparesTip.".length)], "CONTRIBUTOR");
      expect(volunteer).not.toContain(`«${catalogues[locale].Admin.desk.walkIn}»`);
      expect(volunteer).not.toContain(`«${catalogues[locale].Admin.registrations.spareBib.fold}»`);
      expect(desk.walkInCall).not.toContain(catalogues[locale].Admin.desk.walkIn);
    });
  }

  it("says the brief's own sentence in the button's place", () => {
    expect(ro.Admin.desk.walkInCall).toBe("Cineva care nu e pe listă? Cheamă un organizator: doar el îl poate adăuga.");
    expect(en.Admin.desk.walkInCall).toBe("Somebody not on the list? Call an organizer: only an organizer can add them.");
  });
});
