import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { readCoHosts } from "@/modules/events/domain/co-hosts";
import Panel from "@/shared/ui/Panel";
import { coHostsSummary } from "../box-summaries";
import CoHostRowsEditor from "../CoHostRowsEditor";
import { type BoxProps, SettingsReadOnly, summaryWords } from "./box-kit";

/**
 * Box 12, "Parteneri — „Împreună cu”" (§168, §NNN): who holds the event with the club, a name and
 * a page each, any number of them — shown as "Împreună cu …" on the page and, when the bib's
 * footer asks for them, on the race number. An event saved before the list existed opens with the
 * one partner its two old columns hold, and the first save writes it as a list.
 *
 * Where the partners' cards go (`feat/partners-with-many-links`): the branch's own partner editor,
 * one sub-card per partner with its typed links, replaces the rows below — this box is its frame.
 */
export default async function CoHostsBox({ event, mayEditSettings, locale }: BoxProps & { locale: string }) {
  const t = await getTranslations("Admin");
  const { words } = await summaryWords();
  const coHostRows = readCoHosts(event ?? { coHosts: null, coHostName: null, coHostUrl: null }).map((host) => ({
    name: host.name,
    url: host.url ?? "",
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
            labels={{
              name: t("editor.coHostName"),
              url: t("editor.coHostUrl"),
              add: t("editor.coHostRows.add"),
              remove: t("editor.coHostRows.remove"),
            }}
          />
        </Stack>
      ) : (
        <SettingsReadOnly />
      )}
    </Panel>
  );
}
