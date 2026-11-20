"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { unstable_isUnrecognizedActionError } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { countForm, type CountForm } from "@/i18n/count-form";
import { CLUB_TIME_ZONE, formatTimeWithSeconds } from "@/i18n/dates";
import ConfirmDialog from "@/shared/feedback/ConfirmDialog";
import type { ConfirmSpec } from "@/shared/feedback/notice";
import GlyphButton from "@/shared/ui/GlyphButton";
import {
  asksBeforeAgain,
  clockReading,
  dropKept,
  type EliteAgain,
  type EliteButtonView,
  entryStateOf,
  FINISH_GUN_ASK_MS,
  FINISH_PRESS_SLOW_MS,
  type FinishClockAnswer,
  type FinishEntry,
  type FinishEntryOutcome,
  type FinishLineState,
  type FinishPressAnswer,
  type FinishUndoAnswer,
  finishRetryDelay,
  finishStorageKey,
  type HeardGun,
  holdAfterFailure,
  keepTime,
  keptAfterPress,
  keptAge,
  keptOf,
  lineGun,
  markUndone,
  nextRetryAt,
  nextToSend,
  pressEntry,
  type RecentFinisherView,
  settleEntry,
  stampedGunTime,
  staleKept,
  type TapMoment,
  tapMoment,
  waitingCount,
  withoutSettled,
  withKept,
} from "../domain/finish-line";
import { EMPTY_FINISH_LINE, finishLineSnapshot, NO_WAITING_ELSEWHERE, subscribeFinishLine, waitingElsewhereSnapshot, writeFinishLine } from "./finish-line-store";
import { formatResultTime } from "../domain/result-time";
import { measureServerClock, seedServerClock, serverClockNow } from "./server-clock";

/**
 * «Cronometrare»'s finish line (§986; the owner, 2026-11-18: «un view rapid, în care să introduc și să se salveze instant, gen că a
 * ajuns NR X, Y, Z» — «elitele trebuie să fie primii» — «ca s-ar putea să ajungă mulți deodată»): the page's one island, over plain
 * server-rendered forms — with scripts off every button posts its form and the page comes back with a sentence, as «Sosire» did.
 *
 * With scripts on, a press never waits for the network:
 *
 * - **The elites first**: one big button an elite, the bib's label large and the full name under it; pressing it records that
 *   elite's number. A line with no number is drawn disabled with what to do — or, for a viewer who writes the elite list
 *   (`mayNumber`), in its place «Dă-i un număr» (§990), a plain form that gives the line the race's next free number and comes back
 *   with the line's button like every other —; one already «Sosit» says «✓ <time>» and is not pressed.
 * - **The box**: the numeric keypad, Enter or «Sosit» records, and the box is empty at once, keeping the focus for the next number.
 *   **A finished elite's number typed again is asked first** (§1010): an elite already «Sosit» as this page last heard — at its load or
 *   in the answer to any press since — or whose press waits or was saved on this phone (`asksBeforeAgain`) gets the house's one dialog
 *   (`ConfirmDialog`), «Anulează» focused, so a second Enter or Esc cancels: nothing is recorded and no kept moment is used.
 *   «Trece numărul din nou» records the press at the moment of the tap — read as «Sosit» was pressed (`tapMoment`), never at the
 *   answer — and the server keeps the first time as for any number pressed twice. The box is empty and focused either way, inside the
 *   answer's own tap, so a phone's keyboard comes back with it. Any other number, an elite who has not crossed yet, and one whose
 *   crossing this page has not heard of — pressed on another phone since its last answer — go at once as before; the server keeps the
 *   first time all the same.
 * - **«⏱ Finish»** for a bunch: each press keeps one moment (oldest first, each with its age and its ✕); the next number or
 *   elite pressed takes the oldest kept moment instead of now — one older than ten minutes is no bunch any more: it is dropped when
 *   the line is read or pressed, and a line says its time, for paper (`staleKept`).
 * - **The times** are stamped at the press on the server's clock (`server-clock.ts`: the phone's wall clock and the offset measured
 *   by a round trip as the page wakes — again every time it is shown — and by every answer), so a phone whose clock is wrong, or
 *   whose screen locked between two finishers, stamps right; the server floors them and holds them to its bounds.
 * - **The gun** comes with the clock's every answer (§986): «Start» is pressed on the organizer's phone, so a page drawn before it —
 *   every volunteer's at the line — counts from it at the next answer; while no finisher is stored the clock is asked every half
 *   minute too (`FINISH_GUN_ASK_MS`), and the newer of that gun and the last press's answer is the one the line counts from
 *   (`lineGun`). The sentence above the clock is that gun's — «Startul: … · apăsat de …», or the plan while nobody pressed it —, never
 *   the one the page was drawn with; and the clock's answer says whether a «Sosit» is stored on any phone, which ends the half-minute
 *   question as this page's own first finisher does.
 * - **The queue**: every press is a line under the box at once («se salvează…») and is sent through the Server Action in the order
 *   pressed, with its own id; an unsent one waits in this phone's storage for this event (every read and write in a `try`: without
 *   storage the page works, it only forgets on a reload), is retried by itself, and a reload sends what is left. A second tab of the
 *   event writes over none of it (`finish-line-store.ts`), and presses waiting under another event are named above the box — only
 *   that event's page sends them. Each is the press of the account signed in when it was pressed and is sent only from that
 *   account's page: another account's, left on this phone, stands on its line unsent with the time to write on paper, so the trail
 *   never names somebody who did not press. A press the server already had — its id in the trail — is shown saved; one that another
 *   volunteer — or this one, pressed again — had stored first says who and when, and one whose runner «Clasament» wrote off says so;
 *   a refusal stands on its line with the time to write on paper, never blocking the box. A press the server could not record waits
 *   on its line with its time and is tried again and again, the presses after it going meanwhile, until the server answers it. An
 *   elite's button waits while its press does, so a double tap is one press. A site updated under the page asks for a reload, the
 *   presses waiting.
 * - **«Ultimii sosiți»**, refreshed from every answer: who entered each, and «Anulează» on one's own for ten minutes — or, the number
 *   pressed again since, the line that says «Clasament» corrects it. Undone, the phone's own line of the press says «anulat»
 *   (`markUndone`), never «salvat» for a runner whose result is gone.
 *
 * Plain data crosses the boundary — strings, numbers, booleans and the Server Actions — never an element (`AGENTS.md` §14.1); the
 * glyphs are named (`GlyphButton`).
 */

