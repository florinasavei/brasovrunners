import DirectionsRunIcon from "@mui/icons-material/DirectionsRun";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import Button from "@mui/material/Button";
import { glyphSx, WITH_GLYPH_SX } from "@/shared/ui/button-glyph";
import ButtonLink from "@/shared/ui/ButtonLink";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { accentOnHover } from "@/theme/surfaces";
import type { RegistrationCta } from "../domain/registration-cta";

/** The door states that carry a button: the form here, its waiting list, or the organizer's own page. */
export type ButtonCta = Extract<RegistrationCta, { kind: "OPEN" | "FULL" | "EXTERNAL" }>;

export function hasDoorButton(cta: RegistrationCta): cta is ButtonCta {
  return cta.kind === "OPEN" || cta.kind === "FULL" || cta.kind === "EXTERNAL";
}

type Say = (key: string, values?: Record<string, string | number>) => string;

/** The button's words, from the page's translator under `Event`: one set for the page and the card. */
export function doorButtonLabel(say: Say, cta: ButtonCta): string {
  if (cta.kind === "EXTERNAL") return cta.provider ? say("cta.externalWithProvider", { provider: cta.provider }) : say("cta.external");
  return cta.kind === "FULL" ? say("cta.joinWaitingList") : say("cta.register");
}

/**
 * The registration button itself — "Înscrie-te la eveniment", "Intră pe lista de așteptare" or
 * "Înscrie-te pe {provider}" — one component for the event page (`RegistrationCta`) and the
 * listing card (`CardRegistration`, §409), so a race's card and its page offer the same door in
 * the same words (`doorButtonLabel`).
 *
 * The one action the page exists for, so it is the one button that lights up under a pointer
 * (§166). Hover only, and only where hover is real: on a phone `:hover` sticks after a tap and the
 * button would stay lit for the rest of the visit. 44 pixels tall (BR-REQ-041-01 criterion 6).
 *
 * Synchronous on purpose: the facts that hold it on a card are rendered by tests with the
 * synchronous renderer, and the words are the caller's to give.
 */
export default function RegistrationDoorButton({
  slug,
  cta,
  label,
  preview,
}: {
  slug: string;
  cta: ButtonCta;
  label: string;
  /**
   * The editor's preview before saving (§NNN): the word «previzualizare» in the page's language.
   * Given, the same button in the same place with the same glyph and words, drawn disabled — a
   * preview has no form behind its door, and an organizer's page is not the preview's to open.
   */
  preview?: string;
}) {
  if (preview !== undefined) {
    const Glyph = cta.kind === "EXTERNAL" ? OpenInNewIcon : cta.kind === "FULL" ? HourglassEmptyIcon : DirectionsRunIcon;
    return (
      <Button variant="contained" disabled data-testid="preview-door" sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX }}>
        <Glyph aria-hidden="true" data-testid="door-glyph" sx={glyphSx("medium")} />
        {label} · {preview}
      </Button>
    );
  }
  if (cta.kind === "EXTERNAL") {
    return (
      <Button
        // `component="a"` with the organizer's own URL: this leaves the site, so it is a plain
        // anchor rather than the locale-aware Link. `nofollow` as well as `noopener noreferrer` —
        // the club does not vouch for an entry form it does not run.
        component="a"
        href={cta.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        variant="contained"
        sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX, ...accentOnHover }}
      >
        <OpenInNewIcon aria-hidden="true" data-testid="door-glyph" sx={glyphSx("medium")} />
        {label}
      </Button>
    );
  }

  // The club's runner on the way in (the public send buttons' figure, §318), an hourglass on the
  // way onto the waiting list (§498: every public button wears a glyph).
  const Glyph = cta.kind === "FULL" ? HourglassEmptyIcon : DirectionsRunIcon;
  return (
    <ButtonLink variant="contained" sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX, ...accentOnHover }} href={{ pathname: "/events/[slug]/register", params: { slug } }}>
      <Glyph aria-hidden="true" data-testid="door-glyph" sx={glyphSx("medium")} />
      {label}
    </ButtonLink>
  );
}
