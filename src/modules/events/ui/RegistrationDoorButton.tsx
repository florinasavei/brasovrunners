import Button from "@mui/material/Button";
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
 * listing card (`CardRegistration`, §NNN), so a race's card and its page offer the same door in
 * the same words (`doorButtonLabel`).
 *
 * The one action the page exists for, so it is the one button that lights up under a pointer
 * (§166). Hover only, and only where hover is real: on a phone `:hover` sticks after a tap and the
 * button would stay lit for the rest of the visit. 44 pixels tall (BR-REQ-041-01 criterion 6).
 *
 * Synchronous on purpose: the facts that hold it on a card are rendered by tests with the
 * synchronous renderer, and the words are the caller's to give.
 */
export default function RegistrationDoorButton({ slug, cta, label }: { slug: string; cta: ButtonCta; label: string }) {
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
        sx={{ ...TAP_TARGET, ...accentOnHover }}
      >
        {label}
      </Button>
    );
  }

  return (
    <ButtonLink variant="contained" sx={{ ...TAP_TARGET, ...accentOnHover }} href={{ pathname: "/events/[slug]/register", params: { slug } }}>
      {label}
    </ButtonLink>
  );
}
