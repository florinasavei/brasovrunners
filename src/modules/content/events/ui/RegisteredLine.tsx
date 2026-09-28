import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { countForm } from "@/i18n/count-form";
import GlyphButton from "@/shared/ui/GlyphButton";
import Hint from "@/shared/ui/Hint";

/** The boxes whose changes reach the registered — the amber-outlined ones (§350), in editor order. */
export const MARKED_BOXES = ["when", "place", "registration", "programme", "status"] as const;

/**
 * "3 înscriși · …" — the registrants' count, said once under the page map (§408) rather than on
 * each amber-outlined card. Real registrations only, every state; test rows are counted nowhere
 * the club looks (`AGENTS.md` §12.6, §30). None registered, no line.
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
