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
import { orderGuideSections } from "@/modules/staff-identity/domain/guide-order";
import { requireStaff } from "@/modules/staff-identity/session";
import { BOXED_DISCLOSURE_SX } from "@/shared/ui/disclosure";

type Props = { params: Promise<{ locale: string }> };

export const dynamic = "force-dynamic";

/**
 * `roles`: whose section this is; the signed-in role's come first and open (§103). `key`: the one
 * section this page adds to, "family" (§389) — a last line while the flow is not switched on yet.
 * `tasks`: one job each, as numbered steps (§441) — "every task as numbered steps with the exact
 * button words", for the colleagues who run the backoffice while the owner is away.
 */
type GuideTask = { title: string; steps: string[] };
type GuideSection = { title: string; who: string; tasks: GuideTask[]; roles: StaffRole[]; key?: string };

/**
 * «Words like these» are the screen's own — a button, a tab, a card, a field — and are drawn
 * bold, so a reader looking at the screen finds them at a glance. `guide-words.test.ts` holds
 * every one of them to a string the backoffice actually shows, in each language.
 */
function withScreenWords(text: string) {
  return text.split(/(«[^»]+»)/).map((part, index) =>
    part.startsWith("«") && part.endsWith("»") ? (
      <Box component="strong" key={index} sx={{ fontWeight: 700 }}>
        {part}
      </Box>
    ) : (
      part
    ),
  );
}

/**
 * The platform, explained to the people who use it (BR-REQ-060-01 criteria 8 and 34): the first
 * steps, the desk, each role's jobs, then the participant's side of the same process. Every staff
 * session may read it — a guide that only the people who already know the platform can open is
 * not one — and it is text from the catalogue, so a wording correction is a catalogue edit and
 * never a deploy of code.
 */
export default async function GuidePage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const staffUser = await requireStaff();

  const t = await getTranslations("Admin");
  const all = t.raw("guide.sections") as GuideSection[];
  // The reader's own section first — the owner: "a how-to page depending on each role" — then
  // the colleagues' in the catalogue's order, folded. A stable partition, not a sort
  // (`orderGuideSections`, unit-tested per role).
  const sections = orderGuideSections(all, staffUser.role);
  const mine = sections.filter((section) => section.roles.includes(staffUser.role));
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
        Troubleshooting (§436): a save that fails only on an office laptop is the office network,
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
          {/*
            The section's jobs, each folded to its title: an open section reads as the list of
            what it covers, and one press shows that job's numbered steps.
          */}
          <Stack spacing={1}>
            {section.tasks.map((task, taskIndex) => (
              <Box key={taskIndex} component="details" sx={BOXED_DISCLOSURE_SX} data-testid="guide-task">
                <Typography component="summary" variant="body1" sx={{ fontWeight: 500 }}>
                  {task.title}
                </Typography>
                <Box component="ol" sx={{ m: 0, pl: 2.5, "& li": { mb: 0.75 } }}>
                  {task.steps.map((step, stepIndex) => (
                    <Typography component="li" variant="body1" key={stepIndex}>
                      {withScreenWords(fillIn(step, values))}
                    </Typography>
                  ))}
                </Box>
              </Box>
            ))}
            {section.key === "family" && !familyOpen && (
              <Typography variant="body2" color="text.secondary">
                {t("guide.familyPending")}
              </Typography>
            )}
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}
