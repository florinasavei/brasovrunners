import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import TaskAltIcon from "@mui/icons-material/TaskAlt";
import CheckBoxIcon from "@mui/icons-material/CheckBox";
import CheckBoxOutlineBlankIcon from "@mui/icons-material/CheckBoxOutlineBlank";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import {
  addClubTodoAction,
  deleteClubTodoAction,
  editClubTodoAction,
  moveClubTodoAction,
  setClubTodoDoneAction,
} from "@/app/[locale]/admin/tasks/actions";
import { CLUB_TIME_ZONE, formatCalendarDay, formatDay } from "@/i18n/dates";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  CLUB_TODO_OWNER_MAX,
  CLUB_TODO_TEXT_MAX,
  type ClubTodoItem,
  clubTodoOwners,
  filterClubTodo,
  isClubTodoOverdue,
} from "@/modules/club-todo/domain/club-todo";
import { CLUB_TODO_OWNER_SUGGESTIONS, clubTodoDefaultView } from "@/modules/club-todo/domain/starting-list";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import DateField from "@/shared/forms/pickers/DateField";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import GlyphButtonLink from "@/shared/ui/GlyphButtonLink";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import SubmitButton from "@/shared/ui/SubmitButton";
import { BOXED_DISCLOSURE_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";

type Props = {
  locale: Locale;
  /** The whole list; the panel filters it. */
  items: readonly ClubTodoItem[];
  /** `canEditClubTodo`; `changeClubTodo` asserts it again. */
  mayEdit: boolean;
  /** From `?for=`; undefined for everybody. */
  owner: string | undefined;
  /** `YYYY-MM-DD` on the club's calendar, for "overdue". */
  today: string;
  /** `?error=`, already translated. */
  error?: string;
};

const OWNERS_LIST_ID = "club-todo-owners";

/** Short accessible names, not a paragraph read aloud. */
function shortText(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
}

/**
 * «De făcut» (§438): one form per button, so it works without JavaScript (§265); the role is
 * decided by `changeClubTodo`, not by what this draws (BR-REQ-060-01). Open lines first, done ones
 * in a closed fold; «Șterge» asks first (§384); folds start closed (§336).
 */
export default async function ClubTodoPanel({ locale, items, mayEdit, owner, today, error }: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();

  const shown = filterClubTodo(items, owner);
  const open = shown.filter((item) => !item.done);
  const done = shown.filter((item) => item.done);
  const owners = clubTodoOwners(items);
  // Suggestions first, then every other name on the list.
  const suggestions = [...new Set([...CLUB_TODO_OWNER_SUGGESTIONS, ...owners])];

  const hrefFor = (who: string | undefined) =>
    getPathname({ locale, href: { pathname: "/admin/tasks", query: { panel: "todo", ...(who ? { for: who } : {}) } } });

  /** Every form's hidden fields: the locale and the filter. */
  const context = (
    <>
      <input type="hidden" name="uiLocale" value={locale} />
      {owner && <input type="hidden" name="for" value={owner} />}
    </>
  );

  const fields = (item: ClubTodoItem | null) => (
    <Stack spacing={1.5} sx={{ maxWidth: 640 }}>
      <RecallField
        name="text"
        label={t("clubTodo.field.text")}
        helperText={t("clubTodo.field.textHelp")}
        defaultValue={item?.text ?? ""}
        required
        multiline
        minRows={2}
        size="small"
        slotProps={{ htmlInput: { maxLength: CLUB_TODO_TEXT_MAX } }}
      />
      <RecallField
        name="owner"
        label={t("clubTodo.field.owner")}
        helperText={t("clubTodo.field.ownerHelp")}
        defaultValue={item?.owner ?? (item === null ? owner ?? "" : "")}
        size="small"
        autoComplete="off"
        slotProps={{ htmlInput: { list: OWNERS_LIST_ID, maxLength: CLUB_TODO_OWNER_MAX } }}
      />
      <DateField
        name="due"
        label={t("clubTodo.field.due")}
        helperText={t("clubTodo.field.dueHelp")}
        defaultValue={item?.due ?? ""}
        size="small"
      />
    </Stack>
  );

  const row = (item: ClubTodoItem, index: number, siblings: readonly ClubTodoItem[]) => {
    const overdue = isClubTodoOverdue(item, today);
    // §538.
    const view = clubTodoDefaultView(item, locale);
    const text = view?.text ?? item.text;
    const label = shortText(text);
    return (
      <Box
        component="li"
        key={item.id}
        data-testid="club-todo-item"
        data-item-id={item.id}
        sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
          {mayEdit ? (
            <Box component="form" action={setClubTodoDoneAction} sx={{ flexShrink: 0 }}>
              {context}
              <input type="hidden" name="itemId" value={item.id} />
              <input type="hidden" name="done" value={item.done ? "0" : "1"} />
              {/* One 44-px button: a tick is one press on a phone. */}
              <Box
                component="button"
                type="submit"
                aria-label={t(item.done ? "clubTodo.untick" : "clubTodo.tick", { text: label })}
                sx={{
                  width: 44,
                  height: 44,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: 0,
                  borderRadius: 1,
                  bgcolor: "transparent",
                  color: item.done ? "success.main" : "primary.main",
                  cursor: "pointer",
                  "&:hover": { bgcolor: "action.hover" },
                  "&:focus-visible": { outline: 2, outlineStyle: "solid", outlineColor: "primary.main", outlineOffset: -2 },
                }}
              >
                {item.done ? <CheckBoxIcon aria-hidden /> : <CheckBoxOutlineBlankIcon aria-hidden />}
              </Box>
            </Box>
          ) : (
            <Box sx={{ width: 44, height: 44, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "text.secondary" }}>
              {item.done ? <CheckBoxIcon aria-hidden /> : <CheckBoxOutlineBlankIcon aria-hidden />}
            </Box>
          )}

          <Box sx={{ flex: 1, minWidth: 0, pt: 1.25 }}>
            <Typography
              variant="body2"
              sx={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                ...(item.done ? { textDecoration: "line-through", color: "text.secondary" } : {}),
              }}
            >
              {text}
            </Typography>
            {view && !item.done && (
              <Box sx={{ mt: 0.75 }}>
                <GlyphButtonLink href={view.href} icon="edit" variant="outlined" size="small" sx={{ minHeight: 44 }} data-testid="club-todo-link">
                  {view.link}
                </GlyphButtonLink>
              </Box>
            )}
            {(item.owner || item.due || item.done) && (
              <Stack direction="row" sx={{ mt: 0.75, flexWrap: "wrap", gap: 0.75, alignItems: "center" }}>
                {item.owner && <Chip size="small" variant="outlined" label={t("clubTodo.owner", { owner: item.owner })} />}
                {item.due && (
                  <Chip
                    size="small"
                    variant={overdue ? "filled" : "outlined"}
                    color={overdue ? "error" : "default"}
                    label={t(overdue ? "clubTodo.overdue" : "clubTodo.due", {
                      day: formatCalendarDay(item.due, { locale, style: "short", position: "inline" }),
                    })}
                  />
                )}
                {item.done && item.doneAt && (
                  <Typography variant="caption" color="text.secondary">
                    {t("clubTodo.doneBy", {
                      by: item.by ?? "—",
                      when: formatDay(new Date(item.doneAt), { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" }),
                    })}
                  </Typography>
                )}
              </Stack>
            )}
          </Box>

          {/* No arrow at an end rather than one that does nothing. */}
          {mayEdit && !item.done && (
            <Stack spacing={0.5} sx={{ flexShrink: 0 }}>
              {index > 0 && (
                <Box component="form" action={moveClubTodoAction}>
                  {context}
                  <input type="hidden" name="itemId" value={item.id} />
                  <input type="hidden" name="direction" value="up" />
                  <SubmitButton label="↑" pendingLabel="↑" variant="outlined" ariaLabel={t("clubTodo.moveUp", { text: label })} />
                </Box>
              )}
              {index < siblings.length - 1 && (
                <Box component="form" action={moveClubTodoAction}>
                  {context}
                  <input type="hidden" name="itemId" value={item.id} />
                  <input type="hidden" name="direction" value="down" />
                  <SubmitButton label="↓" pendingLabel="↓" variant="outlined" ariaLabel={t("clubTodo.moveDown", { text: label })} />
                </Box>
              )}
            </Stack>
          )}
        </Stack>

        {mayEdit && (
          <Box component="details" sx={{ ...BOXED_DISCLOSURE_SX, mt: 1 }}>
            <Box component="summary" sx={{ fontSize: "0.875rem", fontWeight: 500 }}>
              <EditIcon aria-hidden sx={FOLD_GLYPH_SX} />
              {t("clubTodo.edit")}
            </Box>
            <Stack spacing={1.5} sx={{ pb: 1.5 }}>
              <ActionForm action={editClubTodoAction} scope={`todo-${item.id}`}>
                {context}
                <input type="hidden" name="itemId" value={item.id} />
                {fields(item)}
                <Box sx={{ mt: 1.5 }}>
                  <GlyphSubmitButton label={t("clubTodo.save")} pendingLabel={t("clubTodo.saving")} icon="save" />
                </Box>
              </ActionForm>
              <ActionForm
                action={deleteClubTodoAction}
                confirm={{
                  title: t("clubTodo.deleteTitle"),
                  body: t("clubTodo.deleteBody", { text: label }),
                  confirmLabel: t("clubTodo.delete"),
                  cancelLabel: words.cancel,
                  destructive: true,
                }}
              >
                {context}
                <input type="hidden" name="itemId" value={item.id} />
                <GlyphSubmitButton label={t("clubTodo.delete")} pendingLabel={t("clubTodo.deleting")} icon="delete" color="error" variant="outlined" />
              </ActionForm>
            </Stack>
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Stack spacing={2} component="section" id="club-todo" aria-label={t("clubTodo.title")} sx={{ scrollMarginTop: 16 }}>
      <Typography variant="body2" color="text.secondary">
        {t("clubTodo.intro")}
      </Typography>
      {!mayEdit && <Alert severity="info">{t("clubTodo.readOnly")}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}

      <Typography variant="body1" sx={{ fontWeight: 500 }} data-testid="club-todo-counts">
        {t("clubTodo.counts", { open: open.length, done: done.length })}
      </Typography>

      {/* 44-px links, like the «Club» panel's chips (§150). */}
      {owners.length > 0 && (
        <Stack component="nav" aria-label={t("clubTodo.filterLabel")} direction="row" sx={{ flexWrap: "wrap", alignItems: "center", columnGap: 0.5 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mr: 0.5 }}>
            {t("clubTodo.filterLabel")}:
          </Typography>
          {[undefined, ...owners].map((candidate) => {
            const current = candidate === owner;
            return (
              <Box
                key={candidate ?? "all"}
                component="a"
                href={hrefFor(candidate)}
                aria-current={current ? "page" : undefined}
                sx={{ display: "inline-flex", alignItems: "center", minHeight: 44, textDecoration: "none" }}
              >
                <Chip
                  size="small"
                  label={candidate ?? t("clubTodo.filterAll")}
                  color={current ? "primary" : "default"}
                  variant={current ? "filled" : "outlined"}
                />
              </Box>
            );
          })}
        </Stack>
      )}

      {mayEdit && (
        <Box component="details" sx={BOXED_DISCLOSURE_SX} data-testid="club-todo-add">
          <Box component="summary" sx={{ fontWeight: 500 }}>
            <AddIcon aria-hidden sx={FOLD_GLYPH_SX} />
            {t("clubTodo.add.title")}
          </Box>
          <Box sx={{ pb: 1.5 }}>
            <ActionForm
              action={addClubTodoAction}
              scope="todo-new"
              messages={await refusalMessages({
                text: t("clubTodo.field.text"),
                owner: t("clubTodo.field.owner"),
                due: t("clubTodo.field.due"),
              })}
            >
              {context}
              {fields(null)}
              <Box sx={{ mt: 1.5 }}>
                <GlyphSubmitButton label={t("clubTodo.add.save")} pendingLabel={t("clubTodo.add.saving")} icon="add" />
              </Box>
            </ActionForm>
          </Box>
        </Box>
      )}

      {open.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {owner ? t("clubTodo.emptyFor", { owner }) : t("clubTodo.empty")}
        </Typography>
      ) : (
        <Stack spacing={1.5} component="ul" aria-label={t("clubTodo.listLabel")} sx={{ listStyle: "none", m: 0, p: 0 }}>
          {open.map((item, index) => row(item, index, open))}
        </Stack>
      )}

      {done.length > 0 && (
        <Box component="details" sx={BOXED_DISCLOSURE_SX} data-testid="club-todo-done">
          <Box component="summary" sx={{ fontWeight: 500 }}>
            <TaskAltIcon aria-hidden sx={FOLD_GLYPH_SX} />
            {t("clubTodo.doneTitle", { count: done.length })}
          </Box>
          <Stack spacing={1.5} component="ul" sx={{ listStyle: "none", m: 0, p: 0, pb: 1.5 }}>
            {done.map((item, index) => row(item, index, done))}
          </Stack>
        </Box>
      )}

      {mayEdit && (
        <datalist id={OWNERS_LIST_ID}>
          {suggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      )}
    </Stack>
  );
}
