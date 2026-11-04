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
 * «Pe site acum» under «Locuri» (§906; the owner, 2026-11-03: «cumva trebuie să pot controla mai bine»): one line
 * that says what a visitor meets on the event's page this minute — the button «Înscrie-te», the waiting list's
 * door with how full it is, or closed and why — read off `registrationCta`, the public card's own predicate
 * (`public-now.ts#readPublicDoor`), with a link to the editor's fold that changes it.
 *
 * Under it, «Înscrierile pe site sunt deschise»: for an Administrator a real tick and a save button that asks first
 * (§384), the action handed down only to him (`setPublicRegistrationOpenAction`, which asserts the role again), the
 * help under it saying what a press does from the state saved — untick to stop, tick to open again; for the Organizer,
 * the state in words, read-only. Only for an event registered on this site — elsewhere the tick means nothing.
 *
 * Shut by that tick, with the tick drawn right under it (the owner, 2026-11-04, of the line that named the tick and
 * linked to the editor above the same tick: one setting offered twice), the line says only «Pe site acum: înscrierile
 * sunt oprite.» and links nowhere. Every other answer — the dates, a full list, «Locurile libere le dau doar eu» —
 * keeps «Schimbă în editor», where those change, and so does the Organizer's line. A Server Component; the form is
 * the shared `ActionForm`.
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
  // The Administrator's tick is drawn below: the one setting that shut the door is right there, not in the editor.
  const tickDrawn = door.internal && publicDoorAction !== undefined;
  const stoppedByTick = tickDrawn && now.kind === "CLOSED" && now.reason === "SWITCH";
  const sentence = stoppedByTick
    ? t("registrations.publicNow.stopped")
    : now.kind === "DIRECT"
      ? t("registrations.publicNow.direct")
      : now.kind === "WAITLIST"
        ? now.limit === null
          ? t("registrations.publicNow.waitlistUnlimited", { waiting: now.waiting })
          : t(`registrations.publicNow.waitlistLimited.${countForm(now.limit, locale)}`, { waiting: now.waiting, limit: now.limit })
        : t("registrations.publicNow.closed", { reason: t(`registrations.publicNow.reasons.${now.reason}`) });
  const editor = stoppedByTick ? null : `${getPathname({ locale, href: { pathname: "/admin/events/[id]", params: { id: eventId } } })}#${publicNowSetting(now)}`;
  // The dialog's «Renunță» only where the form is drawn: the Organizer's read-only line reads nothing more.
  const cancel = publicDoorAction ? (await confirmWords()).cancel : "";

  return (
    <Box data-testid="registrations-public-now" sx={{ mt: spaceAbove }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={{ xs: 0.5, sm: 1 }} sx={{ alignItems: { sm: "center" } }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }} data-testid="registrations-public-now-line">
          {sentence}
        </Typography>
        {editor && (
          <GlyphButton icon="edit" href={editor} variant="text" size="small" sx={{ minHeight: 44, alignSelf: { xs: "flex-start", sm: "center" } }} data-testid="registrations-public-now-setting">
            {t("registrations.publicNow.setting")}
          </GlyphButton>
        )}
      </Stack>
      {/*
        «Locuri păstrate pentru club» (§914): the page reads full while kept places are left — said only then (the door open by
        its dates and tick, no place of the site's own free), so it is never said beside a door closed for another reason.
      */}
      {(door.keptFree ?? 0) > 0 && (
        <Typography variant="body2" color="text.secondary" data-testid="registrations-public-now-kept">
          {t(`registrations.publicNow.keptLeft.${countForm(door.keptFree ?? 0, locale)}`, { count: door.keptFree ?? 0 })}
        </Typography>
      )}
      {/* «Locurile libere le dau doar eu» (§906): nothing goes out by itself either, whatever «Da» says — said here, where he looks. */}
      {door.offersOnly && (
        <Typography variant="body2" color="text.secondary" data-testid="registrations-public-now-offers-only">
          {t("registrations.publicNow.offersOnly")}
        </Typography>
      )}
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
            {/* What a press does from the state saved: the tick is drawn as the row stands. */}
            <Typography variant="body2" color="text.secondary" data-testid="registrations-public-door-help">
              {door.open ? t("registrations.publicDoor.helpOpen") : t("registrations.publicDoor.helpStopped")}
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
