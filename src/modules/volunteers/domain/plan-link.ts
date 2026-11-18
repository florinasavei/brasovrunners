import { PLAN_LINK_LABEL_MAX, PLAN_LINK_URL_MAX, PLAN_LINKS_MAX, PLAN_PICTURES_MAX } from "@/db/schema/volunteer-plan";
import { DomainError } from "@/shared/errors/domain-error";

/*
  The links of «Poze și hărți» on «Planul voluntarilor» (§978; the owner, 2026-11-18: «am facut spre exemplu un google maps
  custom map si vreau sa pot pune url-ul»): what an address must be to stand on the plan, and how the page and the email say
  one. Pure rules, so they are tested without a request; `plan.ts` holds them to what was posted and writes the row.
*/

/** The boxes of «Adaugă un link», by the names the form posts and a refusal names. */
export const PLAN_LINK_BOXES = { url: "url", label: "label" } as const;

/** The sentences a refused press of «Poze și hărți» is answered with: `Admin.errors.<reason>`. */
export const PLAN_MAPS_REASONS = ["PLAN_PICTURES_FULL", "PLAN_LINKS_FULL", "PLAN_LINK_URL", "PLAN_LINK_LABEL"] as const;
export type PlanMapsReason = (typeof PLAN_MAPS_REASONS)[number];

/** What a reason's sentence needs filled in (`{max}`): the most pictures, the most links, the longest label. Never a word typed. */
export function planMapsRefusalValues(reason: string): Record<string, string> {
  if (reason === "PLAN_PICTURES_FULL") return { max: String(PLAN_PICTURES_MAX) };
  if (reason === "PLAN_LINKS_FULL") return { max: String(PLAN_LINKS_MAX) };
  if (reason === "PLAN_LINK_LABEL") return { max: String(PLAN_LINK_LABEL_MAX) };
  return {};
}

/**
 * A press of «Poze și hărți» refused for what was posted or for a plan that is full: a validation error that knows which
 * sentence says it (`reason`) and the box it is about, as `PlanPointRefusal` does for the plan's points.
 */
export class PlanMapsRefusal extends DomainError {
  constructor(
    readonly reason: PlanMapsReason,
    fields: readonly string[] = [],
  ) {
    super("VALIDATION_ERROR", reason, fields);
    this.name = "PlanMapsRefusal";
  }

  /** The placeholders of the reason's sentence. */
  get values(): Record<string, string> {
    return planMapsRefusalValues(this.reason);
  }
}

/** A space, a line break or a control character anywhere in an address: never part of one a person copied whole. */
const NOT_IN_AN_ADDRESS = /[\s\u0000-\u001f\u007f]/;

/**
 * The address a link is posted with, as it is kept (§978): trimmed; required; at most `PLAN_LINK_URL_MAX` characters; read
 * whole by the platform's own parser (`new URL`); an `https:` or `http:` address only — never `javascript:`, `data:`,
 * `mailto:` or a file — with a host; no space or control character inside. Anything else is refused naming the box.
 */
export function readPlanLinkUrl(value: unknown): string {
  const url = typeof value === "string" ? value.trim() : "";
  const refused = () => new PlanMapsRefusal("PLAN_LINK_URL", [PLAN_LINK_BOXES.url]);
  // Written whole, as a browser copies it: the scheme, two slashes and the host — never `https:path` or `https:///path`, which
  // the parser would read as some other host.
  if (url === "" || url.length > PLAN_LINK_URL_MAX || NOT_IN_AN_ADDRESS.test(url) || !/^https?:\/\/[^/]/i.test(url)) throw refused();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw refused();
  }
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.hostname === "") throw refused();
  return url;
}

/** The label a link is posted with (§978): trimmed, at most `PLAN_LINK_LABEL_MAX` characters, one for both languages; none is null. */
export function readPlanLinkLabel(value: unknown): string | null {
  const label = typeof value === "string" ? value.trim() : "";
  if (label === "") return null;
  if (label.length > PLAN_LINK_LABEL_MAX || /[\u0000-\u001f\u007f]/.test(label)) throw new PlanMapsRefusal("PLAN_LINK_LABEL", [PLAN_LINK_BOXES.label]);
  return label;
}

/** A kept address's host, without a leading `www.` — what the page writes in grey after a link and the email says for one with no label. */
export function planLinkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

/** The longest a link with no label is written, in characters: the host and the start of its path. */
const SHORT_MAX = 48;

/**
 * A link with no label, as the page writes it (§978): its host without `www.` and the start of its path —
 * «google.com/maps/d/viewer» —, cut with an ellipsis past `SHORT_MAX` characters. The whole address is the link's own.
 */
export function planLinkShort(url: string): string {
  let words: string;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
    words = `${parsed.hostname.replace(/^www\./i, "")}${path}`;
  } catch {
    words = url;
  }
  return words.length > SHORT_MAX ? `${words.slice(0, SHORT_MAX - 1)}…` : words;
}
