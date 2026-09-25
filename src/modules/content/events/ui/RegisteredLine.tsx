import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { countForm } from "@/i18n/count-form";
import GlyphButton from "@/shared/ui/GlyphButton";
import Hint from "@/shared/ui/Hint";

/**
 * The boxes a change in which reaches the people registered — the ones that wear the amber outline
 * (`Panel`'s `risk` tone, §350), in the order the editor draws them. Their own titles, so the
 * tooltip names them the way their headings do.
 */
export const MARKED_BOXES = ["when", "place", "registration", "programme", "status"] as const;

/**
 * "3 înscriși · o schimbare în cardurile cu margine portocalie ajunge la ei" — the registrants'
 * count, said once on the editor (§NNN; the owner, 2026-09-25: "informația «3 înscriși» se repetă
 * de prea multe ori pe fiecare card"). It stood as a chip on each of the five boxes a change
 * reaches (§350, §358); those boxes keep their amber outline — the mark — and this line, under the
 * page map, is the number. Its "?" names the marked cards; its button opens the registrations list
 * for this event, for a role that may read it (the list asserts that on the server too).
 *
 * The count is the one the chips used: the real registrations, every state — a test row is counted
 * nowhere the club looks (`AGENTS.md` §12.6, §30). None registered, no line, as no outline.
 *
 * A Server Component: the tooltip and the button are the backoffice's islands, handed strings and a
 * glyph's name only.
 */
export default async function RegisteredLine({ count, locale, registrationsHref }: { count: number; locale: string; registrationsHref: string | null }) {
  if (count <= 0) return null;
  const t = await getTranslations("Admin");
  const cards = MARKED_BOXES.map((box) => `– ${t(`editor.boxes.${box}.title`)}`);
  const tip = [t("editor.registered.cards"), ...cards].join("\n");

  return (
    <Box
      data-testid="registered-line"
      sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 1, borderLeft: 4, borderColor: "warning.main", pl: 1.25 }}
    >
      <Typography variant="body2" component="p" sx={{ m: 0 }}>
        <Box component="strong" data-testid="registered-count">
          {t(`editor.registered.count.${countForm(count, locale)}`, { count })}
        </Box>
        {` · ${t("editor.registered.reach")}`}
        <Hint text={tip} />
      </Typography>
      {registrationsHref && (
        <GlyphButton icon="registrations" href={registrationsHref} variant="text" size="small" sx={{ minHeight: 44 }}>
          {t("editor.registered.view")}
        </GlyphButton>
      )}
    </Box>
  );
}
