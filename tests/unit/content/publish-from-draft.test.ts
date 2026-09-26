import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { allowedTransitions, EDITORIAL_STATUSES, eventEditorTransitions, STAFF_ROLES } from "@/modules/staff-identity/domain/roles";

/**
 * BR-REQ-051-01 — «Publică» on a draft's own editor, one press, as «Creează și publică» on the
 * create page (§423, after §406: "I am missing the create and publish for some new events… this
 * should be consistent!"). The create page offered the one press on every type and every series;
 * an event saved as a draft, a copy, or a date a series made could only be sent for review from
 * its editor. These hold the verbs the editor draws; the integration test holds the service.
 */
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("§423 the editor's verbs on a draft", () => {
  it("offers an Administrator «Publică» first on a draft, beside the table's own verbs", () => {
    for (const role of ["ADMIN", "SUPERADMIN"] as const) {
      expect(eventEditorTransitions(role, "DRAFT", false)).toEqual(["PUBLISHED", ...allowedTransitions(role, "DRAFT", false)]);
      expect(eventEditorTransitions(role, "DRAFT", false)).toContain("IN_REVIEW");
    }
  });

  it("offers nobody who may not publish anything the table does not", () => {
    for (const role of STAFF_ROLES) {
      if (role === "ADMIN" || role === "SUPERADMIN") continue;
      for (const from of EDITORIAL_STATUSES) {
        expect(eventEditorTransitions(role, from, true), `${role} from ${from}`).toEqual(allowedTransitions(role, from, true));
      }
    }
  });

  it("changes nothing from any state but a draft", () => {
    for (const role of STAFF_ROLES) {
      for (const from of EDITORIAL_STATUSES.filter((status) => status !== "DRAFT")) {
        expect(eventEditorTransitions(role, from, false), `${role} from ${from}`).toEqual(allowedTransitions(role, from, false));
      }
    }
  });

  it("is what the event editor draws, and «Publică» goes to the service that walks the review", () => {
    const editor = read("src/app/[locale]/admin/events/[id]/page.tsx");
    expect(editor).toContain("const transitions = eventEditorTransitions(");
    expect(editor).not.toContain("allowedTransitions(");
    const actions = read("src/app/[locale]/admin/actions.ts");
    expect(actions).toMatch(/if \(to === "PUBLISHED"\) await publishEvent\(getDb\(\), move\);\s*else await transitionEvent\(getDb\(\), \{ \.\.\.move, to \}\);/);
    // Standing pages and albums keep the plain table.
    for (const file of ["src/app/[locale]/admin/pages/[id]/page.tsx", "src/app/[locale]/admin/gallery/[id]/page.tsx"]) {
      expect(read(file), file).not.toContain("eventEditorTransitions");
    }
  });
});
