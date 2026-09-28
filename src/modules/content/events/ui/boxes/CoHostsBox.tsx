import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { CO_HOST_LINK_KINDS, type CoHostLinkKind, readCoHosts } from "@/modules/events/domain/co-hosts";
import { htmlConstraints } from "@/shared/forms/constraints";
import Panel from "@/shared/ui/Panel";
import { coHostLinkRowSchema, coHostRowSchema } from "../../fields";
import { coHostsSummary } from "../box-summaries";
import CoHostRowsEditor from "../CoHostRowsEditor";
import { type BoxProps, SettingsReadOnly, summaryWords } from "./box-kit";

/**
 * "Parteneri — „Împreună cu”" (§168, §344, §350): one card per partner, the cards being
 * `CoHostRowsEditor`'s, this box only their frame. Rows are read through the one function that
 * knows every stored shape, so an event from any earlier release opens with its partner and the
 * next save writes it as a card. A half-written description (§352) opens as stored so it can be
 * completed; the save refuses it until it is.
 */
export default async function CoHostsBox({ event, mayEditSettings, locale, heading }: BoxProps & { locale: string }) {
  const t = await getTranslations("Admin");
  const tEvent = await getTranslations("Event");
  const tSite = await getTranslations("Site");
  const { words } = await summaryWords();
  const coHostRows = readCoHosts(event ?? { coHosts: null, coHostName: null, coHostUrl: null }).map((host) => ({
    name: host.name,
    descriptionRo: host.descriptionRo ?? "",
    descriptionEn: host.descriptionEn ?? "",
    links: host.links.map((link) => ({ kind: link.kind, url: link.url, labelRo: link.labelRo ?? "", labelEn: link.labelEn ?? "" })),
  }));
  return (
    <Panel glyph="partners" collapsible id="box-cohosts" title={heading ?? t("editor.boxes.coHosts.title")} aside={coHostsSummary(words, event, locale)}>
      {mayEditSettings ? (
        <Stack spacing={1.5}>
          <Typography variant="body2" color="text.secondary">
            {t("editor.boxes.coHosts.note")}
          </Typography>
          <CoHostRowsEditor
            initial={coHostRows}
            kindLabels={Object.fromEntries(CO_HOST_LINK_KINDS.map((kind) => [kind, tEvent(`coHostLinks.kinds.${kind}`)])) as Record<CoHostLinkKind, string>}
            constraints={{
              url: htmlConstraints(coHostLinkRowSchema.shape.url),
              label: htmlConstraints(coHostLinkRowSchema.shape.labelRo),
              description: htmlConstraints(coHostRowSchema.shape.descriptionRo),
            }}
            labels={{
              add: t("editor.coHostRows.add"),
              remove: t("editor.coHostRows.remove"),
              moveUp: t("editor.coHostRows.moveUp"),
              moveDown: t("editor.coHostRows.moveDown"),
              partnerNew: t("editor.coHostRows.partnerNew"),
              name: t("editor.coHostRows.name"),
              about: t("editor.coHostRows.about"),
              // Each language in its own words, as every Română | English tab names it.
              descriptionRo: tSite("languageName.ro"),
              descriptionEn: tSite("languageName.en"),
              descriptionHelp: t("editor.coHostRows.descriptionHelp"),
              identical: t("editor.identical.warning"),
              kind: t("editor.coHostRows.kind"),
              url: t("editor.coHostRows.url"),
              labelRo: t("editor.coHostRows.labelRo"),
              labelEn: t("editor.coHostRows.labelEn"),
              addLink: t("editor.coHostRows.addLink"),
              removeLink: t("editor.coHostRows.removeLink"),
              moveLinkUp: t("editor.coHostRows.moveLinkUp"),
              moveLinkDown: t("editor.coHostRows.moveLinkDown"),
              link: t("editor.coHostRows.link"),
              // The island fills in the card's number, so the placeholder travels as itself.
              ofPartner: t("editor.coHostRows.ofPartner", { p: "{p}" }),
            }}
          />
        </Stack>
      ) : (
        <SettingsReadOnly />
      )}
    </Panel>
  );
}
