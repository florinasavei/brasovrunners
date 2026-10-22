import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
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
import ChipLink from "@/shared/ui/ChipLink";
import GlyphButtonLink from "@/shared/ui/GlyphButtonLink";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import StatusChip from "@/shared/ui/StatusChip";
import TodoLine from "@/shared/ui/TodoLine";
import { FACTS_SX } from "@/shared/ui/row-fold";

type Props = {
  locale: Locale;
  /** The whole list, in its order; the panel filters it. */
  items: readonly ClubTodoItem[];
  /** `canEditClubTodo` — the Organizer and the Administrators; `changeClubTodo` asserts it again. */
  mayEdit: boolean;
  /** The owner `?for=` named, as the list writes it, or undefined for everybody. */
  owner: string | undefined;
  /** Today on the club's calendar, `YYYY-MM-DD` — what "overdue" is measured against. */
  today: string;
  /** A refused one-button form's code (`?error=`), already translated. */
  error?: string;
};

const OWNERS_LIST_ID = "club-todo-owners";

/** A line's words cut for an accessible name: "Bifează: Intră în backoffice…" rather than a paragraph read aloud. */
function shortText(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
}

/**
 * «De făcut» — the club's own checklist (§438). A Server Component of forms, like every other
 * panel on `/admin/tasks`: a tick, ↑ and ↓ are one button each in a form of their own, so the
 * list works with JavaScript off (§265), and every verb posts to a Server Action that asks
 * `changeClubTodo` — the role is decided there, never by which buttons this draws (BR-REQ-060-01).
 *
 * The open lines first, in the club's order; the done ones inside a closed fold «Arată terminate»,
 * struck through, with who ticked them and when. «Adaugă un rând» is a fold above the list, open
 * by itself only while the list is empty. Every line is the event to-dos' row (`TodoLine`, §749,
 * §842): the tick, then the line in words — the text, «Pentru …» and the day as chips, the pencil —
 * which opens in place onto the line's door to its editor (§538), ↑ and ↓, the three boxes and
 * «Șterge», last, which asks first (§384). A reader's line is the words and the chips alone. Folds
 * start closed (§336).
 */
