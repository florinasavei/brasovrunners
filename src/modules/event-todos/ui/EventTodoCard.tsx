import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { addEventTodoAction, deleteEventTodoAction, editEventTodoAction, setEventTodoDoneAction } from "@/app/[locale]/admin/events/[id]/todo-actions";
import { CLUB_TIME_ZONE, formatCalendarDay, formatDay } from "@/i18n/dates";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { PageTodo } from "@/modules/content/events/domain/page-todos";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import DateField from "@/shared/forms/pickers/DateField";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { ACTION_ICONS } from "@/shared/ui/action-icons";
import ChipLink from "@/shared/ui/ChipLink";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import StatusChip from "@/shared/ui/StatusChip";
import type { StatusGlyphName } from "@/shared/ui/status-glyphs";
import { EVENT_TODO_PRIORITIES, EVENT_TODO_TEXT_MAX, type EventTodoPriority, isTodoOverdue } from "../domain/event-todo";
import type { EventTodoItem } from "../event-todos";
import { eventTodoRows, type TodoRow } from "../rows";

/**
 * A priority's chip: its word, its glyph and its tone (`StatusChip`'s palette colours, never a
 * colour literal). The state is never the colour alone — the word and the glyph say it too.
 */
const PRIORITY_CHIP: Record<EventTodoPriority, { glyph: StatusGlyphName; color: "error" | "warning" | "default" | "primary" }> = {
  URGENT: { glyph: "priorityUrgent", color: "error" },
  HIGH: { glyph: "priorityHigh", color: "warning" },
  NORMAL: { glyph: "priorityNormal", color: "default" },
  LOW: { glyph: "priorityLow", color: "primary" },
};

/** The glyph before «Deschide câmpul»: the edit verb's, by name from the verbs' registry (§318). */
const FillGlyph = ACTION_ICONS.edit;

type Props = {
  locale: Locale;
  eventId: string;
  /** What the page still lacks, computed from the event (`eventPageTodos`). */
  computed: readonly PageTodo[];
  /** The lines the club typed for this event. */
  items: readonly EventTodoItem[];
  /** Backoffice staff by name, for «Cine»; the id is what is posted. */
  staff: readonly { id: string; name: string }[];
  /** The language name of each locale, in the reader's words: a row about one language says which. */
  languageNames: Readonly<Record<string, string>>;
  /** `canEditEventTodos` — the Organizer and the Administrators; `changeEventTodo` asserts it again. */
  mayEdit: boolean;
  /** The signed-in staff member, for «Ale mele». */
  currentStaffId: string;
  /** «Ale mele» is on (`?mine=1`). */
  mine: boolean;
  /** Today on the club's calendar, `YYYY-MM-DD`. */
  today: string;
  /** A refused one-button form's code, already translated. */
  error?: string;
};

/** A line's words cut for an accessible name. */
function shortText(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
}

/**
 * «De făcut pentru pagina evenimentului» (§NNN): one card in the event editor, folded, with a
 * summary line «N de făcut» and open on arrival while anything is left. It lists, in one order —
 * priority, then the due day, then age — what the event's page still lacks (computed, marked «din
 * pagină», each a link to the card that fills it, gone once filled) and the club's own lines (a
 * line, a priority, who takes it, by when, a tick), with the ticked ones under «Gata». Backoffice
 * only; `/admin/tasks` stays the club's list.
 *
 * A Server Component of plain forms, like the club's checklist it follows (`ClubTodoPanel`): the
 * tick, the edit and the delete each post to a Server Action, so the card works with scripts off,
 * and each action asks the service, which decides by role (BR-REQ-060-01) whatever buttons this
 * draws. It sits beside the editor's save form, never inside it: HTML forms cannot nest.
 */
