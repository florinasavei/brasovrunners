import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { EVENT_SURFACES, EVENT_TYPES, takesRegistrations } from "@/modules/events/domain/event-type";
import RecallField from "@/shared/forms/recall";
import Panel from "@/shared/ui/Panel";
import { declarationSummary, type SummaryWords } from "../box-summaries";
import GroupRunDeclarationField from "../GroupRunDeclarationField";
import OnlyForMode from "../OnlyForMode";
import OnlyForType from "../OnlyForType";
import { BoxNote, type BoxProps } from "./box-kit";
import type { DeclarationOption } from "./RegistrationBox";

const SURFACES_WITH_TEXT = ["ASPHALT", "TRAIL"] as const;

/**
 * The card's closed line — «declarație pentru Trail», «fără declarație», «declarația v3» — and
 * whether a saved event that registers on the site lacks its declaration (the card and the rules
 * box open themselves then). Null text: the event asks for no declaration at all.
 */
export async function declarationLine(
  event: BoxProps["event"],
  declarations: readonly DeclarationOption[],
  words: SummaryWords,
): Promise<{ text: string | null; missing: boolean }> {
  const tEvent = await getTranslations("Event");
  const type = event?.type ?? "GROUP_RUN";
  const chosen = declarations.find((option) => option.id === event?.declarationDocumentId) ?? null;
  const surface = event?.surface ? tEvent(`surface.${event.surface}`) : null;
  const registers = takesRegistrations(type);
  return {
    text: declarationSummary(words, event, { takesRegistrations: registers, declarationVersion: chosen?.version ?? null, surface }),
    missing: event !== null && registers && event.registrationMode === "INTERNAL" && chosen === null,
  };
}

/**
 * «Declarația pe propria răspundere» (§448) — a named card inside «Regulamentul», the one place in
 * the editor where an organizer chooses what a runner signs (the owner, 2026-09-26: "declarația la
 * alergările de grup ar trebui să apară sub secțiunea «Regulament»; momentan nu văd unde selectez
 * declarația"). Both declarations were elsewhere: a group run's optional self-declaration was a
 * checkbox in «Traseul» (§393), a race's was a select in «Participare și înscrieri» → «Condiții de
 * participare» (§39, §350). They moved whole — the same names, so the service reads them as before.
 *
 * **A group run** (§393): the surface it reads from «Traseul», the checkbox, and which approved
 * text is in force for that surface — or that none is, and then the public button will not show.
 * **A type that takes registrations**, registering on the site: the approved version the
 * participant signs, the newest one named; registering elsewhere or not at all, one sentence — no
 * declaration is asked. Both follow the type and mode selects live (`OnlyForType`, `OnlyForMode`):
 * hidden, never removed, as every mode-dependent field is.
 *
 * Opens itself while a saved event that registers on the site has no declaration chosen: a
 * registration is refused without one (`AGENTS.md` §10.8). For a role that may only read the
 * settings, the card is its heading and its line.
 */
export default async function DeclarationCard({
  event,
  mayEditSettings,
  groupRunDeclarations,
  declarations,
  words,
}: Pick<BoxProps, "event" | "mayEditSettings" | "groupRunDeclarations"> & {
  declarations: readonly DeclarationOption[];
  words: SummaryWords;
}) {
  const t = await getTranslations("Admin");
  const tEvent = await getTranslations("Event");
  const initialType = event?.type ?? "GROUP_RUN";
  const initialMode = event?.registrationMode ?? "NONE";
  const inForce = groupRunDeclarations ?? { ASPHALT: null, TRAIL: null };
  const line = await declarationLine(event, declarations, words);
  const card = {
    id: "box-declaration",
    level: 3,
    title: t("editor.boxes.declaration.title"),
    aside: line.text ?? words.declaration.notAsked,
  } as const;
  const needsDeclaration = line.missing;
  if (!mayEditSettings) return <Panel {...card} />;

  const newest = declarations[0];
  return (
    <Panel collapsible {...card} openWhen={{ attention: needsDeclaration }}>
      <Stack spacing={2}>
        {/* A group run's optional self-declaration (§393): an island, it follows the type and the
            surface chosen in «Traseul». On by default for trail — the mountain rescue asks for it. */}
        <GroupRunDeclarationField
          initialType={initialType}
          initialSurface={event?.surface ?? ""}
          initialChecked={event?.offersGroupRunDeclaration ?? false}
          approved={{ ASPHALT: inForce.ASPHALT !== null, TRAIL: inForce.TRAIL !== null }}
          words={{
            label: t("editor.groupRunDeclaration.label"),
            help: t("editor.groupRunDeclaration.help"),
            notGroupSurface: t("editor.groupRunDeclaration.notGroupSurface"),
            missing: {
              ASPHALT: t("editor.groupRunDeclaration.missing", { document: t("legal.keys.GROUP_RUN_DECLARATION_ASPHALT") }),
              TRAIL: t("editor.groupRunDeclaration.missing", { document: t("legal.keys.GROUP_RUN_DECLARATION_TRAIL") }),
            },
            inForce: Object.fromEntries(
              SURFACES_WITH_TEXT.flatMap((surface) => {
                const approved = inForce[surface];
                if (approved === null) return [];
                const document = t(`legal.keys.GROUP_RUN_DECLARATION_${surface}`);
                return [[surface, t("editor.groupRunDeclaration.inForce", { surface: tEvent(`surface.${surface}`), document, version: approved.version })]];
              }),
            ),
            surfaceLines: Object.fromEntries([
              ["", t("editor.groupRunDeclaration.surface", { surface: t("editor.notStated") })],
              ...EVENT_SURFACES.map((surface) => [surface, t("editor.groupRunDeclaration.surface", { surface: tEvent(`surface.${surface}`) })]),
            ]),
          }}
        />

        {/* What a participant signs at confirmation (§39): a choice among approved versions, never
            an editor (`AGENTS.md` §11.1) — only while the event registers on the site. */}
        <OnlyForType type={EVENT_TYPES.filter(takesRegistrations)} selectName="event.type" initialType={initialType}>
          <OnlyForMode mode="INTERNAL" initialMode={initialMode}>
            <Stack spacing={1.5}>
              <RecallField
                select
                name="event.declarationDocumentId"
                label={t("editor.declarationDocument")}
                helperText={declarations.length === 0 ? t("editor.declarationNone") : t("editor.declarationDocumentHelp")}
                defaultValue={event?.declarationDocumentId ?? ""}
              >
                <MenuItem value="">{t("editor.declarationUnset")}</MenuItem>
                {declarations.map((document) => (
                  <MenuItem key={document.id} value={document.id}>
                    v{document.version} · {document.title}
                  </MenuItem>
                ))}
              </RecallField>
              {newest && (
                <Typography variant="body2" data-testid="race-declaration-newest">
                  {t("editor.boxes.declaration.newest", { version: newest.version, title: newest.title })}
                </Typography>
              )}
              <Typography variant="body2">
                <Link href="/admin/legal">{t("editor.boxes.conditions.legalLink")}</Link>
              </Typography>
            </Stack>
          </OnlyForMode>
          <OnlyForMode mode={["NONE", "EXTERNAL"]} initialMode={initialMode}>
            <BoxNote testId="declaration-not-asked">{t("editor.boxes.declaration.notOnSite")}</BoxNote>
          </OnlyForMode>
        </OnlyForType>
      </Stack>
    </Panel>
  );
}
