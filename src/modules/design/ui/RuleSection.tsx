import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import { getTranslations } from "next-intl/server";
import { DESIGN_RULES } from "../rules";
import DesignSection, { Code } from "./section";

/**
 * «Reguli» (§NNN): the rules that bite when the look is touched, each with where it lives — the
 * file, the test or the check — as a path in `code`, never a link: nothing here points off the
 * site. The sentences are the catalogue's (`design.rules.items.<id>`), the paths `rules.ts`'s: a
 * screen's words never name a repository path (§511), so the paths are code, read beside the words.
 */
export default async function RuleSection() {
  const t = await getTranslations("Admin");

  return (
    <DesignSection id="rules" title={t("design.sections.rules")} intro={t("design.rules.intro")}>
      <Table size="small" aria-label={t("design.sections.rules")} data-testid="design-rules">
        <TableHead>
          <TableRow>
            <TableCell>{t("design.rules.rule")}</TableCell>
            <TableCell>{t("design.rules.where")}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {DESIGN_RULES.map((rule) => (
            <TableRow key={rule.id} data-rule={rule.id}>
              <TableCell sx={{ verticalAlign: "top" }}>{t(`design.rules.items.${rule.id}`)}</TableCell>
              <TableCell sx={{ verticalAlign: "top", whiteSpace: "normal" }}>
                {rule.where.map((path, index) => (
                  <span key={path}>
                    {index > 0 && " · "}
                    <Code>{path}</Code>
                  </span>
                ))}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DesignSection>
  );
}
