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
  /** The last press's failures (`?failed=`); 0 says nothing. */
  lastFailed: number;
};

/**
 * §430's one-off button on the task board: pre-§414 pictures get their ladder, a batch per press,
 * confirmed first (§384). One total, not per kind: the decision is the same (§430). The page and
 * the service both assert the role (BR-REQ-060-01).
 */
export default async function OlderPicturesPanel({ locale, left, lastFailed }: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const batch = Math.min(left, OLDER_PICTURES_PER_PRESS);

  return (
    <Panel glyph="pictures"
      id="older-pictures"
      title={t("tasks.olderPictures.title")}
      intro={t("tasks.olderPictures.intro", { perPress: OLDER_PICTURES_PER_PRESS })}
      introMore={t("tasks.olderPictures.introMore")}
      data-testid="older-pictures"
    >
      <Typography variant="body2" sx={{ fontWeight: 500 }} data-testid="older-pictures-left">
        {t(`tasks.olderPictures.left.${countForm(left, locale)}`, { count: left })}
      </Typography>
      {/* On the card, not only in the fading toast: pressing again will not help these (§430). */}
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
