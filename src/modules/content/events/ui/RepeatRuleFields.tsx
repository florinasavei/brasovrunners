"use client";

import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";
import { useRecall } from "@/shared/forms/recall";
import { fillIn } from "@/shared/forms/fill-in";
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
};

/**
 * "Se repetă săptămânal, lunea și miercurea, la 18:30 — la nesfârșit." — the rule, in words,
 * from the boxes as they stand (§NNN). Pure: the caller reads the form.
 */
export function ruleSentenceFrom(
  words: RuleSentenceWords,
  rule: { cadence: string; weekdays: readonly number[]; time: string; day: string; until: string },
  locale: string,
): string {
  const lang = locale === "ro" ? "ro" : "en";
  const names = [...rule.weekdays]
    .sort((a, b) => a - b)
    .map((weekday) => new Intl.DateTimeFormat(lang, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, weekday, 12))));
  const days = new Intl.ListFormat(lang, { type: "conjunction" }).format(names);
  const base =
    rule.cadence === "MONTHLY"
      ? fillIn(words.monthly, { day: rule.day })
      : fillIn(rule.cadence === "FORTNIGHTLY" ? words.fortnightly : words.weekly, { days });
  const timed = rule.time ? fillIn(words.atTime, { sentence: base, time: rule.time }) : base;
  const untilText = /^\d{4}-\d{2}-\d{2}$/.test(rule.until) ? rule.until.split("-").reverse().join(".") : "";
  return `${timed}${untilText ? fillIn(words.until, { until: untilText }) : words.forever} ${words.horizon}`;
}

/**
 * The days of the week a series runs on, and the rule in one live sentence under them (§NNN).
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
      setRule({
        cadence: text(`${prefix}cadence`) || "WEEKLY",
        time: startTime ?? text("event.startsAtTime"),
        until: text(`${prefix}until`),
      });
    };
    const deferred = () => setTimeout(read, 0);
    read();
    form.addEventListener("change", deferred);
    form.addEventListener("input", deferred);
    return () => {
      form.removeEventListener("change", deferred);
      form.removeEventListener("input", deferred);
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
 * "Publică datele noi automat" (§NNN): ticked by default, now always shown (it was only offered on
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
  return (
    <Box data-testid="repeat-publish-field">
      <FormControlLabel
        control={<Checkbox key={recall.generation} name={name} checked={on} onChange={(event) => setOn(event.target.checked)} sx={CHECKBOX_TAP_TARGET} />}
        label={labels.label}
      />
      <Typography variant="body2" color="text.secondary">
        {on ? (draftSource ? labels.draft : "") : labels.off}
      </Typography>
    </Box>
  );
}
