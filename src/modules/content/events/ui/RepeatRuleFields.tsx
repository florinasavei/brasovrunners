"use client";

import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";
import { type CalendarDayWords, composeCalendarDay } from "@/i18n/dates";
import { paintedScheduler } from "@/shared/forms/after-paint";
import { useRecall } from "@/shared/forms/recall";
import { fillIn } from "@/shared/forms/fill-in";
import { isTimeValue, normalizeTypedTime } from "@/shared/forms/pickers/wall-values";
import { ACTION_ICONS } from "@/shared/ui/action-icons";
import { CHECKBOX_TAP_TARGET } from "@/shared/ui/tap-target";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** The ISO weekday (1 = Monday) of a `YYYY-MM-DD`, or null for anything else. */
export function isoWeekdayOf(ymd: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const day = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return Number.isNaN(day) ? null : day === 0 ? 7 : day;
}

export type RuleSentenceWords = {
  weekly: string;
  fortnightly: string;
  monthly: string;
  atTime: string;
  forever: string;
  until: string;
  horizon: string;
  /**
   * The seven weekday names by ISO number, written on the server (`series-sentence.ts#weekdayNames`)
   * and handed here as strings: a client island formats no date itself (§324, §350 weekday on
   * every date).
   */
  weekdayNames: Readonly<Record<string, string>>;
  /** The end date's words, written on the server the same way (`dates.ts#calendarDayWords`). */
  untilDay: CalendarDayWords;
};

/**
 * "Se repetă săptămânal, lunea și miercurea, la 18:30 — la nesfârșit." — the rule, in words,
 * from the boxes as they stand (§350). Pure: the caller reads the form.
 *
 * The end reads as the Recurență box writes it once saved — "până la mie., 30 sept. 2026", its
 * weekday first (§349) — joined from the server's words, not formatted here (§324).
 */
export function ruleSentenceFrom(
  words: RuleSentenceWords,
  rule: { cadence: string; weekdays: readonly number[]; time: string; day: string; until: string },
  locale: string,
): string {
  const lang = locale === "ro" ? "ro" : "en";
  const names = [...rule.weekdays].sort((a, b) => a - b).map((weekday) => words.weekdayNames[String(weekday)] ?? "");
  const days = new Intl.ListFormat(lang, { type: "conjunction" }).format(names);
  const base =
    rule.cadence === "MONTHLY"
      ? fillIn(words.monthly, { day: rule.day })
      : fillIn(rule.cadence === "FORTNIGHTLY" ? words.fortnightly : words.weekly, { days });
  const timed = rule.time ? fillIn(words.atTime, { sentence: base, time: rule.time }) : base;
  const untilText = composeCalendarDay(rule.until, words.untilDay);
  return `${timed}${untilText ? fillIn(words.until, { until: untilText }) : words.forever} ${words.horizon}`;
}

/**
 * The days of the week a series runs on, and the rule in one live sentence under them (§350).
 *
 * The event's own day is always in the series (§128): it is ticked and locked, and — a disabled
 * box posts nothing — a hidden input posts it. On the editor the day is known and fixed; on the
 * create page it **follows the start date as it is typed** (`followDateName`, the picker's hidden
 * box, which announces itself with `change`), so the lock moves with the date rather than being
 * absent until the save. The other days post `weekday=1..7` as before (`admin/actions.ts`).
 *
 * After a refused submit the ticks come back as posted (§315).
 */
