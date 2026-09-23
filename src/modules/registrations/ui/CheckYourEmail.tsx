import CelebrationIcon from "@mui/icons-material/Celebration";
import DrawIcon from "@mui/icons-material/Draw";
import MarkEmailReadIcon from "@mui/icons-material/MarkEmailRead";
import QrCode2Icon from "@mui/icons-material/QrCode2";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import type { SubmittedFacts } from "../form-draft";
import { EMAIL_CONFIRMATION_HOLD_HOURS } from "../repository";

/**
 * What happens next, in three steps — the same three glyphs `RegistrationSteps` gives the
 * email, the declaration and the confirmation (§91), so a reader who saw the five-step flow
 * on the form recognises where they are: past the first step, standing on the second.
 */
const NEXT = [
  { key: "open", Icon: MarkEmailReadIcon },
  { key: "declare", Icon: DrawIcon },
  { key: "confirmed", Icon: QrCode2Icon },
] as const;

type Props = {
  eventTitle: string;
  /** The event's start, already formatted in its own zone and the reader's language. */
  whenLabel: string;
  /** The event's page, resolved by the caller with `getPathname` — a string across the boundary. */
  eventHref: string;
  /** The URL query the resend and contact pages take the event from. */
  slug: string;
  /** The inbox to open and the name to greet; null once the ten-minute cookie is gone. */
  facts: SubmittedFacts | null;
  /**
   * The participation window (§104) when it is still ahead: the declaration step then says how
   * many days before the start the confirmation is asked. Only that number is read here; the
   * deadline is `RegistrationSteps`'s longer telling, so the caller may pass its object as is.
   */
  window: { opensDays: number } | null;
};

/**
 * The screen after the form: "Aproape gata, Ana!" (the owner: the check-your-email screen
 * "should be more fun"), and every fact the receipt it replaces carried.
 *
 * Warmth, not cuteness: a first name in the heading when there is one, the event and its date,
 * the address the message went to (§224), three short steps with a glyph each, the wait in
 * bold and once (§224), the spam folder, how long the link lives — the lifecycle's own constant,
 * so this cannot promise what the allocator does not keep — and the sentence that keeps it true
 * for somebody who was already registered (§229). Then the two ways out when nothing arrives
 * (§205), and the way back to the event.
 *
 * **It reads the same for a first and a repeat registration.** Everything here comes from the
 * form the person just posted and the event they posted it to; nothing is read from the
 * registrations table, so the screen cannot answer whether an address was already on it — the
 * oracle `AGENTS.md` §19.4 forbids.
 *
 * A Server Component, like the rest of the flow (`AGENTS.md` §1.5): the icons are rendered
 * here as children, never handed to a client component as a prop, which is what fails
 * hydration (`GlyphChip.tsx`).
 */
export default async function CheckYourEmail({ eventTitle, whenLabel, eventHref, slug, facts, window }: Props) {
  const t = await getTranslations("Registration");
  const values = {
    hours: EMAIL_CONFIRMATION_HOLD_HOURS,
    opensDays: window?.opensDays ?? 0,
  };
  const stepBody = (key: (typeof NEXT)[number]["key"]) =>
    key === "declare" && window ? t("done.next.declare.bodyLater", values) : t(`done.next.${key}.body`, values);
  const textLink = { display: "inline-flex", alignItems: "center", minHeight: TAP_TARGET.minHeight } as const;

  return (
    <Stack spacing={3}>
      <Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
          <Box
            aria-hidden="true"
            sx={{
              width: 48,
              height: 48,
              flexShrink: 0,
              borderRadius: "50%",
              bgcolor: "success.main",
              color: "success.contrastText",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CelebrationIcon />
          </Box>
          <Typography component="h2" variant="h2" sx={{ fontSize: { xs: "1.5rem", sm: "1.75rem" } }}>
            {facts?.firstName ? t("done.headingNamed", { name: facts.firstName }) : t("done.heading")}
          </Typography>
        </Box>
        <Typography variant="body1">{t("done.lead", { event: eventTitle, date: whenLabel })}</Typography>
        {/*
          The address it went to (§224): "check your email" is useless to somebody who typed
          `@gmail.con`, and reading their own address back is what catches it in the second
          before they walk away.
        */}
        {facts?.email && (
          <Typography variant="body1" sx={{ mt: 0.5 }}>
            {t("submittedTo")}{" "}
            <Box component="strong" sx={{ wordBreak: "break-all" }}>
              {facts.email}
            </Box>
          </Typography>
        )}
      </Box>

      <Box component="section" aria-labelledby="check-email-next">
        <Typography id="check-email-next" component="h3" variant="h3" sx={{ fontSize: "1.125rem", mb: 1.5 }}>
          {t("done.nextTitle")}
        </Typography>
        <Stack component="ol" spacing={1.5} sx={{ listStyle: "none", p: 0, m: 0 }}>
          {NEXT.map(({ key, Icon }, index) => (
            <Box component="li" key={key} sx={{ display: "grid", gridTemplateColumns: "40px 1fr", columnGap: 1.5, alignItems: "start" }}>
              <Box
                aria-hidden="true"
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  bgcolor: index === 0 ? "primary.main" : "action.selected",
                  color: index === 0 ? "primary.contrastText" : "text.primary",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon fontSize="small" />
              </Box>
              <Box>
                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                  {t(`done.next.${key}.title`)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {stepBody(key)}
                </Typography>
              </Box>
            </Box>
          ))}
        </Stack>
      </Box>

      <Box sx={{ borderLeft: 3, borderColor: "primary.main", pl: 2 }}>
        {/* The wait, in bold and once (§224): not knowing it is normal is what makes somebody
            fill the form in again thirty seconds later. */}
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {t("done.delay")}
        </Typography>
        <Typography variant="body2">{t("done.notArrived", values)}</Typography>
        {/*
          The sentence that keeps this screen true (§229). Re-submitting an address that is
          already confirmed re-sends the confirmation, QR and all (§199); saying "you are already
          registered" here would answer a question about somebody else's address to anybody who
          types it (§19.4), so the sentence reads the same for everybody and only the owner of
          the inbox learns which case they are in.
        */}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {t("submittedAlready")}
        </Typography>
      </Box>

      <Box>
        {/*
          The two ways out when the message does not arrive (§205; the owner: "trebuie să lăsăm
          oamenii să se înscrie cu orice preț"): the resend for a message lost in transit, and —
          quieter, second, present — the contact form for an address the resend cannot reach.
          Both carry the event so nobody is asked a second question.
        */}
        <Typography variant="body2" color="text.secondary">
          {t("resend.prompt")}{" "}
          <Link href={{ pathname: "/registrations/resend", query: { event: slug } }} style={textLink}>
            {t("resend.linkLabel")}
          </Link>
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("resend.stillNothing")}{" "}
          <Link href={{ pathname: "/contact", query: { about: slug } }} style={textLink}>
            {t("resend.contactLinkLabel")}
          </Link>
        </Typography>
      </Box>

      <Box>
        {/* `component="a"` with a resolved path, never `component={Link}`: a component reference
            does not cross the Server → client boundary (`GlyphChip.tsx`). */}
        <Button component="a" href={eventHref} variant="outlined" sx={TAP_TARGET}>
          {t("done.backToEvent")}
        </Button>
      </Box>
    </Stack>
  );
}