/** The words of the island, in the page's language: templates the island fills itself (`{time}`, `{bib}`…). */
export type FinishLineWords = {
  /** The gun's sentence once «Start» was pressed: «Startul: {time} · apăsat de {by}»… */
  gunPressed: string;
  /** …and, while nobody pressed it, the plan's, whole: «Startul planificat: … Până la «Start», sosirile se numără de la el.». */
  gunPlanned: string;
  clock: string;
  notStarted: string;
  elitesTitle: string;
  elitesHelp: string;
  eliteAria: string;
  eliteFinished: string;
  eliteNoNumberLine: string;
  eliteNoNumberRegistration: string;
  /** «Dă-i un număr» on a line drawn without a number, for a viewer who writes the elite list (§990), and its name for a reader: «… {label} — {name}». */
  eliteGiveNumber: string;
  eliteGiveNumberAria: string;
  /**
   * A finished elite's number typed again, asked first (§1010): the question's title; its body — «{label} ({name}) a sosit deja la
   * {time}. Treci numărul din nou?», and with who entered the time, `bodyBy`'s «… la {time} — {by}. …», `{by}` being `enteredBy` or
   * `changedBy` filled —; what a second press does; and its two answers. Words of the number, never of the person: the elites are men
   * and women.
   */
  eliteAgain: { title: string; body: string; bodyBy: string; second: string; cancel: string; confirm: string };
  boxLabel: string;
  bibHint: string;
  record: string;
  keep: string;
  keepHelp: string;
  keptTitle: string;
  keptDrop: string;
  /** A kept moment's age on its chip: «acum {count} s» under a minute, «acum {count} min» after. */
  keptAgeSeconds: string;
  keptAgeMinutes: string;
  /** Kept moments older than ten minutes, dropped: «{times}» to be written on paper, by `countForm`. */
  keptStale: Record<CountForm, string>;
  /** The volunteer wrote them down: the line goes. */
  keptStaleDone: string;
  entriesTitle: string;
  /** «Golește lista»: the lines the server already answered go from this phone; what has not left stays (§1001). */
  entriesClear: string;
  waiting: string;
  saved: string;
  place: string;
  outOfRanking: string;
  duplicate: string;
  /** A press of a number «Clasament» wrote off — «{status}» stays. */
  decided: string;
  /** Another account's press, left on this phone unsent. */
  otherAccount: string;
  /** The words of each state a stored row may have (`FINISHED`, `DNF`, `DNS`, `DSQ`). */
  status: Record<string, string>;
  refused: Record<string, string>;
  refusedOther: string;
  accountGone: string;
  offline: string;
  session: string;
  /** The site was updated under the page: reload it, the presses waiting. */
  reload: string;
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
  /** Why one's own press of the last ten minutes has no «Anulează»: its number pressed again since, by another account or by oneself. */
  undoPressedAgain: { other: string; self: string };
  /** Presses waiting under another event on this phone: «{count} apăsări așteaptă la {event}», by `countForm`. */
  elsewhere: Record<CountForm, string>;
  /** The link to that event's page. */
  elsewhereOpen: string;
  /** That event, when its line keeps no title. */
  elsewhereUnnamed: string;
};

