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
import GlyphButton from "@/shared/ui/GlyphButton";
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

/** The glyphs drawn here as components, by name from the verbs' registry (§318): a Server Component may render one, never pass one. */
const GoToGlyph = ACTION_ICONS.goTo;
const PencilGlyph = ACTION_ICONS.edit;

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

/** The group headings: small, bold, secondary — a label over a list, not a card. */
const GROUP_HEADING_SX = { fontWeight: 700, color: "text.secondary", fontSize: "0.8rem", letterSpacing: 0.4, textTransform: "uppercase" } as const;

/** One row of a list: a hairline under it, nothing else. */
const ROW_SX = { borderBottom: 1, borderColor: "divider", "&:last-of-type": { borderBottom: 0 } } as const;

/**
 * A row's line. A grid, not a flex row: on a computer the words, the small facts and the pencil sit on
 * one line; on a phone the words take the first line and the facts and the pencil the second. Never
 * `display: flex` on a `<summary>` — Chrome and Safari drop the marker, and here there is none anyway.
 */
const LINE_SX = {
  display: "grid",
  gridTemplateColumns: { xs: "minmax(0, 1fr) 28px", sm: "minmax(0, 1fr) auto 28px" },
  gridTemplateAreas: { xs: '"words words" "facts pen"', sm: '"words facts pen"' },
  alignItems: "center",
  columnGap: 1,
  rowGap: 0.25,
  minHeight: 44,
  py: 0.5,
} as const;

/** The edit line is a `<summary>`: no marker, a hand, the whole line the target. */
const SUMMARY_SX = {
  ...LINE_SX,
  cursor: "pointer",
  listStyle: "none",
  "&::-webkit-details-marker": { display: "none" },
  "&::marker": { content: '""' },
  "&:hover": { bgcolor: "action.hover" },
} as const;

/** The box that ticks: a plain submit drawn as the house's checkbox, 44 pixels square, the glyph 24. */
const TICK_SX = { minWidth: 44, width: 44, height: 44, p: 0, borderRadius: 1, "& .MuiButton-startIcon": { m: 0 }, "& .MuiButton-startIcon > *:nth-of-type(1)": { fontSize: 24 } } as const;

/**
 * «De făcut pentru pagina evenimentului» (§749, drawn as a plain list by §NNN): one card in the event
 * editor, folded, with a summary line «N de făcut» and open on arrival while anything is left. Two
 * short lists under it — «Lipsește pe pagină» (computed from the event, each row a link to the card
 * that fills it, gone once filled) and «Sarcini» (the club's own, each a tick box, the words and, small
 * on the right, the priority, who and by when, with a pencil that opens the row's edit form in place) —
 * and the ticked rows folded under «Gata». Each list is in the order priority, then the due day, then
 * age. Backoffice only; `/admin/tasks` stays the club's list.
 *
 * A Server Component of plain forms, like the club's checklist it follows (`ClubTodoPanel`): the tick,
 * the add, the edit and the delete each post to a Server Action, so the card works with scripts off, and
 * each action asks the service, which decides by role (BR-REQ-060-01) whatever this draws. It sits beside
 * the editor's save form, never inside it: HTML forms cannot nest.
 *
 * A press that works does not navigate (§NNN, `todo-actions.ts`): the page is read again in place, so
 * an edit the reader has open is not replaced under their hand. A row's edit form lives in the
 * `<details>` its line is the summary of; the fold is keyed on the row's words, so a save that changed
 * them draws it closed.
 */
