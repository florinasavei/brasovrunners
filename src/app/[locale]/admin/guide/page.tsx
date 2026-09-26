import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { deadlineWords } from "@/modules/deadlines/domain/duration-words";
import { deadlinesForThisRequest } from "@/modules/deadlines/request";
import { getDb } from "@/db/client";
import { countForm } from "@/i18n/count-form";
import { readAddressCap } from "@/modules/registrations/address-cap";
import { familyRegistrationOpen } from "@/modules/registrations/family-gate";
import { fillIn } from "@/shared/forms/fill-in";
import { STAFF_ROLE_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { BOXED_DISCLOSURE_SX } from "@/shared/ui/disclosure";

type Props = { params: Promise<{ locale: string }> };

export const dynamic = "force-dynamic";

/**
 * `roles`: whose section this is; the signed-in role's come first and open (§103). `key`: the one
 * section this page adds to, "family" (§389) — a last line while the flow is not switched on yet.
 */
type GuideSection = { title: string; who: string; steps: string[]; roles: StaffRole[]; key?: string };

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
  const staffUser = await requireStaff();

  const t = await getTranslations("Admin");
  const all = t.raw("guide.sections") as GuideSection[];
  // The reader's own section first — the owner: "a how-to page depending on each role" — then
  // the colleagues' in the catalogue's order, folded. A stable partition, not a sort.
  const mine = all.filter((section) => section.roles.includes(staffUser.role));
  const others = all.filter((section) => !section.roles.includes(staffUser.role));
  const sections = [...mine, ...others];
  /*
    The deadlines the steps name — "{hold}", "{offer}", "{checkin}" — are the club's (§377), filled
    into the catalogue's raw lines here, since `t.raw` hands the sentences over unformatted.
  */
  const words = deadlineWords(locale, await deadlinesForThisRequest());
  /*
    "A family on one address" (§389) states the club's limit per address as the setting says it —
    never a literal — and says, while the schema still keeps one registration per address
    (`family-gate.ts`), that the flow is not switched on yet.
  */
  const db = getDb();
  const [{ cap }, familyOpen] = await Promise.all([readAddressCap(db), familyRegistrationOpen(db)]);
  const people = t(`emails.addressCap.people.${countForm(cap.registrationsPerAddress, locale)}`, { count: cap.registrationsPerAddress });
  const values = { confirmation: words.confirmation, hold: words.hold, offer: words.offer, checkin: words.checkin, horizon: words.horizon, people };
  const stepsOf = (section: GuideSection) =>
    section.key === "family" && !familyOpen ? [...section.steps, t("guide.familyPending")] : section.steps;

  return (
    <Stack spacing={3}>
      <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
        {t("guide.title")}
      </Typography>
      <Typography color="text.secondary">{t("guide.intro")}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        {t("guide.yours", { role: STAFF_ROLE_LABEL[staffUser.role] })}
      </Typography>
      {/*
        What participants receive, message by message (§91) — straight into the fold that holds
        the previews, or the link lands on five closed summaries and explains nothing.
      */}
      <Typography variant="body2">
        <Link href={{ pathname: "/admin/emails", hash: "participant-emails" }}>{t("emails.link")}</Link>
      </Typography>
      {/*
        Troubleshooting (§NNN): a save that fails only on an office laptop is the office network,
        and the check names what to ask IT to allow.
      */}
      <Typography variant="body2" data-testid="guide-network">
        {t("guide.network")} <Link href="/admin/network">{t("guide.networkLink")}</Link>
      </Typography>
      {sections.map((section, index) => (
        <Box key={index} component="details" open={index < Math.max(1, mine.length)} sx={BOXED_DISCLOSURE_SX}>
          <Typography component="summary" variant="subtitle1" sx={{ fontWeight: 600 }}>
            {section.title}
            <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
              {section.who}
            </Typography>
          </Typography>
          <Box component="ol" sx={{ m: 0, pl: 2.5, "& li": { mb: 0.75 } }}>
            {stepsOf(section).map((step, stepIndex) => (
              <Typography component="li" variant="body1" key={stepIndex}>
                {fillIn(step, values)}
              </Typography>
            ))}
          </Box>
        </Box>
      ))}
    </Stack>
  );
}