type Props = {
  eventId: string;
  /** The event's title, kept with its line on the phone, so another event's page can say where presses wait; null for none. */
  eventTitle: string | null;
  uiLocale: string;
  /** The event's time zone, the gun's hour said in it — as the page says it. */
  timeZone: string;
  /** The viewer's staff account: the presses this page sends are its own; another account's, left on the phone, are only shown. */
  staffId: string;
  /** The page's state as the server drew it: the gun, «Ultimii sosiți», the elites, the counts and the server's clock. */
  initial: FinishLineState;
  words: FinishLineWords;
  /** The Server Actions the island calls (`cronometrare/actions.ts`). */
  record: (input: unknown) => Promise<FinishPressAnswer>;
  undo: (input: unknown) => Promise<FinishUndoAnswer>;
  /** The server's clock and the gun, asked as the page wakes, when it is shown again and, before the first finisher, every half minute. */
  clock: (input: unknown) => Promise<FinishClockAnswer>;
  /** …and the ones the forms post with scripts off. */
  recordForm: (form: FormData) => Promise<void>;
  undoForm: (form: FormData) => Promise<void>;
  /**
   * Whether the viewer writes the race's elite list (`canManageRegistrations`): only then is a line drawn without a number
   * «Dă-i un număr» (§990) — the server asks again — and `numberForm` is the plain form's action (`giveEliteNumberFormAction`).
   */
  mayNumber: boolean;
  numberForm: (form: FormData) => Promise<void>;
};

/** The one plain form «Dă-i un număr» posts (§990), beside the elites' form — forms cannot nest —, each button naming its line. */
const NUMBER_FORM_ID = "finish-elite-number";

/** A template's placeholders filled; a placeholder with no value is left as written. */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => values[name] ?? placeholder);
}

/**
 * The question a finished elite's number typed again asks first (§1010), in the page's words: «{label} ({name}) a sosit deja la {time}
 * — introdus de {by}. Treci numărul din nou?» — who entered it said as «Ultimii sosiți» says it, «modificat de» once «Clasament» changed
 * it, and left out while the elite is not among them —, what a second press does, and its two answers. `destructive`, so Enter never
 * answers «Trece numărul din nou»: it reaches the focused «Anulează», as Esc does, and only that button's own press records. Apart from
 * the island so a Node render reads it in both languages.
 */
export function eliteAgainQuestion(words: FinishLineWords, again: EliteAgain): ConfirmSpec {
  const stored = again.stored;
  const by = stored ? fill(stored.changed ? words.changedBy : words.enteredBy, { name: stored.by ?? words.accountGone }) : null;
  const values = { label: again.elite.label, name: again.elite.name, time: formatResultTime(again.gunTimeMs), by: by ?? "" };
  return {
    title: words.eliteAgain.title,
    body: fill(by === null ? words.eliteAgain.body : words.eliteAgain.bodyBy, values),
    also: [{ text: words.eliteAgain.second }],
    confirmLabel: words.eliteAgain.confirm,
    cancelLabel: words.eliteAgain.cancel,
    destructive: true,
  };
}

/** The phone's wall clock, which keeps time while the screen is locked: the round trips are measured on it (`server-clock.ts`). */
const wallNow = () => Date.now();

/**
 * A press's own id, never shown: a UUID, which the server keeps in the trail and knows its retry by — `randomUUID` where the browser
 * has it (a secure page), else the same shape from `getRandomValues`, else from `Math.random` (version 4, its variant bits set): an
 * old browser presses as any other, never an error.
 */
function entryId(): string {
  const random = typeof crypto === "undefined" ? undefined : crypto;
  if (typeof random?.randomUUID === "function") return random.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof random?.getRandomValues === "function") random.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const BIG_SX = { minHeight: 56, fontSize: "1.125rem" } as const;

/** Nothing to watch: `useSyncExternalStore`'s way of saying «true in the browser, false on the server and while hydrating». */
const NOTHING_TO_WATCH = () => () => {};

