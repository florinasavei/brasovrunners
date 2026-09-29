import LockIcon from "@mui/icons-material/Lock";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import ActionForm, { type ActionFormAction } from "@/shared/forms/ActionForm";
import RecallField, { RecallDetails } from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { confirmWords } from "@/shared/feedback/confirm-words";
import GlyphButton from "@/shared/ui/GlyphButton";
import { BOXED_DISCLOSURE_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import { HOLD_REASON_MAX } from "../declaration-hold";

/**
 * «Păstrează: reclamație / litigiu în curs» on one signed declaration (§NNN): the line that says it is
 * held — since when, by whom, why — for everybody who reads the declarations (the Organizer too), and,
 * for the Administrator, a closed fold (§336) with the reason and the one button that sets or clears
 * the hold, asking first (§384). The service decides; this screen only draws what it may.
 *
 * One component for both kinds — a registration's declaration and a group run's — so the words and
 * the behaviour cannot drift apart: the caller passes the action and the hidden fields that name the
 * row. Strings only across the boundary (the glyph by name, `GlyphButton`).
 */
export default async function DeclarationHoldForm({
  registrationAction,
  groupRunAction,
  hidden,
  held,
  mayManage,
  scope,
}: {
  /**
   * The Server Action that sets or clears the hold: a registration's declaration's, or a group run's
   * — one or the other. Two names rather than one `action`, so the §384 guard
   * (`tests/unit/shared/confirmed-actions.test.ts`) sees each action posted from a form that asks.
   */
  registrationAction?: ActionFormAction;
  groupRunAction?: ActionFormAction;
  /** The fields that name the row: `uiLocale`, and the registration and acceptance, or the event and declaration. */
  hidden: Readonly<Record<string, string>>;
  /** The hold as it stands, its instant already formatted by the page; null when the row is not held. */
  held: { when: string; who: string | null; reason: string } | null;
  mayManage: boolean;
  /** The form's own name for its refusal (`ActionForm`'s scope): one per row. */
  scope: string;
}) {
  const t = await getTranslations("Admin");
  const heldLine = held ? (
    <Typography variant="body2" color="warning.main" sx={{ fontWeight: 600 }} data-testid="declaration-held">
      {t("declarationHold.heldLine", { when: held.when, who: held.who ?? t("declarationHold.whoRemoved"), reason: held.reason })}
    </Typography>
  ) : null;
  if (!mayManage) return heldLine;

  const messages = await refusalMessages({ reason: t("declarationHold.reason") });
  const { cancel } = await confirmWords();
  const holding = held === null;
  // Asks first (§384): setting it stops the automatic deletion; clearing it starts it again.
  const confirm = {
    title: t(holding ? "declarationHold.holdTitle" : "declarationHold.releaseTitle"),
    body: t(holding ? "declarationHold.holdBody" : "declarationHold.releaseBody"),
    confirmLabel: t(holding ? "declarationHold.hold" : "declarationHold.release"),
    cancelLabel: cancel,
  };
  const fields = (
    <>
        {Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <input type="hidden" name="hold" value={holding ? "1" : "0"} />
        <RecallDetails sx={{ ...BOXED_DISCLOSURE_SX, mt: 1 }}>
          <Typography component="summary" variant="subtitle2">
            <LockIcon aria-hidden sx={FOLD_GLYPH_SX} />
            {t(holding ? "declarationHold.title" : "declarationHold.releaseFold")}
          </Typography>
          <Stack spacing={1.5} sx={{ pb: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              {t(holding ? "declarationHold.help" : "declarationHold.releaseHelp")}
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "flex-start" } }}>
              <RecallField
                name="reason"
                label={t("declarationHold.reason")}
                helperText={t(holding ? "declarationHold.reasonHelp" : "declarationHold.releaseReasonHelp")}
                required
                size="small"
                slotProps={{ htmlInput: { maxLength: HOLD_REASON_MAX } }}
                sx={{ flex: 1 }}
              />
              <Box>
                <GlyphButton icon={holding ? "hold" : "release"} type="submit" variant="outlined" color="warning" size="small" sx={{ minHeight: 44 }}>
                  {t(holding ? "declarationHold.hold" : "declarationHold.release")}
                </GlyphButton>
              </Box>
            </Stack>
          </Stack>
        </RecallDetails>
    </>
  );
  return (
    <Box>
      {heldLine}
      {registrationAction ? (
        <ActionForm action={registrationAction} messages={messages} confirm={confirm} scope={scope} data-testid="declaration-hold-form">
          {fields}
        </ActionForm>
      ) : groupRunAction ? (
        <ActionForm action={groupRunAction} messages={messages} confirm={confirm} scope={scope} data-testid="declaration-hold-form">
          {fields}
        </ActionForm>
      ) : null}
    </Box>
  );
}
