"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { type FormEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CLUB_TIME_ZONE, formatTimeWithSeconds } from "@/i18n/dates";
import GlyphButton from "@/shared/ui/GlyphButton";
import {
  anchorAtLoad,
  anchorFromAnswer,
  clockReading,
  dropKept,
  type EliteButtonView,
  entryStateOf,
  type FinishEntry,
  type FinishEntryOutcome,
  type FinishLineState,
  type FinishPressAnswer,
  type FinishUndoAnswer,
  finishStorageKey,
  keepTime,
  nextToSend,
  pressEntry,
  type RecentFinisherView,
  type ServerAnchor,
  serverNowOf,
  settleEntry,
  stampedGunTime,
  takeOldestKept,
  waitingCount,
} from "../domain/finish-line";
import { EMPTY_FINISH_LINE, finishLineSnapshot, subscribeFinishLine, writeFinishLine } from "./finish-line-store";
import { formatResultTime } from "../domain/result-time";

/**
 * «Cronometrare»'s finish line (§NNN; the owner, 2026-11-18: «un view rapid, în care să introduc și să se salveze instant, gen că a
 * ajuns NR X, Y, Z» — «elitele trebuie să fie primii» — «ca s-ar putea să ajungă mulți deodată»): the page's one island, over plain
 * server-rendered forms — with scripts off every button posts its form and the page comes back with a sentence, as «Sosire» did.
 *
 * With scripts on, a press never waits for the network:
 *
 * - **The elites first**: one big button an elite, the bib's label large and the full name under it; pressing it records that
 *   elite's number. A line with no number is drawn disabled with what to do; one already «Sosit» says «✓ <time>» and is not pressed.
 * - **The box**: the numeric keypad, Enter or «Sosit» records, and the box is empty at once, keeping the focus for the next number.
 * - **«⏱ Prinde timpul»** for a bunch: each press keeps one moment (oldest first, each with its ✕); the next number or elite pressed
 *   takes the oldest kept moment instead of now.
 * - **The times** are stamped at the press on the server's clock (`domain/finish-line.ts`: the anchor of the page, re-taken from
 *   every answer), so a phone whose clock is wrong stamps right; the server floors them and holds them to its bounds.
 * - **The queue**: every press is a line under the box at once («se salvează…») and is sent through the Server Action in the order
 *   pressed; an unsent one waits in this phone's storage for this event (every read and write in a `try`: without storage the page
 *   works, it only forgets on a reload), is retried by itself, and a reload sends what is left. A press the server already had from
 *   this viewer at that second is shown saved; one that another volunteer — or this one, another second — had stored first says who
 *   and when; a refusal stands on its line with the time to write on paper, never blocking the box.
 * - **«Ultimii sosiți»**, refreshed from every answer: who entered each, and «Anulează» on one's own for ten minutes.
 *
 * Plain data crosses the boundary — strings, numbers, booleans and the Server Actions — never an element (`AGENTS.md` §14.1); the
 * glyphs are named (`GlyphButton`).
 */

/** The words of the island, in the page's language: templates the island fills itself (`{time}`, `{bib}`…). */
export type FinishLineWords = {
  clock: string;
  notStarted: string;
  elitesTitle: string;
  elitesHelp: string;
  eliteAria: string;
  eliteFinished: string;
  eliteNoNumberLine: string;
  eliteNoNumberRegistration: string;
  boxLabel: string;
  bibHint: string;
  record: string;
  keep: string;
  keepHelp: string;
  keptTitle: string;
  keptDrop: string;
  entriesTitle: string;
  waiting: string;
  saved: string;
  place: string;
  outOfRanking: string;
  duplicate: string;
  refused: Record<string, string>;
  refusedOther: string;
  accountGone: string;
  offline: string;
  session: string;
  waitingCount: string;
  recentTitle: string;
  recentAside: string;
  recentEmpty: string;
  enteredBy: string;
  changedBy: string;
  undo: string;
  undoAria: string;
  undone: string;
  undoRefused: Record<string, string>;
  undoRefusedOther: string;
};

