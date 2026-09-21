import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { findPageForEditor } from "@/modules/content/pages/repository";
import { describeIncompletePageLocales } from "@/modules/content/pages/service";
import PageFieldsForm from "@/modules/content/pages/ui/PageFieldsForm";
import {
  allowedTransitions,
  canEditEventFields,
  canEditTexts,
  canReadContent,
} from "@/modules/staff-identity/domain/roles";
import {
  EDITORIAL_STATUS_LABEL,
  EDITORIAL_TRANSITION_LABEL,
} from "@/modules/staff-identity/domain/staff-labels";
import { requireStaff } from "@/modules/staff-identity/session";
import ConfirmSubmitButton from "@/shared/ui/ConfirmSubmitButton";
import { deletePageAction, savePageAction, transitionPageAction } from "../actions";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
};

export const dynamic = "force-dynamic";

/**
 * One standing page: write it, publish it, delete it (BR-REQ-050-03).
 *
 * One form and one save, carrying the version it was loaded with, exactly as the event editor
 * does — a second organizer's save is a CONFLICT rather than an overwrite (`AGENTS.md` §11.5).
 * The transitions are separate forms because each carries its own destination, and they are
 * outside the editing form so a click on "publish" never submits an unsaved draft as a side
 * effect.
 */
export default async function EditPagePage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  /*
    Opened on **reading**, not on writing (§208, §222).

    This gate was `canEditTexts`, which is a set that deliberately excludes the Organizer
    (§207) — so the one role §208 was written for could see the pages list and could not open
    a single page on it. "Organizatorul vede cam tot (dar în readonly), practic Dani îi zice
    Amaliei să modifice X" is impossible if X cannot be read.

    Every control below asks its own question, and each asks the one its own Server Action
    asserts — which is the other half of the fix, because they did not.
  */
  if (!canReadContent(actor.role)) notFound();

  const found = await findPageForEditor(getDb(), id);
  if (!found) notFound();
  const { page, translations } = found;

  const { saved, error } = await searchParams;
  const t = await getTranslations("Admin");

  const isOwnDraft = translations.some((row) => row.authorStaffUserId === actor.id);
  const transitions = allowedTransitions(actor.role, page.editorialStatus, isOwnDraft);
  const incomplete = describeIncompletePageLocales(translations);
  /*
    Two questions, two capabilities, because the two actions assert different things (§222).

    One flag answered both and answered one of them wrongly: `savePage` asserts
    `canEditTexts` (service.ts) while this read `canEditEventFields`, which an Organizer has —
    so the day the screen opened for them they would have been shown the editor and refused on
    save. `deletePage` really does assert `canEditEventFields`, which is the wider of the two
    and is left exactly as it is.
  */
  const maySave = canEditTexts(actor.role);
  const mayDelete = canEditEventFields(actor.role);

  return (
    <Stack spacing={3}>
      <Typography variant="body2">
        <Link href="/admin/pages">{t("pages.backToList")}</Link>
      </Typography>

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {saved && <Alert severity="success">{t("saved")}</Alert>}
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
      </Box>

      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
        <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
          {translations.find((row) => row.locale === locale)?.title ?? t("pages.untitled")}
        </Typography>
        <Chip size="small" label={EDITORIAL_STATUS_LABEL[page.editorialStatus]} />
        <Chip size="small" variant="outlined" label={t("editor.version", { version: page.version })} />
      </Stack>

      {/*
        Said before the publish button rather than after it is pressed. Both languages go live
        together (§11.2), and "which half is missing" is the one thing an organizer needs in
        order to finish.
      */}
      {incomplete.length > 0 && (
        <Alert severity="info">
          {t("pages.incomplete", {
            detail: incomplete
              .map((entry) => `${entry.locale.toUpperCase()}: ${entry.missing.join(", ")}`)
              .join(" · "),
          })}
        </Alert>
      )}

      {transitions.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
          {transitions.map((to) => (
            <form action={transitionPageAction} key={to}>
              <input type="hidden" name="uiLocale" value={locale} />
              <input type="hidden" name="pageId" value={page.id} />
              <input type="hidden" name="expectedVersion" value={page.version} />
              <input type="hidden" name="to" value={to} />
              <Button type="submit" size="small" variant="outlined" sx={{ minHeight: 44 }}>
                {EDITORIAL_TRANSITION_LABEL[to]}
              </Button>
            </form>
          ))}
        </Stack>
      )}

      <Divider />

      {maySave ? (
        <form action={savePageAction}>
          <Stack spacing={3}>
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="pageId" value={page.id} />
            <input type="hidden" name="expectedVersion" value={page.version} />
            <PageFieldsForm
              navOrder={page.navOrder}
              translations={translations}
              slugLocked={page.publishedAt !== null}
            />
            <Box>
              <Button type="submit" variant="contained" sx={{ minHeight: 44 }}>
                {t("editor.save")}
              </Button>
            </Box>
          </Stack>
        </form>
      ) : (
        <Alert severity="info">{t("pages.readOnly")}</Alert>
      )}

      <Divider />

      {/*
        Deleting is permitted where deleting an event is not, and the difference is what hangs
        off it: an event carries somebody's registration, a page carries only what its author
        typed. Behind a confirmation all the same, because it cannot be undone.
      */}
      {mayDelete && (
        <Box>
          <form action={deletePageAction}>
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="pageId" value={page.id} />
            <ConfirmSubmitButton
              label={t("pages.delete")}
              title={t("pages.deleteTitle")}
              body={t("pages.deleteBody")}
              confirmLabel={t("pages.delete")}
              cancelLabel={t("confirm.cancel")}
            />
          </form>
        </Box>
      )}

      {/* A published page is reachable; a draft is not, so there is nothing to link to. */}
      {page.editorialStatus === "PUBLISHED" && (
        <Typography variant="body2">
          <Link
            href={{
              pathname: "/pages/[slug]",
              params: { slug: translations.find((row) => row.locale === locale)?.slug ?? "" },
            }}
          >
            {t("pages.viewPublic")}
          </Link>
        </Typography>
      )}
    </Stack>
  );
}