export default function FinishLine({ eventId, eventTitle, uiLocale, timeZone, staffId, initial, words, record, undo, clock, recordForm, undoForm, mayNumber, numberForm }: Props) {
  const storageKey = finishStorageKey(eventId);
  // The presses and the kept times: this phone's, behind the store the storage is read into (`finish-line-store.ts`) — empty on the
  // server and while hydrating, so the markup is the same with storage or without.
  const line = useSyncExternalStore(subscribeFinishLine, () => finishLineSnapshot(storageKey), () => EMPTY_FINISH_LINE);
  const entries = line.entries;
  const kept = keptOf(line, staffId);
  // The viewer's presses waiting under another event on this phone: said above the box, since only that event's page sends them.
  const elsewhere = useSyncExternalStore(subscribeFinishLine, () => waitingElsewhereSnapshot(storageKey, staffId), () => NO_WAITING_ELSEWHERE);
  const hydrated = useSyncExternalStore(NOTHING_TO_WATCH, () => true, () => false);
  // The newest state the server answered with; the page's own while none is newer (a page drawn again after «Start» brings its own).
  const [answered, setAnswered] = useState<FinishLineState | null>(null);
  const state = answered && answered.serverNowMs >= initial.serverNowMs ? answered : initial;
  const [offline, setOffline] = useState(false);
  const [session, setSession] = useState(false);
  const [reload, setReload] = useState(false);
  const [hint, setHint] = useState(false);
  const [undoLines, setUndoLines] = useState<Record<string, string>>({});
  // The server's clock, re-read every second for the clock and for «Anulează»'s ten minutes; the server's own `now` until the first tick.
  const [nowMs, setNowMs] = useState(initial.serverNowMs);
  // The gun as the clock's question last heard it (§986): «Start» pressed on another phone reaches this page by it, with who pressed
  // it and whether a finisher is stored.
  const [heardGun, setHeardGun] = useState<HeardGun | null>(null);
  // The kept moments dropped for being older than ten minutes: their times, said on the line for paper until the volunteer clears it.
  const [staleTimes, setStaleTimes] = useState<number[]>([]);
  // A finished elite's number typed again (§1010): the question, the number and the moment its tap read — kept while the dialog closes,
  // so its words fade with it — and whether it is open: only an open question's first answer counts, so a double tap answers once.
  const [asked, setAsked] = useState<{ bibNumber: number; tap: TapMoment; question: ConfirmSpec } | null>(null);
  const [askOpen, setAskOpen] = useState(false);

  const pumping = useRef(false);
  const failures = useRef(0);
  // The entries the server answered it could not record: each waits out its own backoff while the ones after it go (`nextToSend`).
  const held = useRef(new Map<string, { tries: number; untilMs: number }>());
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionEnded = useRef(false);
  // The site was deployed again under the page: its actions are gone until a reload, so nothing more is sent.
  const outdated = useRef(false);
  const box = useRef<HTMLInputElement>(null);

  // Each write keeps the event's title with its line, for another event's page to name it.
  const commitEntries = useCallback(
    (change: (current: FinishEntry[]) => FinishEntry[]) => writeFinishLine(storageKey, (current) => ({ ...current, title: eventTitle ?? current.title, entries: change(current.entries) })),
    [eventTitle, storageKey],
  );
  const commitKept = useCallback(
    (change: (current: number[]) => number[]) => writeFinishLine(storageKey, (current) => withKept({ ...current, title: eventTitle ?? current.title }, staffId, change(keptOf(current, staffId)))),
    [eventTitle, staffId, storageKey],
  );
  const markOutdated = useCallback(() => {
    outdated.current = true;
    setReload(true);
  }, []);

  /**
   * The server's clock asked over one round trip — as the page wakes, every time it is shown again and, before the first finisher,
   * every half minute — and with it the gun (§986): the newer of the gun it says and the last press's answer is the line's.
   */
  const askClock = useCallback(() => {
    const sentAtMs = wallNow();
    clock({ eventId }).then(
      (answer: FinishClockAnswer) => {
        if (answer.kind === "clock") {
          measureServerClock({ ...answer.clock, sentAtMs, backAtMs: wallNow() });
          const gunAtMs = answer.gunAtMs;
          const serverMs = answer.clock.answeredAtMs;
          const heard: HeardGun | null = gunAtMs === null ? null : { gunAtMs, serverMs, pressed: answer.gunPressed, byName: answer.gunByName, fixed: answer.gunFixed };
          if (heard) setHeardGun((current) => (current && current.serverMs > serverMs ? current : heard));
        } else if (answer.kind === "session") {
          sessionEnded.current = true;
          setSession(true);
        }
      },
      // No answer: the next answer measures the clock instead; a site deployed again asks for a reload.
      (error: unknown) => {
        if (unstable_isUnrecognizedActionError(error)) markOutdated();
      },
    );
  }, [clock, eventId, markOutdated]);

  /** The viewer's kept moments older than ten minutes dropped (`staleKept`), their times said on the line, for paper. */
  const sweepKept = useCallback(() => {
    const atMs = serverClockNow();
    const { stale } = staleKept(keptOf(finishLineSnapshot(storageKey), staffId), atMs);
    if (stale.length === 0) return;
    commitKept((current) => staleKept(current, atMs).fresh);
    setStaleTimes((current) => [...current, ...stale]);
  }, [commitKept, staffId, storageKey]);

  /** A state the server answered with, kept when it is the newest one heard. */
  const adopt = useCallback((next: FinishLineState) => {
    setAnswered((current) => (current && current.serverNowMs > next.serverNowMs ? current : next));
  }, []);

  /**
   * Sends what waits of the viewer's own, one at a time in the order pressed, until nothing waits, the network fails (then it tries
   * again later), the session ends or the site was updated under the page. A press the server could not record is held for its
   * backoff and the next ones go; when only held ones are left, the pump comes back for the first of them.
   */
  const pump = useCallback(async () => {
    if (pumping.current) return;
    pumping.current = true;
    const later = (delayMs: number) => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => void pump(), delayMs);
    };
    try {
      for (;;) {
        if (sessionEnded.current || outdated.current) break;
        const waiting = finishLineSnapshot(storageKey).entries;
        const next = nextToSend(waiting, staffId, held.current, wallNow());
        if (!next) {
          const retryAt = nextRetryAt(waiting, staffId, held.current);
          if (retryAt !== null) later(Math.max(0, retryAt - wallNow()));
          break;
        }
        const sentAtMs = wallNow();
        let answer: FinishPressAnswer;
        // A request that hangs — neither answered nor failed — is still awaited; after ten seconds the line says the signal is weak.
        const slow = setTimeout(() => setOffline(true), FINISH_PRESS_SLOW_MS);
        try {
          answer = await record({ eventId, staffId, bibNumber: next.bibNumber, claimedAtMs: next.pressedAtMs, pressId: next.id });
        } catch (error) {
          clearTimeout(slow);
          // The site deployed again: this page's actions are gone until a reload, which sends what waits.
          if (unstable_isUnrecognizedActionError(error)) {
            markOutdated();
            break;
          }
          // No answer — no signal, a server that did not reply: the entry waits, and is tried again by itself.
          failures.current += 1;
          setOffline(true);
          later(finishRetryDelay(failures.current));
          break;
        }
        clearTimeout(slow);
        failures.current = 0;
        setOffline(false);
        if (answer.kind === "session") {
          sessionEnded.current = true;
          setSession(true);
          break;
        }
        if (answer.kind === "failed") {
          // The site answered but could not record it — a passing database error, a bunch finish's busiest second: the press stays
          // waiting with its time, is tried again after its backoff and again after that, and the presses after it go meanwhile.
          held.current.set(next.id, holdAfterFailure(held.current, next.id, wallNow()));
          continue;
        }
        held.current.delete(next.id);
        measureServerClock({ ...answer.clock, sentAtMs, backAtMs: wallNow() });
        if (answer.state) adopt(answer.state);
        const outcome: FinishEntryOutcome = answer.outcome;
        commitEntries((current) => settleEntry(current, next.id, outcome));
      }
    } finally {
      pumping.current = false;
    }
  }, [adopt, commitEntries, eventId, markOutdated, record, staffId, storageKey]);

  // Waking: the server's clock and the gun asked, the clock ticking, a kept moment too old dropped, whatever this phone kept waiting
  // sent at once — and all of it again every time the page is shown, comes back from the browser's memory or finds its signal again.
  useEffect(() => {
    seedServerClock(initial.serverNowMs);
    const tick = setInterval(() => {
      setNowMs(serverClockNow());
      sweepKept();
    }, 1000);
    const wake = () => {
      askClock();
      sweepKept();
      void pump();
    };
    const shown = () => {
      if (document.visibilityState === "visible") wake();
    };
    window.addEventListener("online", wake);
    window.addEventListener("pageshow", wake);
    document.addEventListener("visibilitychange", shown);
    // A kept moment gone stale while the page was closed is dropped by the first tick, a second from now: never in this body.
    askClock();
    void pump();
    return () => {
      clearInterval(tick);
      window.removeEventListener("online", wake);
      window.removeEventListener("pageshow", wake);
      document.removeEventListener("visibilitychange", shown);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
    // Once per page: the event and its storage do not change under a mounted island.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The gun the line counts from and says: the newer of the last state the server answered with and the clock's question (§986).
  const gun = lineGun(state, heardGun);

  // Before the first finisher the gun may still be pressed, moved or taken off — on the organizer's phone: the clock, which carries it,
  // is asked every half minute while the page is shown. From the first finisher the gun is fixed, and nothing is asked on a timer —
  // the first finisher of any phone: the clock's answer says one is stored, so a phone that records nobody stops asking too.
  const noFinisherYet = !gun.fixed;
  useEffect(() => {
    if (!noFinisherYet) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") askClock();
    }, FINISH_GUN_ASK_MS);
    return () => clearInterval(timer);
  }, [askClock, noFinisherYet]);

  /**
   * The moment a tap reads as it is pressed (`tapMoment`, §1010): the oldest kept one still young (ten minutes), else now on the server's
   * clock — handed to `press`, at once or after the question a finished elite's number asks.
   */
  const tapNow = useCallback(() => tapMoment(keptOf(finishLineSnapshot(storageKey), staffId), serverClockNow()), [staffId, storageKey]);

  /**
   * One press, at the moment its tap read: a line at once, and the queue on its way. The kept moment the tap took leaves the kept ones;
   * any other older than ten minutes is dropped and said on the line, for paper (`keptAfterPress`).
   */
  const press = useCallback(
    (bibNumber: number, label: string | null, tap: TapMoment) => {
      const kept = keptOf(finishLineSnapshot(storageKey), staffId);
      const { rest, stale } = keptAfterPress(kept, tap.kept, serverClockNow());
      const taken = tap.kept;
      // A question left open past the ten minutes of the moment its tap took: the sweep said that moment for paper, yet it went to this
      // number — off the paper line, then.
      if (taken !== null && !kept.includes(taken)) {
        setStaleTimes((current) => {
          const at = current.indexOf(taken);
          return at < 0 ? current : current.filter((_, index) => index !== at);
        });
      }
      if (stale.length > 0) setStaleTimes((current) => [...current, ...stale]);
      if (rest.length !== kept.length) commitKept(() => rest);
      commitEntries((current) => pressEntry(current, { id: entryId(), staffId, bibNumber, label, pressedAtMs: tap.atMs }));
      void pump();
    },
    [commitEntries, commitKept, pump, staffId, storageKey],
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
    const bibNumber = Number(typed);
    // The moment is the tap's, read now — whether the number goes at once or after the question below (§1010).
    const tap = tapNow();
    // An elite already «Sosit», or whose press waits or was saved on this phone: asked first, nothing pressed yet (§1010).
    const again = asksBeforeAgain(bibNumber, state, finishLineSnapshot(storageKey).entries, staffId, gun.atMs);
    if (again) {
      setAsked({ bibNumber, tap, question: eliteAgainQuestion(words, again) });
      setAskOpen(true);
      return;
    }
    press(bibNumber, null, tap);
  };

  /**
   * The question answered (§1010): «Trece numărul din nou» records the number at the moment its tap read; «Anulează», Esc and the
   * backdrop record nothing and use no kept moment. Only the open question's first answer counts — a second tap on it as it fades
   * answers nothing.
   *
   * The box has the focus again for the next number, given inside the answer's own handler: iOS Safari raises the keyboard only for a
   * focus a tap's handler gives, never for one a later frame gives, and the volunteer would have to tap the box again on the line. The
   * question is closed at once for it (`flushSync`): while it is open, the dialog's focus trap pulls any focus outside it back in. The
   * frame after gives it again, in case the dialog's own return of the focus, or a second tap on it as it fades, moved it since.
   */
  const answerAgain = (confirmed: boolean) => {
    if (askOpen && asked) {
      flushSync(() => setAskOpen(false));
      if (confirmed) press(asked.bibNumber, null, asked.tap);
    }
    box.current?.focus();
    requestAnimationFrame(() => box.current?.focus());
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
    // A finished elite's button is drawn disabled; a press from a page that had not heard yet is the server's to call a duplicate —
    // never asked here (§1010): the question is the box's.
    press(bibNumber, elite?.label ?? null, tapNow());
  };

  const onUndo = async (event: FormEvent<HTMLFormElement>, line: RecentFinisherView) => {
    event.preventDefault();
    const sentAtMs = wallNow();
    let answer: FinishUndoAnswer;
    try {
      answer = await undo({ eventId, resultId: line.resultId });
    } catch (error) {
      if (unstable_isUnrecognizedActionError(error)) markOutdated();
      else setOffline(true);
      return;
    }
    setOffline(false);
    if (answer.kind === "session") {
      setSession(true);
      return;
    }
    measureServerClock({ ...answer.clock, sentAtMs, backAtMs: wallNow() });
    if (answer.state) adopt(answer.state);
    const outcome = answer.outcome;
    // Undone: the line leaves «Ultimii sosiți» with the state, so the phone's own line of the press says «anulat» instead of «salvat».
    if (outcome.kind === "undone") {
      const undoneBib = outcome.bibNumber;
      commitEntries((current) => markUndone(current, staffId, undoneBib));
    }
    setUndoLines((current) => ({
      ...current,
      [line.resultId]: outcome.kind === "undone" ? words.undone : (words.undoRefused[outcome.code] ?? words.undoRefusedOther),
    }));
  };

  const time = (ms: number | null) => (ms === null ? "—" : formatResultTime(ms));
  const clockAt = (ms: number) => formatTimeWithSeconds(new Date(ms), { locale: uiLocale, timeZone: CLUB_TIME_ZONE });
  const who = (bibNumber: number, label: string | null) => (label ? `${label} (#${bibNumber})` : `#${bibNumber}`);
  const gunAtMs = gun.atMs;
  // The gun's sentence, of the gun the clock counts from: pressed — the hour in the event's zone, as the page says it — or the plan.
  const gunLine = gun.pressed ? fill(words.gunPressed, { time: formatTimeWithSeconds(new Date(gun.atMs), { locale: uiLocale, timeZone }), by: gun.byName ?? words.accountGone }) : words.gunPlanned;
  const reading = clockReading(nowMs, gunAtMs);
  const waiting = waitingCount(entries, staffId);
  // The numbers whose press of the viewer's still waits on this phone: an elite's button waits with it, so a double tap is one press.
  const waitingNumbers = new Set(entries.flatMap((entry) => (entry.outcome === null && entry.staffId === staffId ? [entry.bibNumber] : [])));

  /** What an entry's line says. */
  const entryLine = (entry: FinishEntry): string => {
    const head = who(entry.bibNumber, entry.label ?? (entry.outcome && "label" in entry.outcome ? entry.outcome.label : null));
    const pressed = entry.pressedAtMs >= gunAtMs ? time(stampedGunTime(entry.pressedAtMs, gunAtMs)) : "—";
    const outcome = entry.outcome;
    if (!outcome) return entry.staffId === staffId ? `${head} · ${pressed} · ${words.waiting}` : `${head}: ${fill(words.otherAccount, { time: pressed })}`;
    if (outcome.kind === "recorded") {
      // Undone since by this phone's «Anulează» (§986): the number, its time and «anulat» — no «✓», no place, no «salvat».
      if (entry.undone) return [head, time(outcome.gunTimeMs), words.undone].join(" · ");
      const place = outcome.outOfRanking ? words.outOfRanking : outcome.positionOverall === null ? null : fill(words.place, { position: String(outcome.positionOverall) });
      return [`✓ ${head}${outcome.name ? ` ${outcome.name}` : ""}`, time(outcome.gunTimeMs), place, words.saved].filter(Boolean).join(" · ");
    }
    if (outcome.kind === "duplicate") {
      const by = outcome.storedBy ?? words.accountGone;
      return outcome.storedStatus === "FINISHED"
        ? `${head} ${fill(words.duplicate, { by, time: time(outcome.storedGunTimeMs), mine: time(outcome.gunTimeMs) })}`
        : `${head} ${fill(words.decided, { status: words.status[outcome.storedStatus] ?? outcome.storedStatus, by, mine: time(outcome.gunTimeMs) })}`;
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

  /** A line drawn without a number, for a viewer who writes the elite list: «Dă-i un număr» in the grey button's place (§990). */
  const numberable = (elite: EliteButtonView): elite is EliteButtonView & { entryId: string } => mayNumber && elite.kind === "line" && elite.bibNumber === null && elite.entryId !== null;

  const eliteButton = (elite: EliteButtonView) => {
    if (numberable(elite)) {
      // Posts the plain form beside the elites' one (`NUMBER_FORM_ID`) with the line's id; the page comes back with its number, the
      // line's button then the same blue button as every other elite's.
      return (
        <Box key={elite.key} sx={{ display: "grid", gap: 0.5, alignContent: "start" }} data-testid="finish-elite" data-bib="">
          <GlyphButton
            type="submit"
            form={NUMBER_FORM_ID}
            name="entryId"
            value={elite.entryId}
            icon="number"
            variant="outlined"
            color="primary"
            aria-label={fill(words.eliteGiveNumberAria, { label: elite.label, name: elite.name })}
            sx={{ minHeight: 64, justifyContent: "flex-start", textAlign: "left", textTransform: "none", width: "100%" }}
            data-testid="finish-elite-give-number"
          >
            <Box component="span" sx={{ display: "grid", minWidth: 0 }}>
              <Box component="span" sx={{ fontSize: "1.25rem", fontWeight: 700, lineHeight: 1.2, overflowWrap: "anywhere" }}>
                {elite.label}
              </Box>
              <Box component="span" sx={{ fontSize: "0.75rem", lineHeight: 1.3, overflowWrap: "anywhere" }}>
                {`${words.eliteGiveNumber} · ${elite.name}`}
              </Box>
            </Box>
          </GlyphButton>
        </Box>
      );
    }
    const disabled = elite.bibNumber === null || elite.finishedGunTimeMs !== null || waitingNumbers.has(elite.bibNumber);
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
      {/* The gun the clock counts from, in words — «Start» pressed on another phone changes it at the clock's next answer (§986). */}
      <Typography variant="body2" sx={{ fontWeight: 600 }} data-testid="race-gun-line">
        {gunLine}
      </Typography>
      <Typography variant="h4" component="p" sx={{ fontVariantNumeric: "tabular-nums" }} suppressHydrationWarning data-testid="finish-clock">
        {reading === null ? words.notStarted : fill(words.clock, { time: formatResultTime(reading) })}
      </Typography>

      {session && (
        <Alert severity="warning" data-testid="finish-session">
          {words.session}
        </Alert>
      )}
      {reload && !session && (
        <Alert severity="warning" data-testid="finish-reload">
          {words.reload}
        </Alert>
      )}
      {offline && !session && !reload && (
        <Alert severity="warning" data-testid="finish-offline">
          {words.offline}
        </Alert>
      )}
      {/* The viewer's presses waiting under another event on this phone: only that event's page sends them. */}
      {hydrated &&
        elsewhere.map((other) => (
          <Alert key={other.eventId} severity="info" data-testid="finish-elsewhere" data-event={other.eventId}>
            {fill(words.elsewhere[countForm(other.count, uiLocale)], { count: String(other.count), event: other.title ?? words.elsewhereUnnamed })}{" "}
            <Link href={`?eventId=${encodeURIComponent(other.eventId)}`}>{words.elsewhereOpen}</Link>
          </Alert>
        ))}

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
          {/* «Dă-i un număr»'s own form (§990), beside the elites' — never inside it: each button names it and posts its line's id. */}
          {state.elites.some(numberable) && (
            <Box component="form" id={NUMBER_FORM_ID} action={numberForm} hidden data-testid="finish-elite-number-form">
              {hidden}
            </Box>
          )}
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

      {/* A finished elite's number typed again, asked first (§1010): the house's one dialog, «Anulează» focused — Enter and Esc cancel. */}
      <ConfirmDialog spec={asked?.question ?? null} open={askOpen} onCancel={() => answerAgain(false)} onConfirm={() => answerAgain(true)} />

      {/* «⏱ Finish» works only in the page: with scripts off there is nothing to keep a moment in, so it is not drawn. */}
      {hydrated && (
        <Box data-testid="finish-keep">
          <Stack direction="row" sx={{ gap: 1, alignItems: "center", flexWrap: "wrap" }}>
            <GlyphButton type="button" icon="keepTime" variant="outlined" sx={BIG_SX} onClick={() => commitKept((current) => keepTime(current, serverClockNow()))} data-testid="finish-keep-button">
              {words.keep}
            </GlyphButton>
            {kept.length > 0 && (
              <Typography variant="body2" component="span" sx={{ fontWeight: 600 }}>
                {words.keptTitle}:
              </Typography>
            )}
            {kept.map((atMs, index) => {
              const label = atMs >= gunAtMs ? time(stampedGunTime(atMs, gunAtMs)) : clockAt(atMs);
              const age = keptAge(atMs, nowMs);
              const aged = `${label} · ${fill(age.unit === "seconds" ? words.keptAgeSeconds : words.keptAgeMinutes, { count: String(age.value) })}`;
              return (
                <GlyphButton
                  key={`${atMs}-${index}`}
                  type="button"
                  icon="dismiss"
                  variant="outlined"
                  size="small"
                  sx={{ minHeight: 44, fontVariantNumeric: "tabular-nums" }}
                  aria-label={fill(words.keptDrop, { time: aged })}
                  onClick={() => commitKept((current) => dropKept(current, index))}
                  data-testid="finish-kept"
                >
                  {aged}
                </GlyphButton>
              );
            })}
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
            {words.keepHelp}
          </Typography>
          {/* Kept moments older than ten minutes, dropped (§986): their times, to be written on paper — until the volunteer says so. */}
          {staleTimes.length > 0 && (
            <Alert
              severity="warning"
              sx={{ mt: 1 }}
              data-testid="finish-kept-stale"
              action={
                <GlyphButton type="button" icon="confirm" variant="text" size="small" sx={{ minHeight: 44 }} onClick={() => setStaleTimes([])} data-testid="finish-kept-stale-done">
                  {words.keptStaleDone}
                </GlyphButton>
              }
            >
              {fill(words.keptStale[countForm(staleTimes.length, uiLocale)], {
                count: String(staleTimes.length),
                times: staleTimes.map((atMs) => (atMs >= gunAtMs ? time(stampedGunTime(atMs, gunAtMs)) : clockAt(atMs))).join(", "),
              })}
            </Alert>
          )}
        </Box>
      )}

      {hydrated && entries.length > 0 && (
        <Box component="section" aria-labelledby="finish-entries-title" data-testid="finish-entries">
          <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
            <Typography id="finish-entries-title" variant="subtitle1" component="p" sx={{ fontWeight: 700 }}>
              {words.entriesTitle}
              {waiting > 0 ? ` · ${fill(words.waitingCount, { count: String(waiting) })}` : ""}
            </Typography>
            {/* «Golește lista» (§1001): only while a line the server answered is there; a press still waiting is never cleared. */}
            {entries.some((entry) => entry.outcome !== null) && (
              <GlyphButton
                type="button"
                icon="dismiss"
                variant="text"
                size="small"
                sx={{ minHeight: 44 }}
                onClick={() => commitEntries(withoutSettled)}
                data-testid="finish-entries-clear"
              >
                {words.entriesClear}
              </GlyphButton>
            )}
          </Stack>
          <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none", display: "grid", gap: 0.5 }}>
            {[...entries].reverse().map((entry) => {
              const kind = entryStateOf(entry, staffId);
              return (
                <Typography
                  component="li"
                  variant="body2"
                  key={entry.id}
                  color={kind === "waiting" || kind === "undone" ? "text.secondary" : kind === "saved" ? "success.main" : kind === "duplicate" ? "warning.main" : "error.main"}
                  sx={{ fontWeight: kind === "waiting" || kind === "saved" || kind === "undone" ? 400 : 600, overflowWrap: "anywhere" }}
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
                    {line.pressedAgain !== null && undoLines[line.resultId] === undefined && (
                      <Typography variant="caption" color="text.secondary" data-testid="finish-undo-closed">
                        {words.undoPressedAgain[line.pressedAgain]}
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