type Props = {
  eventId: string;
  uiLocale: string;
  /** The page's state as the server drew it: the gun, «Ultimii sosiți», the elites, the counts and the server's clock. */
  initial: FinishLineState;
  words: FinishLineWords;
  /** The Server Actions the island calls (`cronometrare/actions.ts`). */
  record: (input: unknown) => Promise<FinishPressAnswer>;
  undo: (input: unknown) => Promise<FinishUndoAnswer>;
  /** …and the ones the forms post with scripts off. */
  recordForm: (form: FormData) => Promise<void>;
  undoForm: (form: FormData) => Promise<void>;
};

/** A template's placeholders filled; a placeholder with no value is left as written. */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => values[name] ?? placeholder);
}

/** The phone's monotonic clock: a wall clock moved under the page does not move the stamps. */
const localNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** An entry's id: unique enough on one phone, never shown. */
function entryId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** The waits between two tries of the same entry when the network failed: two seconds, doubling, at most thirty. */
const retryDelay = (failures: number) => Math.min(30_000, 2_000 * 2 ** Math.max(0, failures - 1));

const BIG_SX = { minHeight: 56, fontSize: "1.125rem" } as const;

/** Nothing to watch: `useSyncExternalStore`'s way of saying «true in the browser, false on the server and while hydrating». */
const NOTHING_TO_WATCH = () => () => {};

