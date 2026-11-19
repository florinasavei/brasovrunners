import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { SIGNED_CONTRACT_MAX_BYTES } from "@/db/schema/event-volunteer-documents";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { formatBytes } from "@/modules/media/ui/stored-facts";
import ActionForm, { type ActionFormAction } from "@/shared/forms/ActionForm";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { SIGNED_CONTRACT_ACCEPT, SIGNED_CONTRACT_ANCHOR, SIGNED_CONTRACT_PART_BYTES } from "../domain/signed-contract";
import type { SignedContractFacts } from "../signed-contract";
import SignedContractUpload from "./SignedContractUpload";
import { signedContractMaxWords, signedContractUploadLabels } from "./signed-contract-words";
import { shortText } from "./VolunteerPerson";

/**
 * «Contract semnat» on a volunteer's page (§998, amending §758; the owner, 2026-11-19: «trebuie pentru fiecare voluntar să pot
 * atașa „contract semnat”»): the signed copy of the person's agreement, kept privately with their record.
 *
 * - **None yet:** the file box and «Încarcă» — a plain form posting multipart to the volunteer's route, so it works with scripts
 *   off; with scripts the island sends a large file in pieces and draws the page again.
 * - **One there:** its name, its length, when and by whom; «Descarcă» (the authenticated route, an attachment, never a public
 *   address), «Înlocuiește» (the same box: the new file takes the old one's place) and «Șterge», behind the house's question.
 *
 * An open card, never a fold: the upload with scripts off comes back here (`#contract-semnat`) and must find its form standing.
 * A presentation: the page reads the facts (`readSignedContract`) for whoever works the volunteers, and every press asks the role
 * again on the server (BR-REQ-060-01). The file's bytes never reach this component.
 */
export default async function SignedContractCard({
  locale,
  person,
  contract,
  returnTo,
  deleteAction,
}: {
  locale: string;
  person: { id: string; eventId: string; name: string };
  contract: SignedContractFacts | null;
  /** The person's own page: where «Șterge» comes back to — a path of the «Voluntari» screen, the only kind the action follows. */
  returnTo: string;
  deleteAction: ActionFormAction;
}) {
  const t = await getTranslations("Admin");
  const route = `/api/admin/events/${person.eventId}/volunteers/${person.id}/signed-contract`;
  const upload = (mode: "one" | "replace") => (
    <SignedContractUpload
      mode="one"
      action={route}
      locale={locale}
      maxBytes={SIGNED_CONTRACT_MAX_BYTES}
      partBytes={SIGNED_CONTRACT_PART_BYTES}
      accept={SIGNED_CONTRACT_ACCEPT}
      inputId={`signed-contract-${person.id}`}
      labels={signedContractUploadLabels(t, locale, mode)}
      testId="volunteer-contract-upload"
    />
  );
  const uploaded = contract ? formatDay(contract.uploadedAt, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true }) : "";

  return (
    <Panel glyph="declaration" level={3} title={t("volunteers.contract.title")} intro={t("volunteers.contract.intro", { max: signedContractMaxWords(locale) })} id={SIGNED_CONTRACT_ANCHOR} data-testid="volunteer-contract-card">
      {contract ? (
        <Stack spacing={1.5} sx={{ alignItems: "flex-start", minWidth: 0 }}>
          <Stack spacing={0.25} sx={{ minWidth: 0, maxWidth: "100%" }}>
            <Typography variant="body1" sx={{ fontWeight: 600, overflowWrap: "anywhere" }} data-testid="volunteer-contract-file">
              {contract.fileName}
            </Typography>
            <Typography variant="body2" color="text.secondary" data-testid="volunteer-contract-facts">
              {formatBytes(contract.size, locale)} ·{" "}
              {contract.uploadedByName ? t("volunteers.contract.uploadedBy", { when: uploaded, who: contract.uploadedByName }) : t("volunteers.contract.uploadedAt", { when: uploaded })}
            </Typography>
          </Stack>
          <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
            <GlyphButton
              icon="download"
              href={route}
              variant="contained"
              sx={TAP_TARGET}
              aria-label={t("volunteers.contract.downloadNamed", { name: shortText(person.name) })}
              data-testid="volunteer-contract-download"
            >
              {t("volunteers.contract.download")}
            </GlyphButton>
            <ActionForm
              action={deleteAction}
              confirm={{
                title: t("volunteers.contract.deleteTitle"),
                body: t("volunteers.contract.deleteBody", { name: shortText(person.name) }),
                confirmLabel: t("volunteers.contract.delete"),
                // The house's «Renunță», as every question's (`confirm-words.ts`); the delete sends no email, so none of its mail lines.
                cancelLabel: t("confirm.cancel"),
                destructive: true,
              }}
              data-testid="volunteer-contract-delete-form"
            >
              <input type="hidden" name="uiLocale" value={locale} />
              <input type="hidden" name="eventId" value={person.eventId} />
              <input type="hidden" name="volunteerId" value={person.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <GlyphSubmitButton label={t("volunteers.contract.delete")} pendingLabel={t("volunteers.contract.deleting")} icon="delete" color="error" variant="outlined" />
            </ActionForm>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {t("volunteers.contract.replaceHelp")}
          </Typography>
          {upload("replace")}
        </Stack>
      ) : (
        <Stack spacing={1.5} sx={{ alignItems: "flex-start", minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary" data-testid="volunteer-contract-none">
            {t("volunteers.contract.none")}
          </Typography>
          {upload("one")}
        </Stack>
      )}
    </Panel>
  );
}