export default async function ClubTodoPanel({ locale, items, mayEdit, owner, today, error }: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();

  const shown = filterClubTodo(items, owner);
  const open = shown.filter((item) => !item.done);
  const done = shown.filter((item) => item.done);
  const owners = clubTodoOwners(items);
  // What «pentru cine» offers: the names the owner gave, then every other name already on the list.
  const suggestions = [...new Set([...CLUB_TODO_OWNER_SUGGESTIONS, ...owners])];

  const hrefFor = (who: string | undefined) =>
    getPathname({ locale, href: { pathname: "/admin/tasks", query: { panel: "todo", ...(who ? { for: who } : {}) } } });

  /** The hidden fields every form carries: the language to land back in and the filter to keep. */
  const context = (
    <>
      <input type="hidden" name="uiLocale" value={locale} />
      {owner && <input type="hidden" name="for" value={owner} />}
    </>
  );

  /** The three boxes, for «Adaugă» and every «Modifică». */
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
    // A starting line the club has not edited (§538): its words in the reader's language, and the editor it names.
    const view = clubTodoDefaultView(item, locale);
    const text = view?.text ?? item.text;
    const label = shortText(text);
    // The door to the editor the line names: inside the fold for a person who may write the list — never inside the line's
    // `<summary>`, which is itself the control — and under the words for a reader, whose line has no fold.
    const door = view && !item.done && (
      <Box sx={mayEdit ? undefined : { mt: 0.75 }}>
        <GlyphButtonLink href={view.href} icon="edit" variant="outlined" size="small" sx={{ minHeight: 44 }} data-testid="club-todo-link">
          {view.link}
        </GlyphButtonLink>
      </Box>
    );
    const wordsBlock = (
      <Box sx={{ gridArea: "words", minWidth: 0 }}>
        <Typography
          variant="body2"
          component="span"
          data-testid="club-todo-text"
          sx={{ display: "block", whiteSpace: "pre-wrap", wordBreak: "break-word", ...(item.done ? { textDecoration: "line-through", color: "text.secondary" } : {}) }}
        >
          {text}
        </Typography>
        {item.done && item.doneAt && (
          <Typography variant="caption" color="text.secondary">
            {t("clubTodo.doneBy", {
              by: item.by ?? "—",
              when: formatDay(new Date(item.doneAt), { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" }),
            })}
          </Typography>
        )}
        {!mayEdit && door}
      </Box>
    );
    // The small facts on the right of the line, the event to-dos' chips (§749): for whom, by when.
    const facts = (
      <Box sx={FACTS_SX}>
        {item.owner && <StatusChip glyph="club" variant="outlined" label={t("clubTodo.owner", { owner: item.owner })} testId="club-todo-owner" />}
        {item.due && (
          <StatusChip
            glyph="planned"
            variant={overdue ? "filled" : "outlined"}
            color={overdue ? "error" : "default"}
            label={t(overdue ? "clubTodo.overdue" : "clubTodo.due", { day: formatCalendarDay(item.due, { locale, style: "short", position: "inline" }) })}
            testId={overdue ? "club-todo-overdue" : "club-todo-due"}
          />
        )}
      </Box>
    );
    return (
      <TodoLine
        key={item.id}
        testIdPrefix="club-todo"
        itemId={item.id}
        done={item.done}
        words={wordsBlock}
        facts={facts}
        edit={
          mayEdit
            ? {
                tickAction: setClubTodoDoneAction,
                hidden: context,
                tickLabel: t(item.done ? "clubTodo.untick" : "clubTodo.tick", { text: label }),
                tickTitle: t(item.done ? "clubTodo.untickWord" : "clubTodo.tickWord"),
                foldKey: [item.text, item.owner, item.due].join("\u0001"),
                foldTitle: t("clubTodo.edit"),
                body: (
                  <Stack spacing={1.5} sx={{ pb: 1.5, pt: 0.5 }}>
                    {door}
                    {/* ↑ and ↓ among the open lines shown: none at an end, rather than an arrow that does nothing (the pages list's rule). */}
                    {!item.done && siblings.length > 1 && (
                      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
                        {index > 0 && (
                          <Box component="form" action={moveClubTodoAction}>
                            {context}
                            <input type="hidden" name="itemId" value={item.id} />
                            <input type="hidden" name="direction" value="up" />
                            <GlyphSubmitButton icon="moveUp" label={t("clubTodo.moveUpWord")} pendingLabel={t("clubTodo.moveUpWord")} tooltip={t("clubTodo.moveUpTip")} variant="outlined" ariaLabel={t("clubTodo.moveUp", { text: label })} />
                          </Box>
                        )}
                        {index < siblings.length - 1 && (
                          <Box component="form" action={moveClubTodoAction}>
                            {context}
                            <input type="hidden" name="itemId" value={item.id} />
                            <input type="hidden" name="direction" value="down" />
                            <GlyphSubmitButton icon="moveDown" label={t("clubTodo.moveDownWord")} pendingLabel={t("clubTodo.moveDownWord")} tooltip={t("clubTodo.moveDownTip")} variant="outlined" ariaLabel={t("clubTodo.moveDown", { text: label })} />
                          </Box>
                        )}
                      </Stack>
                    )}
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
                ),
              }
            : undefined
        }
      />
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

      {/* «Pentru cine»: the names on the list, each a chip link 44 px tall — the event to-dos' «Toate / Ale mele» (§749). */}
      {owners.length > 0 && (
        <Stack component="nav" aria-label={t("clubTodo.filterLabel")} direction="row" sx={{ flexWrap: "wrap", alignItems: "center", columnGap: 0.5 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mr: 0.5 }}>
            {t("clubTodo.filterLabel")}:
          </Typography>
          {[undefined, ...owners].map((candidate) => {
            const current = candidate === owner;
            return <ChipLink key={candidate ?? "all"} href={hrefFor(candidate)} label={candidate ?? t("clubTodo.filterAll")} active={current} current={current ? "page" : undefined} />;
          })}
        </Stack>
      )}

      {/* «Adaugă un rând»: the blank boxes in a fold of their own, like every «Adaugă…» of the backoffice (§842) — open by itself only while the list is empty. */}
      {mayEdit && (
        <Panel glyph="add" collapsible level={3} title={t("clubTodo.add.title")} openWhen={{ primary: items.length === 0 }} data-testid="club-todo-add">
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
        </Panel>
      )}

      {open.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {owner ? t("clubTodo.emptyFor", { owner }) : t("clubTodo.empty")}
        </Typography>
      ) : (
        <Box component="ul" aria-label={t("clubTodo.listLabel")} sx={{ listStyle: "none", m: 0, p: 0 }}>
          {open.map((item, index) => row(item, index, open))}
        </Box>
      )}

      {done.length > 0 && (
        <Panel glyph="confirmation" collapsible level={3} title={t("clubTodo.doneTitle", { count: done.length })} data-testid="club-todo-done">
          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
            {done.map((item, index) => row(item, index, done))}
          </Box>
        </Panel>
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
