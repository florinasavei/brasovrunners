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
 * Box 12, "Parteneri — „Împreună cu”" (§168, §344, §350 the editor re-layout): who holds the
 * event with the club, **one card per partner** inside this box — its name and its own typed
 * links (its site, its event, registering with it, its socials) — shown as "Împreună cu …" on the
 * page and, when the bib's footer asks for them, on the race number.
 *
 * The cards are `CoHostRowsEditor`'s own (§344): this box is their frame and nothing else, so the
 * names they post (`event.coHosts[p].name`, `event.coHosts[p].links[l].<box>`), the refusal that
 * names a partner and a link by number, and the recall after a refused save are exactly the ones
 * the partner cards were built with. The rows are read through the one function that decides which
 * shape a stored row means — its list of links, its one legacy link, or the two columns before the
 * list — so an event saved by any earlier release opens with the partner it has, and the first
 * save writes it as a card. The description (§352) opens as stored, both languages or one: a half
 * written somewhere else is shown so it can be completed, and the save refuses it until it is.
 */
export default async function CoHostsBox({ event, mayEditSettings, locale }: BoxProps & { locale: string }) {
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
    <Panel collapsible id="box-cohosts" title={t("editor.boxes.coHosts.title")} aside={coHostsSummary(words, event, locale)}>
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
              // Each language in its own words, as every Română | English tab on this page names it.
              descriptionRo: tSite("languageName.ro"),
              descriptionEn: tSite("languageName.en"),
              descriptionHelp: t("editor.coHostRows.descriptionHelp"),
              kind: t("editor.coHostRows.kind"),
              url: t("editor.coHostRows.url"),
              labelRo: t("editor.coHostRows.labelRo"),
              labelEn: t("editor.coHostRows.labelEn"),
              addLink: t("editor.coHostRows.addLink"),
              removeLink: t("editor.coHostRows.removeLink"),
              moveLinkUp: t("editor.coHostRows.moveLinkUp"),
              moveLinkDown: t("editor.coHostRows.moveLinkDown"),
              link: t("editor.coHostRows.link"),
              // The card's number is the island's to fill in, so the placeholder travels as itself.
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
