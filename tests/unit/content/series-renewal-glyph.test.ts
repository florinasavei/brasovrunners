import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * §NNN — the owner, on the events list's series line ("Se reînnoiește automat: ..."): "aici am
 * nevoie de o iconiță gen «robot» ca să știu că se reînnoiește automat". The glyph is `SmartToy`,
 * registered as `renew` in the backoffice's one glyph table (`shared/ui/action-icons.ts`, §318)
 * and drawn from it directly — never an emoji, never an element handed across a server/client
 * boundary (the page that draws it is itself a Server Component; it renders the glyph in its own
 * tree, so nothing crosses).
 */
const REGISTRY = readFileSync(path.join(process.cwd(), "src", "shared", "ui", "action-icons.ts"), "utf8");
const PAGE = readFileSync(path.join(process.cwd(), "src", "app", "[locale]", "admin", "(list)", "page.tsx"), "utf8");
const PANEL = readFileSync(
  path.join(process.cwd(), "src", "modules", "content", "events", "ui", "RecurrenceSeriesPanel.tsx"),
  "utf8",
);

describe("§NNN the series' robot glyph", () => {
  it("registers SmartToy as `renew`, one file, never the barrel", () => {
    expect(REGISTRY).toContain('import SmartToyIcon from "@mui/icons-material/SmartToy";');
    expect(REGISTRY).toContain("renew: SmartToyIcon,");
    expect(REGISTRY).toMatch(/\|\s*"renew"/);
  });

  it("leads the series-renews sentence on the events list, aria-hidden, from the registry", () => {
    expect(PAGE).toContain('import { ACTION_ICONS } from "@/shared/ui/action-icons";');
    expect(PAGE).toContain("const RenewIcon = ACTION_ICONS.renew;");
    expect(PAGE).toMatch(/<RenewIcon aria-hidden[^>]*\/>[\s\S]{0,200}seriesRenewsUntil/);
    // The icon sits before both sentences the line may show — the club chose "for ever" or an
    // end date — and the words themselves are untouched.
    expect(PAGE).toMatch(/<RenewIcon aria-hidden[^>]*\/>[\s\S]{0,400}t\("events\.seriesRenewsUntil"/);
    expect(PAGE).toMatch(/t\("events\.seriesRenewsForever"/);
  });

  it("never draws it as an emoji", () => {
    expect(PAGE).not.toMatch(/🤖/);
  });

  it("also leads the editor's own two mentions of the switch — the renewal line and the publish-state line", () => {
    expect(PANEL).toContain('import { ACTION_ICONS } from "@/shared/ui/action-icons";');
    expect(PANEL).toContain("const RenewIcon = ACTION_ICONS.renew;");
    // The renewal sentence's twin (`editor.repeatRenewal`) and the publish-state line
    // (`publishState`, on/waiting/off) each get their own leading, aria-hidden icon.
    expect(PANEL).toMatch(/<RenewIcon aria-hidden[^>]*\/>[\s\S]{0,200}editor\.repeatRenewal/);
    expect(PANEL).toMatch(/<RenewIcon aria-hidden[^>]*\/>[\s\S]{0,200}\{publishState\}/);
    expect(PANEL).not.toMatch(/🤖/);
  });
});
