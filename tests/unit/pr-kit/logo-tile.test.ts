import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LogoTile, { type LogoTileFace } from "@/modules/pr-kit/ui/LogoTile";

/**
 * §NNN — «PR Kit»'s white tiles carry a tick (the owner, 2026-11-22, of the white logo drawn on the club's colour: «nu știam de
 * ce are fundal albastru, trebe să fie ceva bifă pt fundal, e confusing»). What the tile shows is what it hands out: unticked,
 * the picture on a checkerboard and the transparent files; ticked, the picture and the three files on the club's colour. A
 * tile with no other ground has no tick. The tick's change itself is React's `useState`; here the two states are drawn.
 */
const face = (ground: "none" | "primary"): LogoTileFace => {
  const suffix = ground === "primary" ? "-on-primary" : "";
  return {
    name: ground === "primary" ? "Logo complet · alb pe culoarea clubului" : "Logo complet · alb",
    preview: `/brand/kit/club-logo-white${suffix}.svg`,
    ground: ground === "primary" ? "#0000ff" : null,
    downloads: (["svg", "png", "pdf"] as const).map((format) => ({
      format,
      href: `/api/admin/pr-kit/logo/club-logo-white${suffix}${format === "png" ? "-4000px" : ""}.${format}`,
      text: format.toUpperCase(),
      label: `Descarcă ${format}`,
    })),
  };
};

const onPrimary = { face: face("primary"), tick: "Cu fundal în culoarea clubului" };
/** The downloads' addresses — not the picture's preload link React adds beside an image. */
const hrefs = (html: string) => [...html.matchAll(/href="(\/api\/[^"]+)"/g)].map((match) => match[1]);

describe("§NNN the PR kit's white tile and its ground tick", () => {
  it("unticked on arrival: the transparent files, the picture on the checkerboard", () => {
    const html = renderToStaticMarkup(createElement(LogoTile, { shape: "lockup", ink: "white", face: face("none"), onPrimary }));
    expect(html).toContain('data-ground="none"');
    expect(html).toContain('data-testid="pr-kit-logo-ground"');
    expect(html).not.toMatch(/<input[^>]*checked/);
    expect(html).toContain("Cu fundal în culoarea clubului");
    expect(html).toContain('src="/brand/kit/club-logo-white.svg"');
    expect(hrefs(html)).toEqual(["/api/admin/pr-kit/logo/club-logo-white.svg", "/api/admin/pr-kit/logo/club-logo-white-4000px.png", "/api/admin/pr-kit/logo/club-logo-white.pdf"]);
    expect(html).toContain("repeating-conic-gradient");
  });

  it("ticked: the picture and the three files on the club's colour, and the name says so", () => {
    const html = renderToStaticMarkup(createElement(LogoTile, { shape: "lockup", ink: "white", face: face("none"), onPrimary, startOnPrimary: true }));
    expect(html).toContain('data-ground="primary"');
    expect(html).toMatch(/<input[^>]*checked/);
    expect(html).toContain('src="/brand/kit/club-logo-white-on-primary.svg"');
    expect(html).toContain("Logo complet · alb pe culoarea clubului");
    expect(hrefs(html)).toEqual([
      "/api/admin/pr-kit/logo/club-logo-white-on-primary.svg",
      "/api/admin/pr-kit/logo/club-logo-white-on-primary-4000px.png",
      "/api/admin/pr-kit/logo/club-logo-white-on-primary.pdf",
    ]);
    expect(html).not.toContain("repeating-conic-gradient");
  });

  it("a tile with one ground has no tick", () => {
    const black: LogoTileFace = { ...face("none"), ground: "#ffffff" };
    const html = renderToStaticMarkup(createElement(LogoTile, { shape: "lockup", ink: "black", face: black, startOnPrimary: true }));
    expect(html).not.toContain('data-testid="pr-kit-logo-ground"');
    expect(html).toContain('data-ground="none"');
  });
});