export default async function EventTodoCard({ locale, eventId, computed, items, staff, languageNames, mayEdit, currentStaffId, mine, today, error }: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();

  const rows = eventTodoRows(computed, items, mine ? { mineOf: currentStaffId } : {});
  // The summary counts what is left whatever the filter, so the closed line never depends on the view.
  const openCount = computed.length + items.filter((item) => item.doneAt === null).length;
  const eventPath = getPathname({ locale, href: { pathname: "/admin/events/[id]", params: { id: eventId } } });

  const hidden = (
    <>
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="eventId" value={eventId} />
      {/* «Ale mele» stays on after a press. */}
      {mine && <input type="hidden" name="mine" value="1" />}
    </>
  );

  /** The four boxes of «Adaugă» and every «Modifică». */
  const fields = (item: EventTodoItem | null) => (
    <Stack spacing={1.5} sx={{ maxWidth: 640 }}>
      <RecallField
        name="text"
        label={t("eventTodos.field.text")}
        helperText={t("eventTodos.field.textHelp", { max: String(EVENT_TODO_TEXT_MAX) })}
        defaultValue={item?.text ?? ""}
        required
        size="small"
        slotProps={{ htmlInput: { maxLength: EVENT_TODO_TEXT_MAX } }}
      />
      <RecallField
        name="priority"
        select
        label={t("eventTodos.field.priority")}
        defaultValue={item?.priority ?? "NORMAL"}
        size="small"
        slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
      >
        {EVENT_TODO_PRIORITIES.map((priority) => (
          <option key={priority} value={priority}>
            {t(`eventTodos.priority.${priority}`)}
          </option>
        ))}
      </RecallField>
      <RecallField
        name="assignee"
        select
        label={t("eventTodos.field.assignee")}
        helperText={t("eventTodos.field.assigneeHelp")}
        defaultValue={item?.assigneeStaffUserId ?? ""}
        size="small"
        slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
      >
        <option value="">{t("eventTodos.field.assigneeNone")}</option>
        {staff.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </RecallField>
      <DateField name="due" label={t("eventTodos.field.due")} helperText={t("eventTodos.field.dueHelp")} defaultValue={item?.dueOn ?? ""} size="small" />
    </Stack>
  );

  const priorityChip = (priority: EventTodoPriority) => (
    <StatusChip
      glyph={PRIORITY_CHIP[priority].glyph}
      color={PRIORITY_CHIP[priority].color}
      label={t(`eventTodos.priority.${priority}`)}
      testId="event-todo-priority"
    />
  );

  const pageRow = (row: Extract<TodoRow, { kind: "page" }>) => {
    const { todo } = row;
    const text = t(`eventTodos.page.${todo.rule}`, { language: todo.locale ? (languageNames[todo.locale] ?? todo.locale) : "" });
    return (
      <Box component="li" key={row.key} data-testid="event-todo-page-row" data-rule={todo.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
        <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", gap: 1 }}>
          {priorityChip(row.priority)}
          <StatusChip glyph="visible" variant="outlined" label={t("eventTodos.fromPage")} />
        </Stack>
        <Typography variant="body2" sx={{ mt: 0.75 }}>
          {text}
        </Typography>
        {/* The card that fills it: a plain in-page link — the browser's own hash change opens the folds around it
            (`OpenFoldFromHash`, §336), which a soft navigation of the locale-aware `Link` would not — 44 pixels tall. */}
        <Box
          component="a"
          href={`#${todo.anchor}`}
          data-testid="event-todo-fill"
          sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, minHeight: 44, mt: 0.5, fontSize: "0.875rem", fontWeight: 500 }}
        >
          <FillGlyph aria-hidden fontSize="small" />
          {t("eventTodos.fill")}
        </Box>
      </Box>
    );
  };

  const ownRow = (row: Extract<TodoRow, { kind: "own" }>) => {
    const { item } = row;
    const done = item.doneAt !== null;
    const overdue = isTodoOverdue({ dueOn: item.dueOn, done }, today);
    const label = shortText(item.text);
    return (
      <Box component="li" key={row.key} data-testid="event-todo-item" data-item-id={item.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
        <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", gap: 0.75 }}>
          {priorityChip(item.priority)}
          {item.assigneeName && (
            <StatusChip glyph="club" variant="outlined" label={t("eventTodos.assignedTo", { name: item.assigneeName })} testId="event-todo-assignee" />
          )}
          {item.dueOn && (
            <StatusChip
              glyph="planned"
              variant={overdue ? "filled" : "outlined"}
              color={overdue ? "error" : "default"}
              label={t(overdue ? "eventTodos.overdue" : "eventTodos.due", { day: formatCalendarDay(item.dueOn, { locale, style: "short", position: "inline" }) })}
            />
          )}
        </Stack>
        <Typography
          variant="body2"
          sx={{ mt: 0.75, wordBreak: "break-word", ...(done ? { textDecoration: "line-through", color: "text.secondary" } : {}) }}
        >
          {item.text}
        </Typography>
        {done && item.doneAt && (
          <Typography variant="caption" color="text.secondary">
            {t("eventTodos.doneBy", {
              by: item.doneByName ?? "—",
              when: formatDay(item.doneAt, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" }),
            })}
          </Typography>
        )}

        {mayEdit && (
          <Stack spacing={1} sx={{ mt: 1 }}>
            {/* The tick posts the state it wants, not a toggle; a verb with its glyph and its words (§318). */}
            <Box component="form" action={setEventTodoDoneAction} data-testid="event-todo-tick-form">
              {hidden}
              <input type="hidden" name="itemId" value={item.id} />
              <input type="hidden" name="done" value={done ? "0" : "1"} />
              <GlyphSubmitButton
                icon={done ? "tickOn" : "tickOff"}
                label={t(done ? "eventTodos.untickWord" : "eventTodos.tickWord")}
                pendingLabel={t(done ? "eventTodos.untickWord" : "eventTodos.tickWord")}
                ariaLabel={t(done ? "eventTodos.untick" : "eventTodos.tick", { text: label })}
                variant="outlined"
              />
            </Box>
            <Panel variant="help" title={t("eventTodos.edit")}>
              <Stack spacing={1.5} sx={{ pb: 1.5 }}>
                <ActionForm action={editEventTodoAction} scope={`todo-${item.id}`}>
                  {hidden}
                  <input type="hidden" name="itemId" value={item.id} />
                  {fields(item)}
                  <Box sx={{ mt: 1.5 }}>
                    <GlyphSubmitButton label={t("eventTodos.save")} pendingLabel={t("eventTodos.saving")} icon="save" />
                  </Box>
                </ActionForm>
                <ActionForm
                  action={deleteEventTodoAction}
                  confirm={{
                    title: t("eventTodos.deleteTitle"),
                    body: t("eventTodos.deleteBody", { text: label }),
                    confirmLabel: t("eventTodos.delete"),
                    cancelLabel: words.cancel,
                    destructive: true,
                  }}
                >
                  {hidden}
                  <input type="hidden" name="itemId" value={item.id} />
                  <GlyphSubmitButton label={t("eventTodos.delete")} pendingLabel={t("eventTodos.deleting")} icon="delete" color="error" variant="outlined" />
                </ActionForm>
              </Stack>
            </Panel>
          </Stack>
        )}
      </Box>
    );
  };

  const draw = (row: TodoRow) => (row.kind === "page" ? pageRow(row) : ownRow(row));

  return (
    <Panel
      glyph="todo"
      collapsible
      id="box-todos"
      title={t("eventTodos.title")}
      aside={openCount > 0 ? t("eventTodos.summary", { count: openCount }) : t("eventTodos.summaryNone")}
      openWhen={{ attention: openCount > 0 }}
      data-testid="event-todos"
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {t("eventTodos.intro")}
        </Typography>
        {!mayEdit && <Alert severity="info">{t("eventTodos.readOnly")}</Alert>}
        {error && <Alert severity="error">{error}</Alert>}

        {/* «Ale mele»: the lines given to the reader. Two links, 44 pixels tall, the state in the address (no script). */}
        <Stack component="nav" aria-label={t("eventTodos.filterLabel")} direction="row" sx={{ flexWrap: "wrap", alignItems: "center", columnGap: 0.5 }}>
          <ChipLink href={`${eventPath}#box-todos`} label={t("eventTodos.filterAll")} active={!mine} current={!mine ? "page" : undefined} />
          <ChipLink href={`${eventPath}?mine=1#box-todos`} label={t("eventTodos.filterMine")} active={mine} current={mine ? "page" : undefined} />
        </Stack>

        {mayEdit && (
          <Panel glyph="add" collapsible level={3} title={t("eventTodos.add.title")} data-testid="event-todo-add">
            <ActionForm
              action={addEventTodoAction}
              scope="todo-new"
              messages={await refusalMessages({
                text: t("eventTodos.field.text"),
                priority: t("eventTodos.field.priority"),
                assignee: t("eventTodos.field.assignee"),
                due: t("eventTodos.field.due"),
              })}
            >
              {hidden}
              {fields(null)}
              <Box sx={{ mt: 1.5 }}>
                <GlyphSubmitButton label={t("eventTodos.add.save")} pendingLabel={t("eventTodos.add.saving")} icon="add" />
              </Box>
            </ActionForm>
          </Panel>
        )}

        {rows.open.length === 0 ? (
          <Typography variant="body2" color="text.secondary" data-testid="event-todos-empty">
            {mine ? t("eventTodos.emptyMine") : t("eventTodos.empty")}
          </Typography>
        ) : (
          <Stack spacing={1.5} component="ul" aria-label={t("eventTodos.listLabel")} sx={{ listStyle: "none", m: 0, p: 0 }} data-testid="event-todos-list">
            {rows.open.map(draw)}
          </Stack>
        )}

        {rows.done.length > 0 && (
          <Panel glyph="confirmation" collapsible level={3} title={t("eventTodos.doneTitle", { count: rows.done.length })} data-testid="event-todos-done">
            <Stack spacing={1.5} component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
              {rows.done.map(ownRow)}
            </Stack>
          </Panel>
        )}
      </Stack>
    </Panel>
  );
}
