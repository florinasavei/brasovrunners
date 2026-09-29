import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * BR-REQ-036-02 (§NNN, the second review of 2026-09-29) — «Reguli de siguranță» on every group run's
 * page: the essentials the optional declaration names, for everybody, inside «Condiții de
 * participare» — and nothing on a race's, which keeps its own rules section.
 *
 * The component the page mounts for every event, rendered on the server with the real messages.
 */
let currentLocale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  const en = (await import("../../../messages/en.json")).default;
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: currentLocale, messages: currentLocale === "ro" ? ro : en, namespace: namespace as "Event" }),
  };
});

const { default: GroupRunSafetyRules, SAFETY_RULE_KEYS } = await import("@/modules/group-run-declarations/ui/GroupRunSafetyRules");
const { CLUB_NAME } = await import("@/theme/brand");
const ro = (await import("../../../messages/ro.json")).default;
const en = (await import("../../../messages/en.json")).default;

afterEach(() => {
  currentLocale = "ro";
});

async function render(event: { type: string; surface: string | null }): Promise<string> {
  const element = await GroupRunSafetyRules({ event });
  return element === null ? "" : renderToStaticMarkup(element);
}

describe("the safety rules on a group run's page (§NNN)", () => {
  it("renders on a group run, with the club's name, in Romanian and in English", async () => {
    const html = await render({ type: "GROUP_RUN", surface: "TRAIL" });
    expect(html).toContain('data-testid="group-run-safety-rules"');
    expect(html).toContain("Reguli de siguranță");
    expect(html).toContain(`alergare de grup ${CLUB_NAME}`);
    expect(html).toContain("ghidaj montan");
    expect(html.match(/<li/g)?.length).toBe(SAFETY_RULE_KEYS.length + 1);
    currentLocale = "en";
    const english = await render({ type: "GROUP_RUN", surface: "ASPHALT" });
    expect(english).toContain("Safety rules");
    expect(english).toContain(`${CLUB_NAME} group run`);
    // A road run is no mountain: the trail's words stay on the trail.
    expect(english).not.toContain("mountain guiding");
  });

  it("renders nothing on a race's page, which keeps its own rules", async () => {
    expect(await render({ type: "RACE", surface: "TRAIL" })).toBe("");
    expect(await render({ type: "RACE", surface: null })).toBe("");
  });

  it("speaks plainly: short lines, no «platforma», no «de obicei», no number", () => {
    for (const words of [ro.Event.safetyRules, en.Event.safetyRules] as Record<string, string>[]) {
      for (const [key, line] of Object.entries(words)) {
        expect(line.length, key).toBeLessThanOrEqual(200);
        expect(line, key).not.toMatch(/platform|de obicei|usually|\d/i);
      }
    }
    expect(Object.keys(ro.Event.safetyRules)).toEqual(Object.keys(en.Event.safetyRules));
  });
});
