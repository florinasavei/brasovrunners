import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { EVENT_LINK_KINDS, type EventLinkKind, MAX_EVENT_LINKS, readEventLinks } from "@/modules/events/domain/links";
import { htmlConstraints, textFieldConstraints } from "@/shared/forms/constraints";
import RecallField from "@/shared/forms/recall";
import Panel from "@/shared/ui/Panel";
import { eventInputConstraints } from "../../constraints";
import { eventLinkRowSchema } from "../../fields";
import { linksSummary } from "../box-summaries";
import LinkRowsEditor from "../LinkRowsEditor";
import { type BoxProps, summaryWords } from "./box-kit";

/**
 * "Linkuri și fișiere" (§332, §406): its own card where the page draws `#links`. Links, never an
 * upload (`AGENTS.md` §17); with a route description the GPX and the map go to `#route` (§387).
 * Each row keeps its RO and EN labels side by side, not in tabs. Read-only roles see the heading
 * and line only (§358).
 */
export default async function LinksBox({ event, mayEditSettings, locale, heading }: BoxProps & { locale: string }) {
  const t = await getTranslations("Admin");
  const tEvent = await getTranslations("Event");
  const { words } = await summaryWords();
  const kindLabels = Object.fromEntries(EVENT_LINK_KINDS.map((kind) => [kind, tEvent(`links.kinds.${kind}`)])) as Record<EventLinkKind, string>;
  const card = { id: "box-links", glyph: "links", title: heading ?? t("editor.boxes.links.title"), aside: linksSummary(words, event, kindLabels, locale) } as const;
  if (!mayEditSettings) return <Panel {...card} />;

  const linkRows = readEventLinks(event?.links ?? null).map((link) => ({
    kind: link.kind,
    url: link.url,
    labelRo: link.labelRo ?? "",
    labelEn: link.labelEn ?? "",
  }));
  return (
    <Panel collapsible {...card}>
      <Stack spacing={2}>
        {/* The club's Strava group event for this occurrence (criterion 10). */}
        <RecallField
          name="event.stravaEventUrl"
          label={t("editor.stravaEventUrl")}
          helperText={t("editor.stravaEventUrlHelp")}
          defaultValue={event?.stravaEventUrl ?? ""}
          {...textFieldConstraints(eventInputConstraints("stravaEventUrl"), { inputMode: "url" })}
        />
        {/* The Facebook event for this occurrence (§144). */}
        <RecallField
          name="event.facebookEventUrl"
          label={t("editor.facebookEventUrl")}
          helperText={t("editor.facebookEventUrlHelp")}
          defaultValue={event?.facebookEventUrl ?? ""}
          {...textFieldConstraints(eventInputConstraints("facebookEventUrl"), { inputMode: "url" })}
        />
        <Typography variant="body2" color="text.secondary">
          {t("editor.linksHelp", { max: MAX_EVENT_LINKS })}
        </Typography>
        <LinkRowsEditor
          initial={linkRows}
          kindLabels={kindLabels}
          constraints={{
            url: htmlConstraints(eventLinkRowSchema.shape.url),
            label: htmlConstraints(eventLinkRowSchema.shape.labelRo),
          }}
          labels={{
            kind: t("editor.linkRows.kind"),
            url: t("editor.linkRows.url"),
            labelRo: t("editor.linkRows.labelRo"),
            labelEn: t("editor.linkRows.labelEn"),
            add: t("editor.linkRows.add"),
            remove: t("editor.linkRows.remove"),
            moveUp: t("editor.linkRows.moveUp"),
            moveDown: t("editor.linkRows.moveDown"),
            row: t("editor.linkRows.row"),
          }}
        />
      </Stack>
    </Panel>
  );
}
