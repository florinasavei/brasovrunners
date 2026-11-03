import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { countForm } from "@/i18n/count-form";
import { getPathname } from "@/i18n/navigation";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm, { type ActionFormAction } from "@/shared/forms/ActionForm";
import CheckboxField from "@/shared/ui/CheckboxField";
import GlyphButton from "@/shared/ui/GlyphButton";
import { publicNowSetting } from "../domain/public-now";
import type { PublicDoor } from "../public-now";

/**
 * «Pe site acum» under «Locuri» (§NNN; the owner, 2026-11-03: «cumva trebuie să pot controla mai bine»): one line
 * that says what a visitor meets on the event's page this minute — the button «Înscrie-te», the waiting list's
 * door with how full it is, or closed and why — read off `registrationCta`, the public card's own predicate
 * (`public-now.ts#readPublicDoor`), with a link to the editor's fold that changes it.
 *
 * Under it, «Înscrieri publice deschise»: for an Administrator a real tick and a save button that asks first
 * (§384), the action handed down only to him (`setPublicRegistrationOpenAction`, which asserts the role again);
 * for the Organizer, the state in words, read-only. Only for an event registered on this site — elsewhere the
 * tick means nothing. A Server Component; the form is the shared `ActionForm`.
 */
export default async function PublicNowLine({
  door,
  eventId,
  locale,
  publicDoorAction,
  listQuery,
  spaceAbove = 0,
}: {
  door: PublicDoor;
  eventId: string;
  locale: string;
  /** The Administrator's save; absent, the tick is said, not offered. */
  publicDoorAction?: ActionFormAction;
  /** The list's own query, so the press comes back to the same list. */
  listQuery: string;
  spaceAbove?: number;
}) {
  const t = await getTranslations("Admin");
  const { now } = door;
  const sentence =
    now.kind === "DIRECT"
      ? t("registrations.publicNow.direct")
      : now.kind === "WAITLIST"
        ? now.limit === null
          ? t("registrations.publicNow.waitlistUnlimited", { waiting: now.waiting })
          : t(`registrations.publicNow.waitlistLimited.${countForm(now.limit, locale)}`, { waiting: now.waiting, limit: now.limit })
        : t("registrations.publicNow.closed", { reason: t(`registrations.publicNow.reasons.${now.reason}`) });
  const editor = `${getPathname({ locale, href: { pathname: "/admin/events/[id]", params: { id: eventId } } })}#${publicNowSetting(now)}`;
  // The dialog's «Renunță» only where the form is drawn: the Organizer's read-only line reads nothing more.
  const cancel = publicDoorAction ? (await confirmWords()).cancel : "";

  return (
    <Box data-testid="registrations-public-now" sx={{ mt: spaceAbove }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={{ xs: 0.5, sm: 1 }} sx={{ alignItems: { sm: "center" } }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }} data-testid="registrations-public-now-line">
          {sentence}
        </Typography>
        <GlyphButton icon="edit" href={editor} variant="text" size="small" sx={{ minHeight: 44, alignSelf: { xs: "flex-start", sm: "center" } }} data-testid="registrations-public-now-setting">
          {t("registrations.publicNow.setting")}
        </GlyphButton>
      </Stack>
      {door.internal &&
        (publicDoorAction ? (
          <ActionForm
            action={publicDoorAction}
            scope="public-door"
            confirm={[
              {
                when: [{ field: "publicRegistrationOpen", notEquals: "on" }],
                title: t("confirm.publicDoorCloseTitle"),
                body: t("confirm.publicDoorCloseBody"),
                confirmLabel: t("confirm.publicDoorCloseConfirm"),
                cancelLabel: cancel,
              },
              {
                when: [{ field: "publicRegistrationOpen", equals: "on" }],
                title: t("confirm.publicDoorOpenTitle"),
                body: t("confirm.publicDoorOpenBody"),
                confirmLabel: t("confirm.publicDoorOpenConfirm"),
                cancelLabel: cancel,
              },
            ]}
            data-testid="registrations-public-door-form"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="eventId" value={eventId} />
            <input type="hidden" name="listQuery" value={listQuery} />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { xs: "flex-start", sm: "center" }, mt: 0.5 }}>
              <CheckboxField name="publicRegistrationOpen" defaultChecked={door.open}>
                {t("registrations.publicDoor.label")}
              </CheckboxField>
              <GlyphButton icon="save" type="submit" variant="outlined" size="small" sx={{ minHeight: 44 }} data-testid="registrations-public-door-save">
                {t("registrations.publicDoor.save")}
              </GlyphButton>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {t("registrations.publicDoor.help")}
            </Typography>
          </ActionForm>
        ) : (
          <Typography variant="body2" color="text.secondary" data-testid="registrations-public-door-state">
            {door.open ? t("registrations.publicDoor.readOnlyOn") : t("registrations.publicDoor.readOnlyOff")}
          </Typography>
        ))}
    </Box>
  );
}