export default async function EventTodoCard({ locale, eventId, computed, items, staff, languageNames, mayEdit, currentStaffId, mine, today, error }: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();

  const rows = eventTodoRows(computed, items, mine ? { mineOf: currentStaffId } : {});
  const pageRows = rows.open.filter((row): row is Extract<TodoRow, { kind: "page" }> => row.kind === "page");
  const ownRows = rows.open.filter((row): row is Extract<TodoRow, { kind: "own" }> => row.kind === "own");
  // The summary counts what is left whatever the filter, so the closed line never depends on the view.
  const openCount = computed.length + items.filter((item) => item.doneAt === null).length;
  const eventPath = getPathname({ locale, href: { pathname: "/admin/events/[id]", params: { id: eventId } } });

  const boxMessages = await refusalMessages({
    text: t("eventTodos.field.text"),
    priority: t("eventTodos.field.priority"),
    assignee: t("eventTodos.field.assignee"),
    due: t("eventTodos.field.due"),
  });

  const hidden = (
    <>
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="eventId" value={eventId} />
      {/* «Ale mele» stays on after a press. */}
      {mine && <input type="hidden" name="mine" value="1" />}
    </>
  );

  const priorityOptions = EVENT_TODO_PRIORITIES.map((priority) => (
    <option key={priority} value={priority}>
      {t(`eventTodos.priority.${priority}`)}
    </option>
  ));

  /** Who and by when — the two boxes of «Mai multe» on the add line and of every «Modifică». */
  const whoAndWhen = (item: EventTodoItem | null) => (
    <>
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
    </>
  );

  const priorityChip = (priority: EventTodoPriority) => (
    <StatusChip
      glyph={PRIORITY_CHIP[priority].glyph}
      color={PRIORITY_CHIP[priority].color}
      label={t(`eventTodos.priority.${priority}`)}
      testId="event-todo-priority"
    />
  );

  /** «Lipsește pe pagină»: the whole row is the link to the card that fills the field. */
  const pageRow = (row: Extract<TodoRow, { kind: "page" }>) => {
    const { todo } = row;
    const text = t(`eventTodos.page.${todo.rule}`, { language: todo.locale ? (languageNames[todo.locale] ?? todo.locale) : "" });
    return (
      <Box component="li" key={row.key} data-testid="event-todo-page-row" data-rule={todo.id} sx={ROW_SX}>
        {/* A plain in-page link — the browser's own hash change opens the folds around the field
            (`OpenFoldFromHash`, §336), which a soft navigation of the locale-aware `Link` would not. */}
        <Box
          component="a"
          href={`#${todo.anchor}`}
          data-testid="event-todo-fill"
          aria-label={t("eventTodos.fillRow", { text })}
          title={t("eventTodos.fill")}
          sx={{ ...LINE_SX, color: "inherit", textDecoration: "none", "&:hover": { bgcolor: "action.hover" } }}
        >
          <Box sx={{ gridArea: "words", display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
            <GoToGlyph aria-hidden fontSize="small" sx={{ color: "text.secondary", flexShrink: 0 }} />
            <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
              {text}
            </Typography>
          </Box>
          <Box sx={{ gridArea: "facts", display: "flex", justifyContent: "flex-end" }}>{priorityChip(row.priority)}</Box>
        </Box>
      </Box>
    );
  };

  /** The small facts on the right of a typed row: the priority, who, by when. */
  const facts = (item: EventTodoItem, done: boolean) => {
    const overdue = isTodoOverdue({ dueOn: item.dueOn, done }, today);
    return (
      <Box sx={{ gridArea: "facts", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.5, justifyContent: { sm: "flex-end" } }}>
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
            testId={overdue ? "event-todo-overdue" : "event-todo-due"}
          />
        )}
      </Box>
    );
  };

  /** A typed row: the tick, then one line — the words, the small facts and the pencil that opens its edit form. */
  const ownRow = (row: Extract<TodoRow, { kind: "own" }>) => {
    const { item } = row;
    const done = item.doneAt !== null;
    const label = shortText(item.text);
    const wordsBlock = (
      <Box sx={{ gridArea: "words", minWidth: 0 }}>
        <Typography
          variant="body2"
          data-testid="event-todo-text"
          sx={{ wordBreak: "break-word", ...(done ? { textDecoration: "line-through", color: "text.secondary" } : {}) }}
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
      </Box>
    );

    if (!mayEdit) {
      return (
        <Box component="li" key={row.key} data-testid="event-todo-item" data-item-id={item.id} sx={ROW_SX}>
          <Box sx={{ ...LINE_SX, gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "minmax(0, 1fr) auto" }, gridTemplateAreas: { xs: '"words" "facts"', sm: '"words facts"' } }}>
            {wordsBlock}
            {facts(item, done)}
          </Box>
        </Box>
      );
    }

    return (
      <Box component="li" key={row.key} data-testid="event-todo-item" data-item-id={item.id} sx={{ ...ROW_SX, display: "flex", alignItems: "flex-start", gap: 0.5 }}>
        {/* The tick posts the state it wants, not a toggle: a form, so it works with scripts off. */}
        <ActionForm action={setEventTodoDoneAction} style={{ flex: "none" }} data-testid="event-todo-tick-form">
          {hidden}
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="done" value={done ? "0" : "1"} />
          <GlyphButton
            type="submit"
            icon={done ? "tickOn" : "tickOff"}
            role="checkbox"
            aria-checked={done}
            aria-label={t(done ? "eventTodos.untick" : "eventTodos.tick", { text: label })}
            title={t(done ? "eventTodos.untickWord" : "eventTodos.tickWord")}
            color={done ? "success" : "inherit"}
            sx={TICK_SX}
          />
        </ActionForm>
        {/* The row's line is the summary of its edit form: a press anywhere on it, or on the pencil, opens it in place.
            Keyed on the words, so a save that changed them draws the fold closed. */}
        <Box
          component="details"
          key={[item.text, item.priority, item.assigneeStaffUserId, item.dueOn].join("\u0001")}
          data-testid="event-todo-edit"
          sx={{ flex: 1, minWidth: 0 }}
        >
          <Box component="summary" aria-label={t("eventTodos.editRow", { text: label })} title={t("eventTodos.edit")} data-testid="event-todo-edit-toggle" sx={SUMMARY_SX}>
            {wordsBlock}
            {facts(item, done)}
            <PencilGlyph aria-hidden fontSize="small" sx={{ gridArea: "pen", color: "text.secondary", justifySelf: "end" }} />
          </Box>
          <Stack spacing={1.5} sx={{ pb: 1.5, pt: 0.5, maxWidth: 640 }}>
            <ActionForm action={editEventTodoAction} scope={`todo-${item.id}`} messages={boxMessages} data-testid="event-todo-edit-form">
              {hidden}
              <input type="hidden" name="itemId" value={item.id} />
              <Stack spacing={1.5}>
                <RecallField
                  name="text"
                  label={t("eventTodos.field.text")}
                  helperText={t("eventTodos.field.textHelp", { max: String(EVENT_TODO_TEXT_MAX) })}
                  defaultValue={item.text}
                  required
                  size="small"
                  slotProps={{ htmlInput: { maxLength: EVENT_TODO_TEXT_MAX } }}
                />
                <RecallField
                  name="priority"
                  select
                  label={t("eventTodos.field.priority")}
                  defaultValue={item.priority}
                  size="small"
                  slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                >
                  {priorityOptions}
                </RecallField>
                {whoAndWhen(item)}
              </Stack>
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
        </Box>
      </Box>
    );
  };

  const nothing = pageRows.length === 0 && ownRows.length === 0;

  return (
    <Panel
      glyph="todo"
      collapsible
      id="box-todos"
      title={t("eventTodos.title")}
      aside={openCount > 0 ? t("eventTodos.summary", { count: openCount }) : t("eventTodos.summaryNone")}
      intro={t("eventTodos.intro")}
      introMore={t("eventTodos.introMore", { max: String(EVENT_TODO_TEXT_MAX) })}
      openWhen={{ attention: openCount > 0 }}
      data-testid="event-todos"
    >
      <Stack spacing={1.5}>
        {!mayEdit && <Alert severity="info">{t("eventTodos.readOnly")}</Alert>}
        {error && <Alert severity="error">{error}</Alert>}

        {/* «Toate» / «Ale mele»: the lines given to the reader. Two links, 44 pixels tall, the state in the address (no script). */}
        <Stack component="nav" aria-label={t("eventTodos.filterLabel")} direction="row" sx={{ flexWrap: "wrap", alignItems: "center", columnGap: 0.5, justifyContent: "flex-end" }}>
          <ChipLink href={`${eventPath}#box-todos`} label={t("eventTodos.filterAll")} active={!mine} current={!mine ? "page" : undefined} />
          <ChipLink href={`${eventPath}?mine=1#box-todos`} label={t("eventTodos.filterMine")} active={mine} current={mine ? "page" : undefined} />
        </Stack>

        {pageRows.length > 0 && (
          <Box component="section" aria-labelledby="event-todos-page-heading">
            <Typography id="event-todos-page-heading" component="h3" sx={GROUP_HEADING_SX}>
              {t("eventTodos.groupPage")}
            </Typography>
            <Box component="ul" aria-label={t("eventTodos.groupPage")} sx={{ listStyle: "none", m: 0, p: 0 }} data-testid="event-todos-page-list">
              {pageRows.map(pageRow)}
            </Box>
          </Box>
        )}

        <Box component="section" aria-labelledby="event-todos-own-heading">
          <Typography id="event-todos-own-heading" component="h3" sx={GROUP_HEADING_SX}>
            {t("eventTodos.groupOwn")}
          </Typography>

          {/* One line to add a task: the words, the priority, «Adaugă» — Enter sends it; who and by when behind «Mai multe». */}
          {mayEdit && (
            <ActionForm action={addEventTodoAction} scope="todo-new" messages={boxMessages} data-testid="event-todo-add">
              {hidden}
              <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 1, pt: 1 }}>
                <RecallField
                  name="text"
                  label={t("eventTodos.add.label")}
                  required
                  size="small"
                  sx={{ flex: "1 1 220px", minWidth: 0 }}
                  slotProps={{ htmlInput: { maxLength: EVENT_TODO_TEXT_MAX } }}
                />
                <RecallField
                  name="priority"
                  select
                  label={t("eventTodos.field.priority")}
                  defaultValue="NORMAL"
                  size="small"
                  sx={{ flex: "0 0 140px" }}
                  slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                >
                  {priorityOptions}
                </RecallField>
                <GlyphSubmitButton label={t("eventTodos.add.save")} pendingLabel={t("eventTodos.add.saving")} icon="add" />
              </Box>
              <Panel variant="help" title={t("eventTodos.add.more")}>
                <Stack spacing={1.5} sx={{ pb: 1.5, pt: 0.5, maxWidth: 640 }}>
                  {whoAndWhen(null)}
                </Stack>
              </Panel>
            </ActionForm>
          )}

          {ownRows.length > 0 ? (
            <Box component="ul" aria-label={t("eventTodos.groupOwn")} sx={{ listStyle: "none", m: 0, mt: 0.5, p: 0 }} data-testid="event-todos-list">
              {ownRows.map(ownRow)}
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }} data-testid="event-todos-empty">
              {mine ? t("eventTodos.emptyMine") : nothing ? t("eventTodos.empty") : t("eventTodos.noTasks")}
            </Typography>
          )}
        </Box>

        {rows.done.length > 0 && (
          <Panel glyph="confirmation" collapsible level={3} title={t("eventTodos.doneTitle", { count: rows.done.length })} data-testid="event-todos-done">
            <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
              {rows.done.map(ownRow)}
            </Box>
          </Panel>
        )}
      </Stack>
    </Panel>
  );
}
