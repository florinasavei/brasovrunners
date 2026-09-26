import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { giveOlderPicturesLadderAction } from "@/app/[locale]/admin/tasks/actions";
import { countForm } from "@/i18n/count-form";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { OLDER_PICTURES_PER_PRESS } from "@/modules/media/older-pictures";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";

type Props = {
  locale: Locale;
  /** The pictures still without a ladder (`countOlderPictures`); the page renders nothing at zero. */
  left: number;
  /** How many the press just made could not be converted (`?failed=` on the address it lands on); 0 says nothing. */
  lastFailed: number;
};

/**
 * The one-off button of §430: the pictures stored before §414 get their ladder, a batch per press.
 *
 * On the task board rather than on the pictures page because it is a thing owed once, by the
 * Administrator, and the board is where the owed things are; it disappears when nothing is left.
 * A Server Component with one form, the same shape as the cadence card beside the Neon plan
 * (`JobCadencePanel`): the question first (§384 — it changes what the public pages load and
 * bumps the version of every text it rewrites), then the toast with the numbers. The page and
 * the service both assert the role (BR-REQ-060-01).
 *
 * One total, not a count per kind (gallery photo, picture in a text, album cover), on purpose
 * (§430): the press treats every kind alike, in one order, and the Administrator's one decision
 * — press until nothing is left — does not change with the split. A per-kind count would be
 * three reference joins on every load of the board for a number nobody acts on differently; the
 * pictures page already says where each one is used.
 */
export default async function OlderPicturesPanel({ locale, left, lastFailed }: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const batch = Math.min(left, OLDER_PICTURES_PER_PRESS);

  return (
    <Panel
      id="older-pictures"
      title={t("tasks.olderPictures.title")}
      intro={t("tasks.olderPictures.intro", { perPress: OLDER_PICTURES_PER_PRESS })}
      data-testid="older-pictures"
    >
      <Typography variant="body2" sx={{ fontWeight: 500 }} data-testid="older-pictures-left">
        {t(`tasks.olderPictures.left.${countForm(left, locale)}`, { count: left })}
      </Typography>
      {/*
        The last press's failures, on the card itself (§430): the toast fades, and a picture that
        fails stays in the count above and is tried again on every press — the Administrator has
        to learn here that pressing again will not help, and what will.
      */}
      {lastFailed > 0 && (
        <Alert severity="warning" sx={{ mt: 1 }} data-testid="older-pictures-failed">
          {t(`tasks.olderPictures.failed.${countForm(lastFailed, locale)}`, { count: lastFailed })}{" "}
          <Link href="/admin/gallery/pictures">{t("tasks.olderPictures.failedLink")}</Link>
        </Alert>
      )}
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {t("tasks.olderPictures.address")}
      </Typography>
      <Box sx={{ mt: 1.5 }}>
        <ActionForm
          action={giveOlderPicturesLadderAction}
          messages={await refusalMessages()}
          confirm={{
            title: t("confirm.olderPicturesTitle"),
            body: t("confirm.olderPicturesBody"),
            confirmLabel: t(`tasks.olderPictures.button.${countForm(batch, locale)}`, { count: batch }),
            cancelLabel: words.cancel,
          }}
          scope="older-pictures"
          data-testid="older-pictures-form"
        >
          <input type="hidden" name="uiLocale" value={locale} />
          <GlyphSubmitButton
            label={t(`tasks.olderPictures.button.${countForm(batch, locale)}`, { count: batch })}
            pendingLabel={t("tasks.olderPictures.working")}
            icon="picture"
          />
        </ActionForm>
      </Box>
    </Panel>
  );
}
