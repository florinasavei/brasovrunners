import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { readEventErasurePlan } from "@/modules/content/events/repository";
import { canHardDeleteEvent } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import EraseEventForm from "./form";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export const dynamic = "force-dynamic";

/**
 * The hard delete: this event, **and everyone registered for it** (BR-REQ-037-06,
 * BR-REQ-060-01).
 *
 * ## Why this is a page and not a dialog
 *
 * Every other destructive verb in the backoffice is a button with a confirmation dialog, and a
 * dialog was wrong for this one for three separate reasons. A dialog cannot state the
 * consequence — "2 înscrieri, amândouă ale unor persoane reale, una confirmată" is four numbers
 * read from the database, not a sentence that fits in a `confirm()`. A dialog is JavaScript,
 * and the standing rule is that a form works without it. And a dialog has nowhere to put a
 * refusal: the typed title is the whole point of the control, so getting it wrong has to land
 * back on the same screen with the numbers still in front of the reader, not on a list with an
 * error code at the top.
 *
 * ## What actually protects the data
 *
 * Not this page. `hardDeleteEvent` asserts the role, compares the typed title, requires the
 * reason, writes the audit rows and runs the whole thing in one transaction; a request that
 * never rendered this page is refused exactly the same way (BR-REQ-060-01 criterion 4). The
 * `notFound()` below is a courtesy — a role that may not do this is not shown a screen
 * describing how — and the screen's real job is the paragraph above the form: saying, before
 * anything is pressed, precisely what is about to stop existing.
 */
export default async function EraseEventPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const staffUser = await requireStaff();
  if (!canHardDeleteEvent(staffUser.role)) notFound();

  const plan = await readEventErasurePlan(getDb(), id);
  if (!plan) notFound();

  const { error } = await searchParams;
  const t = await getTranslations("Admin");
  const format = await getFormatter();

  /**
   * The title the organizer is asked to type: the one in the language they are reading the
   * backoffice in, because that is the one on the screen in front of them. The service accepts
   * either language's title, so typing the other is not a refusal — but asking for a title the
   * reader cannot see would be. An unnamed draft has no title at all, and then the id is what
   * both this screen and the service use.
   */
  const expected =
    plan.titles.find((entry) => entry.locale === locale)?.title ?? plan.titles[0]?.title ?? plan.eventId;

  return (
    <Stack spacing={3} sx={{ maxWidth: 640 }}>
      <Typography variant="body2">
        <Link href={{ pathname: "/admin/events/[id]", params: { id } }}>{t("erase.backToEvent")}</Link>
      </Typography>

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
      </Box>

      <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
        {t("erase.title", { event: expected })}
      </Typography>

      {/*
        The consequence, before anything is pressed. Four numbers and the date, because "2
        registrations" is not a reason to stop and "2 registrations, both of them real people,
        one of them confirmed and expecting to run on 4 October" is.
      */}
      <Alert severity={plan.real > 0 ? "error" : "warning"} icon={false}>
        <Stack spacing={1}>
          <Typography variant="body2">
            {t("erase.whatGoes", {
              event: expected,
              date: format.dateTime(plan.startsAt, {
                day: "numeric",
                month: "long",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                hourCycle: "h23",
              }),
              count: plan.total,
            })}
          </Typography>
          {plan.total > 0 && (
            <Typography variant="body2">
              {t("erase.breakdown", { confirmed: plan.confirmed, real: plan.real, test: plan.test })}
            </Typography>
          )}
          <Typography variant="body2">
            {plan.real > 0 ? t("erase.realPeople", { count: plan.real }) : t("erase.noRealPeople")}
          </Typography>
        </Stack>
      </Alert>

      <Typography variant="body2" color="text.secondary">
        {t("erase.alternative")}
      </Typography>

      {/*
        No dialog, no checkbox: the confirmation *is* the typed title, and it is checked on the
        server. A tick the server does not read would be decoration (BR-REQ-060-01), and a
        dialog would put the numbers above out of sight at the moment of deciding. A refusal
        keeps the reason and asks for the title again (§315).
      */}
      <EraseEventForm locale={locale} eventId={plan.eventId} expected={expected} />
    </Stack>
  );
}