export default function FinishLine({ eventId, uiLocale, initial, words, record, undo, recordForm, undoForm }: Props) {
  const storageKey = finishStorageKey(eventId);
  // The presses and the kept times: this phone's, behind the store the storage is read into (`finish-line-store.ts`) — empty on the
  // server and while hydrating, so the markup is the same with storage or without.
  const line = useSyncExternalStore(subscribeFinishLine, () => finishLineSnapshot(storageKey), () => EMPTY_FINISH_LINE);
  const entries = line.entries;
  const kept = line.kept;
  const hydrated = useSyncExternalStore(NOTHING_TO_WATCH, () => true, () => false);
  // The newest state the server answered with; the page's own while none is newer (a page drawn again after «Start» brings its own).
  const [answered, setAnswered] = useState<FinishLineState | null>(null);
  const state = answered && answered.serverNowMs >= initial.serverNowMs ? answered : initial;
  const [offline, setOffline] = useState(false);
  const [session, setSession] = useState(false);
  const [hint, setHint] = useState(false);
  const [undoLines, setUndoLines] = useState<Record<string, string>>({});
  // The server's clock, re-read every second for the clock and for «Anulează»'s ten minutes; the server's own `now` until the first tick.
  const [nowMs, setNowMs] = useState(initial.serverNowMs);

  const anchor = useRef<ServerAnchor>(anchorAtLoad(initial.serverNowMs, 0));
  const pumping = useRef(false);
  const failures = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionEnded = useRef(false);
  const box = useRef<HTMLInputElement>(null);

  const serverNow = useCallback(() => serverNowOf(anchor.current, localNow()), []);
  const commitEntries = useCallback(
    (change: (current: FinishEntry[]) => FinishEntry[]) => writeFinishLine(storageKey, (current) => ({ ...current, entries: change(current.entries) })),
    [storageKey],
  );
  const commitKept = useCallback((change: (current: number[]) => number[]) => writeFinishLine(storageKey, (current) => ({ ...current, kept: change(current.kept) })), [storageKey]);

  /** A state the server answered with, kept when it is the newest one heard. */
  const adopt = useCallback((next: FinishLineState) => {
    setAnswered((current) => (current && current.serverNowMs > next.serverNowMs ? current : next));
  }, []);

  /** Sends what waits, one at a time in the order pressed, until nothing waits or the network fails (then it tries again later). */
  const pump = useCallback(async () => {
    if (pumping.current) return;
    pumping.current = true;
    try {
      for (;;) {
        const next = nextToSend(finishLineSnapshot(storageKey).entries);
        if (!next || sessionEnded.current) break;
        const sentAt = localNow();
        let answer: FinishPressAnswer;
        try {
          answer = await record({ eventId, bibNumber: next.bibNumber, claimedAtMs: next.pressedAtMs });
        } catch {
          // No answer — no signal, a server that did not reply: the entry waits, and is tried again by itself.
          failures.current += 1;
          setOffline(true);
          if (retryTimer.current) clearTimeout(retryTimer.current);
          retryTimer.current = setTimeout(() => void pump(), retryDelay(failures.current));
          break;
        }
        failures.current = 0;
        setOffline(false);
        if (answer.kind === "session") {
          sessionEnded.current = true;
          setSession(true);
          break;
        }
        if (answer.state) {
          anchor.current = anchorFromAnswer(answer.state.serverNowMs, sentAt, localNow());
          adopt(answer.state);
        }
        const outcome: FinishEntryOutcome = answer.outcome;
        commitEntries((current) => settleEntry(current, next.id, outcome));
      }
    } finally {
      pumping.current = false;
    }
  }, [adopt, commitEntries, eventId, record, storageKey]);

  // Waking: the server's clock from here on, the clock ticking, and whatever this phone kept waiting sent at once.
  useEffect(() => {
    anchor.current = anchorAtLoad(initial.serverNowMs, localNow());
    const tick = setInterval(() => setNowMs(serverNowOf(anchor.current, localNow())), 1000);
    const online = () => void pump();
    window.addEventListener("online", online);
    void pump();
    return () => {
      clearInterval(tick);
      window.removeEventListener("online", online);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
    // Once per page: the event and its storage do not change under a mounted island.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** One press: the moment — the oldest kept one, else now on the server's clock — a line at once, and the queue on its way. */
  const press = useCallback(
    (bibNumber: number, label: string | null) => {
      const taken = takeOldestKept(finishLineSnapshot(storageKey).kept);
      if (taken.atMs !== null) commitKept(() => taken.rest);
      const pressedAtMs = taken.atMs ?? serverNow();
      commitEntries((current) => pressEntry(current, { id: entryId(), bibNumber, label, pressedAtMs }));
      void pump();
    },
    [commitEntries, commitKept, pump, serverNow, storageKey],
  );

  const onBox = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = box.current;
    const typed = (input?.value ?? "").trim();
    if (input) {
      input.value = "";
      input.focus();
    }
    if (typed === "") return;
    if (!/^\d{1,6}$/.test(typed) || Number(typed) <= 0) {
      setHint(true);
      return;
    }
    setHint(false);
    press(Number(typed), null);
  };

  // The elite button behind the form's submit: the event's own `submitter`, or — a browser without it — the button last clicked.
  const lastElite = useRef<string | null>(null);
  const onElite = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null | undefined;
    const bibNumber = Number(submitter?.value ?? lastElite.current ?? "");
    lastElite.current = null;
    if (!Number.isInteger(bibNumber) || bibNumber <= 0) return;
    const elite = state.elites.find((candidate) => candidate.bibNumber === bibNumber);
    // A finished elite's button is drawn disabled; a press from a page that had not heard yet is the server's to call a duplicate.
    press(bibNumber, elite?.label ?? null);
  };

  const onUndo = async (event: FormEvent<HTMLFormElement>, line: RecentFinisherView) => {
    event.preventDefault();
    const sentAt = localNow();
    let answer: FinishUndoAnswer;
    try {
      answer = await undo({ eventId, resultId: line.resultId });
    } catch {
      setOffline(true);
      return;
    }
    setOffline(false);
    if (answer.kind === "session") {
      setSession(true);
      return;
    }
    if (answer.state) {
      anchor.current = anchorFromAnswer(answer.state.serverNowMs, sentAt, localNow());
      adopt(answer.state);
    }
    const outcome = answer.outcome;
    setUndoLines((current) => ({
      ...current,
      [line.resultId]: outcome.kind === "undone" ? words.undone : (words.undoRefused[outcome.code] ?? words.undoRefusedOther),
    }));
  };

  const time = (ms: number | null) => (ms === null ? "—" : formatResultTime(ms));
  const clockAt = (ms: number) => formatTimeWithSeconds(new Date(ms), { locale: uiLocale, timeZone: CLUB_TIME_ZONE });
  const who = (bibNumber: number, label: string | null) => (label ? `${label} (#${bibNumber})` : `#${bibNumber}`);
  const reading = clockReading(nowMs, state.gunAtMs);
  const waiting = waitingCount(entries);

  /** What an entry's line says. */
  const entryLine = (entry: FinishEntry): string => {
    const head = who(entry.bibNumber, entry.label ?? (entry.outcome && "label" in entry.outcome ? entry.outcome.label : null));
    const pressed = entry.pressedAtMs >= state.gunAtMs ? time(stampedGunTime(entry.pressedAtMs, state.gunAtMs)) : "—";
    const outcome = entry.outcome;
    if (!outcome) return `${head} · ${pressed} · ${words.waiting}`;
    if (outcome.kind === "recorded") {
      const place = outcome.outOfRanking ? words.outOfRanking : outcome.positionOverall === null ? null : fill(words.place, { position: String(outcome.positionOverall) });
      return [`✓ ${head}${outcome.name ? ` ${outcome.name}` : ""}`, time(outcome.gunTimeMs), place, words.saved].filter(Boolean).join(" · ");
    }
    if (outcome.kind === "duplicate") {
      return `${head} ${fill(words.duplicate, { by: outcome.storedBy ?? words.accountGone, time: time(outcome.storedGunTimeMs), mine: time(outcome.gunTimeMs) })}`;
    }
    const template = words.refused[outcome.code] ?? words.refusedOther;
    return `${head}: ${fill(template, { time: outcome.gunTimeMs === null ? pressed : time(outcome.gunTimeMs), clock: clockAt(entry.pressedAtMs) })}`;
  };

  const recentLine = (line: RecentFinisherView): string => {
    const place = line.outOfRanking ? words.outOfRanking : line.positionOverall === null ? null : fill(words.place, { position: String(line.positionOverall) });
    const by = fill(line.changed ? words.changedBy : words.enteredBy, { name: line.by ?? words.accountGone });
    return [`${who(line.bibNumber, line.label)}${line.name ? ` ${line.name}` : ""}`, time(line.gunTimeMs), place, by].filter(Boolean).join(" · ");
  };

  const hidden = (
    <>
      <input type="hidden" name="uiLocale" value={uiLocale} />
      <input type="hidden" name="eventId" value={eventId} />
    </>
  );

  const eliteButton = (elite: EliteButtonView) => {
    const disabled = elite.bibNumber === null || elite.finishedGunTimeMs !== null;
    return (
      <Box key={elite.key} sx={{ display: "grid", gap: 0.5, alignContent: "start" }} data-testid="finish-elite" data-bib={elite.bibNumber ?? ""}>
        <GlyphButton
          type="submit"
          name="bib"
          value={elite.bibNumber === null ? "" : String(elite.bibNumber)}
          icon="elite"
          variant="contained"
          color={elite.finishedGunTimeMs === null ? "primary" : "success"}
          disabled={disabled}
          aria-label={fill(words.eliteAria, { label: elite.label, name: elite.name })}
          onClick={() => {
            lastElite.current = elite.bibNumber === null ? null : String(elite.bibNumber);
          }}
          sx={{ minHeight: 64, justifyContent: "flex-start", textAlign: "left", textTransform: "none", width: "100%" }}
          data-testid="finish-elite-button"
        >
          <Box component="span" sx={{ display: "grid", minWidth: 0 }}>
            <Box component="span" sx={{ fontSize: "1.25rem", fontWeight: 700, lineHeight: 1.2, overflowWrap: "anywhere" }}>
              {elite.label}
            </Box>
            <Box component="span" sx={{ fontSize: "0.75rem", lineHeight: 1.3, overflowWrap: "anywhere" }}>
              {elite.finishedGunTimeMs === null ? elite.name : `${elite.name} · ${fill(words.eliteFinished, { time: time(elite.finishedGunTimeMs) })}`}
            </Box>
          </Box>
        </GlyphButton>
        {elite.bibNumber === null && (
          <Typography variant="caption" color="text.secondary" data-testid="finish-elite-no-number">
            {elite.kind === "line" ? words.eliteNoNumberLine : words.eliteNoNumberRegistration}
          </Typography>
        )}
      </Box>
    );
  };

  return (
    <Stack spacing={2} data-testid="finish-line">
      <Typography variant="h4" component="p" sx={{ fontVariantNumeric: "tabular-nums" }} suppressHydrationWarning data-testid="finish-clock">
        {reading === null ? words.notStarted : fill(words.clock, { time: formatResultTime(reading) })}
      </Typography>

      {session && (
        <Alert severity="warning" data-testid="finish-session">
          {words.session}
        </Alert>
      )}
      {offline && !session && (
        <Alert severity="warning" data-testid="finish-offline">
          {words.offline}
        </Alert>
      )}

      {state.elites.length > 0 && (
        <Box component="section" aria-labelledby="finish-elites-title" data-testid="finish-elites">
          <Typography id="finish-elites-title" variant="subtitle1" component="p" sx={{ fontWeight: 700 }}>
            {words.elitesTitle}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {words.elitesHelp}
          </Typography>
          {/* One form for every elite: with scripts off the button pressed posts its number; with them the island records it at once. */}
          <Box component="form" action={recordForm} onSubmit={onElite} sx={{ display: "grid", gap: 1, gridTemplateColumns: "repeat(auto-fill, minmax(136px, 1fr))" }}>
            {hidden}
            {state.elites.map(eliteButton)}
          </Box>
        </Box>
      )}

      {/* The box: the numeric keypad, Enter or «Sosit», empty at once for the next number. */}
      <Box component="form" action={recordForm} onSubmit={onBox} autoComplete="off" data-testid="finish-form">
        {hidden}
        <Stack direction="row" sx={{ gap: 1, alignItems: "stretch", flexWrap: "wrap" }}>
          <Box
            component="input"
            ref={box}
            name="bib"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoFocus
            enterKeyHint="done"
            autoComplete="off"
            aria-label={words.boxLabel}
            placeholder={words.boxLabel}
            data-testid="finish-bib"
            sx={{
              flex: "1 1 160px",
              minWidth: 0,
              minHeight: 64,
              px: 1.5,
              font: "inherit",
              fontSize: "2rem",
              fontVariantNumeric: "tabular-nums",
              color: "text.primary",
              bgcolor: "background.paper",
              border: 2,
              borderColor: "divider",
              borderRadius: 1,
              "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 1 },
              "&::placeholder": { fontSize: "1rem" },
            }}
          />
          <GlyphButton type="submit" icon="checkIn" variant="contained" sx={{ ...BIG_SX, minHeight: 64, flex: "0 0 auto", px: 3 }} data-testid="finish-record">
            {words.record}
          </GlyphButton>
        </Stack>
        {hint && (
          <Typography variant="caption" color="error" sx={{ display: "block", mt: 0.5 }} data-testid="finish-bib-hint">
            {words.bibHint}
          </Typography>
        )}
      </Box>

      {/* «⏱ Prinde timpul» works only in the page: with scripts off there is nothing to keep a moment in, so it is not drawn. */}
      {hydrated && (
        <Box data-testid="finish-keep">
          <Stack direction="row" sx={{ gap: 1, alignItems: "center", flexWrap: "wrap" }}>
            <GlyphButton type="button" icon="keepTime" variant="outlined" sx={BIG_SX} onClick={() => commitKept((current) => keepTime(current, serverNow()))} data-testid="finish-keep-button">
              {words.keep}
            </GlyphButton>
            {kept.length > 0 && (
              <Typography variant="body2" component="span" sx={{ fontWeight: 600 }}>
                {words.keptTitle}:
              </Typography>
            )}
            {kept.map((atMs, index) => {
              const label = atMs >= state.gunAtMs ? time(stampedGunTime(atMs, state.gunAtMs)) : clockAt(atMs);
              return (
                <GlyphButton
                  key={`${atMs}-${index}`}
                  type="button"
                  icon="dismiss"
                  variant="outlined"
                  size="small"
                  sx={{ minHeight: 44, fontVariantNumeric: "tabular-nums" }}
                  aria-label={fill(words.keptDrop, { time: label })}
                  onClick={() => commitKept((current) => dropKept(current, index))}
                  data-testid="finish-kept"
                >
                  {label}
                </GlyphButton>
              );
            })}
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
            {words.keepHelp}
          </Typography>
        </Box>
      )}

      {hydrated && entries.length > 0 && (
        <Box component="section" aria-labelledby="finish-entries-title" data-testid="finish-entries">
          <Typography id="finish-entries-title" variant="subtitle1" component="p" sx={{ fontWeight: 700 }}>
            {words.entriesTitle}
            {waiting > 0 ? ` · ${fill(words.waitingCount, { count: String(waiting) })}` : ""}
          </Typography>
          <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none", display: "grid", gap: 0.5 }}>
            {[...entries].reverse().map((entry) => {
              const kind = entryStateOf(entry);
              return (
                <Typography
                  component="li"
                  variant="body2"
                  key={entry.id}
                  color={kind === "waiting" ? "text.secondary" : kind === "saved" ? "success.main" : kind === "duplicate" ? "warning.main" : "error.main"}
                  sx={{ fontWeight: kind === "refused" || kind === "duplicate" ? 600 : 400, overflowWrap: "anywhere" }}
                  data-testid="finish-entry"
                  data-state={kind}
                  data-bib={entry.bibNumber}
                >
                  {entryLine(entry)}
                </Typography>
              );
            })}
          </Box>
        </Box>
      )}

      <Box component="section" aria-labelledby="finish-recent-title" data-testid="finish-recent">
        <Typography id="finish-recent-title" variant="subtitle1" component="p" sx={{ fontWeight: 700 }}>
          {words.recentTitle}{" "}
          <Typography component="span" variant="body2" color="text.secondary">
            {fill(words.recentAside, { finished: String(state.finished), withNumber: String(state.withNumber) })}
          </Typography>
        </Typography>
        {state.recent.length === 0 ? (
          <Typography variant="body2" color="text.secondary" data-testid="finish-recent-empty">
            {words.recentEmpty}
          </Typography>
        ) : (
          <Box component="ol" sx={{ m: 0, pl: 2.5, display: "grid", gap: 0.75 }}>
            {state.recent.map((line) => {
              const undoable = line.undoUntilMs !== null && nowMs <= line.undoUntilMs && undoLines[line.resultId] === undefined;
              return (
                <Box component="li" key={line.resultId} data-testid="finish-recent-row" data-bib={line.bibNumber}>
                  <Stack direction="row" sx={{ gap: 1, alignItems: "center", flexWrap: "wrap" }}>
                    <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                      {recentLine(line)}
                    </Typography>
                    {undoable && (
                      <Box component="form" action={undoForm} onSubmit={(event: FormEvent<HTMLFormElement>) => void onUndo(event, line)}>
                        {hidden}
                        <input type="hidden" name="resultId" value={line.resultId} />
                        <GlyphButton
                          type="submit"
                          icon="undo"
                          variant="text"
                          size="small"
                          sx={{ minHeight: 44 }}
                          aria-label={fill(words.undoAria, { who: who(line.bibNumber, line.label) })}
                          data-testid="finish-undo"
                        >
                          {words.undo}
                        </GlyphButton>
                      </Box>
                    )}
                    {undoLines[line.resultId] !== undefined && (
                      <Typography variant="caption" color="text.secondary" data-testid="finish-undo-line">
                        {undoLines[line.resultId]}
                      </Typography>
                    )}
                  </Stack>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
    </Stack>
  );
}
