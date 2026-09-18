import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { requireStaff } from "@/modules/staff-identity/session";

type Props = { params: Promise<{ locale: string }> };

export const dynamic = "force-dynamic";

type GuideSection = { title: string; who: string; steps: string[] };

/**
 * The platform, explained to the people who use it (BR-REQ-060-01 criterion 6): the volunteer
 * with a phone first, then the participant's side of the same process, then organizers and
 * administrators. Every staff session may read it — a guide that only the people who already
 * know the platform can open is not one — and it is text from the catalogue, so a wording
 * correction is a catalogue edit and never a deploy of code.
 */
export default async function GuidePage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await requireStaff();

  const t = await getTranslations("Admin");
  const sections = t.raw("guide.sections") as GuideSection[];

  return (
    <Stack spacing={3}>
      <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
        {t("guide.title")}
      </Typography>
      <Typography color="text.secondary">{t("guide.intro")}</Typography>
      {/* What participants receive, message by message (§91). */}
      <Typography variant="body2">
        <Link href="/admin/emails">{t("emails.link")}</Link>
      </Typography>
      {sections.map((section, index) => (
        <Box
          key={index}
          component="details"
          open={index === 0}
          sx={{
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            px: 2,
            "& > summary": { cursor: "pointer", py: 1.5, listStyle: "revert" },
          }}
        >
          <Typography component="summary" variant="subtitle1" sx={{ fontWeight: 600 }}>
            {section.title}
            <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
              {section.who}
            </Typography>
          </Typography>
          <Box component="ol" sx={{ m: 0, mb: 1.5, pl: 2.5, "& li": { mb: 0.75 } }}>
            {section.steps.map((step, stepIndex) => (
              <Typography component="li" variant="body1" key={stepIndex}>
                {step}
              </Typography>
            ))}
          </Box>
        </Box>
      ))}
    </Stack>
  );
}
