import GavelIcon from "@mui/icons-material/Gavel";
import RedeemIcon from "@mui/icons-material/Redeem";
import UndoIcon from "@mui/icons-material/Undo";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { ReactElement } from "react";
import LegalDocumentBody from "@/modules/legal-documents/ui/LegalDocumentBody";
import CheckboxField from "@/shared/ui/CheckboxField";
import { FOLD_GLYPH_SX, PUBLIC_FOLD_SX } from "@/shared/ui/disclosure";
import SubmitButton from "@/shared/ui/SubmitButton";
import type { RaffleManageCard, RaffleRulesText } from "../raffle-roster";

type ServerAction = (form: FormData) => Promise<void>;

/**
 * The «Tombolă» card of «Gestionează înscrierea» (LINK, §984), one person's: drawn only while the raffle's sign-up gate is open for the
 * person's group and the person is a confirmed real registration with a number (`readRaffleManageCards`). Signed up, it says so and offers
 * «Nu mai particip»; not yet, «Regulamentul tombolei» in a fold, «Am citit și accept Regulamentul tombolei» and «Particip la tombolă»;
 * another adult on the address is offered the way out alone (§421). Two POSTs, each its own form, the token read and never spent; the GET
 * that draws the card writes nothing (BR-REQ-036-02 criterion 4). `#raffle` is the link's own person's, where a press lands.
 *
 * A function the page awaits, returning the element its tree draws — the page's own tests render it synchronously. A public page's
 * file: its icons are their own files, its buttons the house's `SubmitButton`, 44 pixels.
 *
 * Nothing is drawn for a person who could sign up while no rules can be read in the page's language (`rules` null — the gate asks
 * every language, so only a text withdrawn between the two reads): a card with no tick and no button would only say a wrong thing.
 */
export async function raffleManageCard(props: {
  locale: string;
  token: string;
  registrationId: string;
  own: boolean;
  family: boolean;
  card: RaffleManageCard;
  rules: RaffleRulesText | null;
  /** The press this person's card answers, when it does: `1` signed up, `w` withdrawn, `a` the tick missing, `0` refused. */
  outcome: string | null;
  signUpAction: ServerAction;
  withdrawAction: ServerAction;
}): Promise<ReactElement | null> {
  if (!props.card.signedUp && props.card.maySignUp && !props.rules) return null;
  const t = await getTranslations("Registrations");
  const hidden = (
    <>
      <input type="hidden" name="locale" value={props.locale} />
      <input type="hidden" name="token" value={props.token} />
      <input type="hidden" name="registrationId" value={props.registrationId} />
    </>
  );
  return (
    <Box id={props.own ? "raffle" : undefined} sx={{ mb: 2, scrollMarginTop: 16 }} data-testid="manage-raffle">
      {!props.family && (
        <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
          {t("raffle.title")}
        </Typography>
      )}
      {props.outcome === "1" && (
        <Alert severity="success" sx={{ mb: 2 }} data-testid="manage-raffle-done">
          {t("raffle.done")}
        </Alert>
      )}
      {props.outcome === "w" && (
        <Alert severity="success" sx={{ mb: 2 }} data-testid="manage-raffle-withdrawn">
          {t("raffle.withdrawn")}
        </Alert>
      )}
      {props.outcome === "a" && (
        <Alert severity="warning" sx={{ mb: 2 }} data-testid="manage-raffle-need-accept">
          {t("raffle.needAccept")}
        </Alert>
      )}
      {props.outcome === "0" && (
        <Alert severity="warning" sx={{ mb: 2 }} data-testid="manage-raffle-failed">
          {t("raffle.failed")}
        </Alert>
      )}
      {props.card.signedUp ? (
        <Box component="form" action={props.withdrawAction} data-testid="manage-raffle-withdraw">
          {hidden}
          <Typography sx={{ mb: 1 }} data-testid="manage-raffle-state">
            {t("raffle.signedUp")}
          </Typography>
          <SubmitButton label={t("raffle.withdraw")} pendingLabel={t("raffle.withdrawing")} variant="outlined" size="medium">
            <UndoIcon />
          </SubmitButton>
        </Box>
      ) : props.card.maySignUp && props.rules ? (
        <Box component="form" action={props.signUpAction} data-testid="manage-raffle-sign-up">
          {hidden}
          <Typography sx={{ mb: 1 }}>{t("raffle.intro")}</Typography>
          {/* «Regulamentul tombolei» in force, in this page's language, its blanks filled for the event: read before the tick. */}
          <Box component="details" sx={{ ...PUBLIC_FOLD_SX, mb: 1.5 }} data-testid="manage-raffle-rules">
            <Typography component="summary" variant="subtitle2">
              <GavelIcon aria-hidden sx={FOLD_GLYPH_SX} />
              {t("raffle.rules")}
            </Typography>
            <Box sx={{ mt: 1 }}>
              <Typography variant="h3" sx={{ fontSize: "1.0625rem", mb: 1 }}>
                {props.rules.title}
              </Typography>
              <LegalDocumentBody body={props.rules.body} values={props.rules.values} anchorPrefix={`raffle-${props.registrationId.slice(0, 8)}-s`} />
            </Box>
          </Box>
          <CheckboxField name="accept" required requiredMessage={t("raffle.needAccept")}>
            {t("raffle.accept")}
          </CheckboxField>
          <Box sx={{ mt: 1 }}>
            <SubmitButton label={t("raffle.signUp")} pendingLabel={t("raffle.signingUp")} size="medium">
              <RedeemIcon />
            </SubmitButton>
          </Box>
        </Box>
      ) : (
        // Another adult on the address, not signed up (§421): their acceptance is their own, so nothing here but where they sign up.
        <Typography variant="body2" color="text.secondary" data-testid="manage-raffle-other-adult">
          {t("raffle.otherAdult")}
        </Typography>
      )}
      {!props.family && <Divider sx={{ mt: 3 }} />}
    </Box>
  );
}