export default function RepeatRuleFields({
  prefix,
  ownWeekday: fixedOwn,
  followDateName,
  startTime,
  labels,
  words,
  locale,
}: {
  prefix: string;
  /** The event's own ISO weekday, when the event exists. */
  ownWeekday?: number;
  /** On create: the start-date box to follow for the own day and the sentence. */
  followDateName?: string;
  /** The event's own start time on the editor, `HH:mm`; on create it is read from the form. */
  startTime?: string;
  labels: { weekdays: Readonly<Record<string, string>>; title: string; help: string };
  words: RuleSentenceWords;
  locale: string;
}) {
  const recall = useRecall();
  const root = useRef<HTMLDivElement>(null);
  const [ticked, setTicked] = useState<ReadonlySet<number>>(() => {
    const posted = recall.all("weekday");
    return new Set((posted ?? []).map(Number).filter((day) => WEEKDAYS.includes(day as (typeof WEEKDAYS)[number])));
  });
  const [liveDate, setLiveDate] = useState("");
  const [rule, setRule] = useState({ cadence: "WEEKLY", time: startTime ?? "", until: "" });

  useEffect(() => {
    const form = root.current?.closest("form");
    if (!form) return;
    const read = () => {
      const data = new FormData(form);
      const text = (name: string) => String(data.get(name) ?? "");
      if (followDateName) setLiveDate(text(followDateName));
      // The time box is typed since §NNN and moves on every keystroke: the sentence reads it as the
      // box will post it («1900» → 19:00), and a half-typed «19:» or «7pm» says no time at all.
      const typed = normalizeTypedTime(text("event.startsAtTime"));
      const next = {
        cadence: text(`${prefix}cadence`) || "WEEKLY",
        time: startTime ?? (isTimeValue(typed) ? typed : ""),
        until: text(`${prefix}until`),
      };
      // The same rule keeps the same object, so a keystroke elsewhere in the form renders nothing here.
      setRule((current) => (current.cadence === next.cadence && current.time === next.time && current.until === next.until ? current : next));
    };
    // The whole form is read, so after the frame the keystroke or the press leads to, once for a
    // burst (§371) — never inside the press of a save button, whose `change` on the box it leaves
    // used to pay this before "Se salvează…" could paint.
    const scheduler = paintedScheduler(read);
    read();
    form.addEventListener("change", scheduler.schedule);
    form.addEventListener("input", scheduler.schedule);
    return () => {
      form.removeEventListener("change", scheduler.schedule);
      form.removeEventListener("input", scheduler.schedule);
      scheduler.cancel();
    };
  }, [prefix, followDateName, startTime]);

  const own = fixedOwn ?? isoWeekdayOf(liveDate) ?? undefined;
  const days = new Set(ticked);
  if (own !== undefined) days.add(own);
  const dayOfMonth = liveDate ? String(Number(liveDate.slice(8, 10))) : "";
  const sentence = ruleSentenceFrom(words, { cadence: rule.cadence, weekdays: [...days], time: rule.time, day: dayOfMonth, until: rule.until }, locale);

  return (
    <Stack ref={root} spacing={1}>
      <Box>
        <Typography variant="body2" sx={{ mb: 0.5 }}>
          {labels.title}
        </Typography>
        {own !== undefined && <input type="hidden" name="weekday" value={String(own)} />}
        <Stack direction="row" sx={{ flexWrap: "wrap", columnGap: 1 }}>
          {WEEKDAYS.map((day) => {
            const locked = day === own;
            return (
              <FormControlLabel
                key={day}
                control={
                  <Checkbox
                    name="weekday"
                    value={String(day)}
                    checked={locked || ticked.has(day)}
                    disabled={locked}
                    onChange={(event) =>
                      setTicked((was) => {
                        const next = new Set(was);
                        if (event.target.checked) next.add(day);
                        else next.delete(day);
                        return next;
                      })
                    }
                    sx={CHECKBOX_TAP_TARGET}
                  />
                }
                label={labels.weekdays[String(day)] ?? String(day)}
              />
            );
          })}
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {labels.help}
        </Typography>
      </Box>
      {(own !== undefined || days.size > 0) && (
        <Typography variant="body2" data-testid="repeat-rule-sentence" role="status">
          {sentence}
        </Typography>
      )}
    </Stack>
  );
}

/**
 * "Publică datele noi automat" (§350): ticked by default, now always shown (it was only offered on
 * a live event), with what it means when it is off and while the event is a draft.
 */
export function RepeatPublishField({
  name,
  draftSource,
  labels,
}: {
  name: string;
  /** Whether the event is (or is created as) a draft — its dates are drafts until it goes live. */
  draftSource: boolean;
  labels: { label: string; off: string; draft: string };
}) {
  const recall = useRecall();
  const [on, setOn] = useState(recall.has ? recall.value(name) === "on" : true);
  // The robot (§398): the same glyph as the source event's Recurență card, leading this
  // switch's own line too, decorative and aria-hidden.
  const RenewIcon = ACTION_ICONS.renew;
  return (
    <Box data-testid="repeat-publish-field">
      <Stack direction="row" spacing={0.5} sx={{ alignItems: "flex-start" }}>
        <RenewIcon aria-hidden fontSize="small" sx={{ color: "text.secondary", mt: "9px", flexShrink: 0 }} />
        <FormControlLabel
          control={<Checkbox key={recall.generation} name={name} checked={on} onChange={(event) => setOn(event.target.checked)} sx={CHECKBOX_TAP_TARGET} />}
          label={labels.label}
        />
      </Stack>
      <Typography variant="body2" color="text.secondary">
        {on ? (draftSource ? labels.draft : "") : labels.off}
      </Typography>
    </Box>
  );
}
