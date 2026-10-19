"use client";

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import PersonOffIcon from "@mui/icons-material/PersonOff";
import SaveIcon from "@mui/icons-material/Save";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import GlyphChip from "@/modules/events/ui/GlyphChip";
import { decodeHint, PERSON_HINT_COOKIE } from "@/modules/person-session/domain/hint";
import CheckboxField from "@/shared/ui/CheckboxField";
import Hint from "@/shared/ui/Hint";
import SubmitButton from "@/shared/ui/SubmitButton";
import type { RsvpIslandState, RsvpMemberResult, RsvpNameResult } from "../remembered-actions";
import { islandFace, memberTickFace, rememberedHeading } from "../domain/island";
import { setRsvpGoing } from "./going-store";

/** The words the island draws, handed over by the Server Component as strings: the island carries no messages of its own. */
export type RsvpIslandLabels = {
  /** With `{who}`: «Răspunzi ca {who}». */
  rememberedAs: string;
  going: string;
  cancel: string;
  cancelling: string;
  notMe: string;
  help: string;
  failed: string;
  submit: string;
  submitting: string;
  showName: string;
  /**
   * The tick on «Tu vii ✓» (§827): «Numele meu apare la „Cine vine"»; its help with `{name}` when the answer holds a name (it says which one the
   * tick shows); the help when it holds none; the box shown then, and the save.
   */
  nameSwitch: string;
  nameHelp: string;
  nameAsk: string;
  nameBox: string;
  nameSave: string;
  /** One sentence after each save (a status, not a colour) and one per refusal. */
  nameShown: string;
  nameHidden: string;
  nameNeeded: string;
  nameNone: string;
  /**
   * The member tick (§831): «Sunt membru al grupului {club}» with the club's sentence for what «membru» means behind its «?» (`memberHint`), the help under it, and the
   * sentences after a save — «on», «off», and «closed» when the event or the notice no longer takes it. `memberFact` says «Membru» for an answer an account made.
   */
  memberTick: string;
  memberHint: string;
  memberHelp: string;
  memberOn: string;
  memberOff: string;
  memberClosed: string;
  memberFact: string;
  /** The fact's help, on its chip's tooltip (the zone's own words, §831). */
  memberFactHelp: string;
};

/**
 * The server's six actions, handed over by the Server Component as props (`RsvpBox`): an island that imported them would take their
 * whole chain — the service, the configuration, Zod — into a visitor's bundle (§489, `public-islands-weight.test.ts`). A Server Action
 * crosses the boundary as a prop, and runs on the server whatever the island does with it.
 */
export type RsvpIslandActions = {
  state: (slug: string, locale: string) => Promise<RsvpIslandState>;
  go: (slug: string, locale: string, showName: boolean, clubMember: boolean) => Promise<RsvpIslandState>;
  leave: (slug: string, locale: string) => Promise<RsvpIslandState>;
  forget: () => Promise<void>;
  /** The person's own tick «Numele meu apare la „Cine vine"» (§827): on or off, with the name the box holds — the one shown (the answer's own) or the one typed. */
  showName: (slug: string, locale: string, showName: boolean, name: string) => Promise<RsvpNameResult>;
  /** The person's own declared tick «Sunt membru» (§831): on or off, saved at once. */
  member: (slug: string, locale: string, clubMember: boolean) => Promise<RsvpMemberResult>;
};

const HINT_EVENT = "br-person-hint";

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  for (const part of document.cookie.split("; ")) {
    if (part.startsWith(`${name}=`)) return part.slice(name.length + 1);
  }
  return "";
}

function subscribe(notify: () => void): () => void {
  window.addEventListener(HINT_EVENT, notify);
  return () => window.removeEventListener(HINT_EVENT, notify);
}

/** Clear the hint here (the server clears the secret): a script cannot clear an `httpOnly` cookie, and the hint holds none. */
function clearHint(): void {
  document.cookie = `${PERSON_HINT_COOKIE}=; Max-Age=0; path=/; SameSite=Lax`;
  window.dispatchEvent(new Event(HINT_EVENT));
}

/**
 * The one client island of «Vin!» (§811, «Vin!» part 1): it earns its place because the event page is static and the same for
 * everybody (§333, §549), while "this browser is remembered" is one browser's. It reads the hint cookie
 * (`person-session/domain/hint.ts` — the masked address and the name, **no secret**), and:
 *
 * - no hint, or a hint the server no longer backs, or JavaScript off: the typed form stands (`children`, rendered on the server);
 * - a hint: «Răspunzi ca an…@gmail.com», then «Vin!» (one tap, counted at once, no email) or, once counted, «Tu vii» with
 *   «Nu mai vin»; and «Nu sunt eu», which forgets the browser.
 *
 * A press is a Server Action that reads the `httpOnly` cookie itself (`remembered-actions.ts`): the island never sees the
 * secret, and the hint proves nothing. After an answer the page is refreshed, so «Cine vine (N)» under it counts the person.
 */
export default function RsvpRemembered({
  slug,
  locale,
  labels,
  actions,
  memberOffered = false,
  children,
}: {
  slug: string;
  locale: string;
  labels: RsvpIslandLabels;
  actions: RsvpIslandActions;
  /** The member tick is offered only while the notice in force describes the mark (`cachedRsvpMemberDescribed`, §831); a tick already given stays visible, so it can be taken back. */
  memberOffered?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const raw = useSyncExternalStore(subscribe, () => readCookie(PERSON_HINT_COOKIE), () => "");
  const hint = useMemo(() => decodeHint(raw || null), [raw]);
  const [state, setState] = useState<RsvpIslandState | null>(null);
  // Two failures, two behaviours: a state that could not be read falls back to the typed form; a press that failed keeps the one-tap state and says so.
  const [readFailed, setReadFailed] = useState(false);
  const [pressFailed, setPressFailed] = useState(false);
  // The name tick (§827): the box opens when the person ticks with no name to show; `nameNote` is the last save's sentence; `refusals` remounts the tick form after a refusal only (a saved tick already shows what the person did, and a remount would drop the keyboard's focus), so the box shows what the server kept.
  const [asking, setAsking] = useState(false);
  const [nameNote, setNameNote] = useState<"shown" | "hidden" | "name" | "none" | null>(null);
  const [refusals, setRefusals] = useState(0);
  // The member tick (§831): the last save's sentence — a status, not a colour — and a remount counter for a refusal, like the name's.
  const [memberNote, setMemberNote] = useState<"on" | "off" | "closed" | "none" | null>(null);
  const [memberRefusals, setMemberRefusals] = useState(0);
  const masked = hint?.masked ?? null;

  useEffect(() => {
    if (!masked) return;
    let alive = true;
    actions.state(slug, locale).then(
      (next) => {
        if (!alive) return;
        // A hint the server no longer backs (forgotten elsewhere, expired): drop it and show the typed form.
        if (!next.remembered) clearHint();
        setState(next);
      },
      () => {
        if (alive) setReadFailed(true);
      },
    );
    return () => {
      alive = false;
    };
    // The actions are the server's, handed over afresh at every refresh of the page: the state is asked once per address and page, not once per refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masked, slug, locale]);

  // The closed fold's line says «Tu vii ✓» (§812) as soon as this browser's state is known, and drops it when the answer or the browser is forgotten.
  const going = state !== null && state.remembered && state.offered && state.going;
  useEffect(() => {
    setRsvpGoing(slug, going);
    // Leaving the page forgets it: a client-side return to the event must not flash a stale «Tu vii ✓» before this island has asked again.
    return () => setRsvpGoing(slug, false);
  }, [slug, going]);

  // The typed form: no hint, no JavaScript, a stale hint, an event that takes no answer from this browser, or a server that failed.
  if (islandFace({ hasHint: hint !== null, readFailed, state }) === "typed" || !hint) return <>{children}</>;

  const who = rememberedHeading(hint);

  const run = async (call: () => Promise<RsvpIslandState>) => {
    try {
      setPressFailed(false);
      // A new answer or a taken-back one starts the name tick afresh: no box left open, no sentence of the last save.
      setAsking(false);
      setNameNote(null);
      setMemberNote(null);
      const next = await call();
      if (!next.remembered) clearHint();
      setState(next);
      router.refresh();
    } catch {
      setPressFailed(true);
    }
  };

  const runName = async (on: boolean, name: string) => {
    try {
      setPressFailed(false);
      const { state: next, refused } = await actions.showName(slug, locale, on, name);
      if (!next.remembered) clearHint();
      setState(next);
      // «closed» has no sentence here: the state says the event takes no answer now, the island draws the typed form, and the page says why.
      setNameNote(refused === "closed" ? null : (refused ?? (on ? "shown" : "hidden")));
      setAsking(refused === "name");
      if (refused !== null) setRefusals((n) => n + 1);
      router.refresh();
    } catch {
      setPressFailed(true);
    }
  };

  const runMember = async (on: boolean) => {
    try {
      setPressFailed(false);
      const { state: next, refused } = await actions.member(slug, locale, on);
      if (!next.remembered) clearHint();
      setState(next);
      // A refusal of «none» says the answer is gone; «closed» says the event or the notice no longer takes the tick; the state redraws either way.
      setMemberNote(refused ?? (on ? "on" : "off"));
      if (refused !== null) setMemberRefusals((n) => n + 1);
      router.refresh();
    } catch {
      setPressFailed(true);
    }
  };

  return (
    <Stack spacing={1.5} data-testid="rsvp-remembered">
      <Typography variant="body2" data-testid="rsvp-remembered-as" sx={{ overflowWrap: "anywhere" }}>
        {labels.rememberedAs.replace("{who}", who)}
      </Typography>

      {state === null ? null : state.remembered && state.offered && state.going ? (
        <>
          <Typography role="status" data-testid="rsvp-going" sx={{ display: "flex", alignItems: "center", gap: 1, fontWeight: 700 }}>
            <CheckCircleIcon aria-hidden color="success" sx={{ fontSize: "1.4em" }} />
            {labels.going}
          </Typography>
          {/*
            «Numele meu apare la „Cine vine"» (§827): a real tick box in its own small form, saved at once when the answer holds a name
            (a change submits the form); with no name, ticking opens one «Numele tău» box and «Salvează». The server reads the cookie.
            With a name, the help says which name the tick shows and the form posts it: a name is never published unposted (§812).
          */}
          <form
            key={refusals}
            action={(form: FormData) => runName(form.get("showName") === "on", String(form.get("name") ?? ""))}
            onChange={(event) => {
              const target = event.target;
              if (!(target instanceof HTMLInputElement) || target.name !== "showName") return;
              if (state.name !== null) event.currentTarget.requestSubmit();
              else setAsking(target.checked);
            }}
            data-testid="rsvp-name-switch"
          >
            <Stack spacing={1}>
              <CheckboxField name="showName" defaultChecked={state.showName || asking} help={state.name !== null ? labels.nameHelp.replace("{name}", () => state.name ?? "") : labels.nameAsk}>
                {labels.nameSwitch}
              </CheckboxField>
              {state.name !== null && <input type="hidden" name="name" value={state.name} />}
              {asking && state.name === null && (
                <Stack spacing={1.5} data-testid="rsvp-name-box">
                  <TextField name="name" label={labels.nameBox} required fullWidth autoComplete="name" slotProps={{ htmlInput: { maxLength: 80 } }} />
                  <SubmitButton label={labels.nameSave} pendingLabel={labels.submitting} size="large">
                    <SaveIcon />
                  </SubmitButton>
                </Stack>
              )}
            </Stack>
          </form>
          {nameNote !== null && (
            <Typography variant="body2" role="status" data-testid="rsvp-name-note">
              {nameNote === "shown"
                ? labels.nameShown
                : nameNote === "hidden"
                  ? labels.nameHidden
                  : nameNote === "name"
                    ? labels.nameNeeded
                    : labels.nameNone}
            </Typography>
          )}
          {/*
            «Sunt membru al grupului …» (§831): a real tick box in its own small form, saved at once (a change submits it), beside the name's. Drawn while the
            notice in force describes the mark, or while a tick was given (so it can be taken back); an answer an account made says «Membru» as a fact —
            the mark comes from the account's role, never from this box. The declaration is the person's: the club does not check it.
          */}
          {memberTickFace(state.clubMember, memberOffered) === "fact" ? (
            <Box data-testid="rsvp-member-fact">
              <GlyphChip glyph="membersOnly" label={labels.memberFact} variant="outlined" color="primary" tooltip={labels.memberFactHelp} />
            </Box>
          ) : (
            memberTickFace(state.clubMember, memberOffered) === "box" && (
              <form
                key={`member-${memberRefusals}`}
                action={(form: FormData) => runMember(form.get("clubMember") === "on")}
                onChange={(event) => {
                  const target = event.target;
                  if (target instanceof HTMLInputElement && target.name === "clubMember") event.currentTarget.requestSubmit();
                }}
                data-testid="rsvp-member-switch"
              >
                <CheckboxField name="clubMember" defaultChecked={state.clubMember === "DECLARED"} help={labels.memberHelp}>
                  {labels.memberTick}
                  <Hint text={labels.memberHint} />
                </CheckboxField>
              </form>
            )
          )}
          {memberNote !== null && (
            <Typography variant="body2" role="status" data-testid="rsvp-member-note">
              {memberNote === "on" ? labels.memberOn : memberNote === "off" ? labels.memberOff : memberNote === "closed" ? labels.memberClosed : labels.nameNone}
            </Typography>
          )}
          <form action={() => run(() => actions.leave(slug, locale))}>
            <SubmitButton label={labels.cancel} pendingLabel={labels.cancelling} variant="outlined" size="large">
              <EventBusyIcon />
            </SubmitButton>
          </form>
        </>
      ) : (
        <form
          action={(form: FormData) => run(() => actions.go(slug, locale, form.get("showName") === "on", form.get("clubMember") === "on"))}
        >
          <Stack spacing={1.5}>
            {/* A tick only for somebody who gave a name before: with no name there is nothing to show. */}
            {hint.name !== null && <CheckboxField name="showName">{labels.showName}</CheckboxField>}
            {/* The declared member tick (§831): off by default, while the notice in force describes the mark; the club's sentence behind its «?». */}
            {memberOffered && (
              <CheckboxField name="clubMember" help={labels.memberHelp}>
                {labels.memberTick}
                <Hint text={labels.memberHint} />
              </CheckboxField>
            )}
            <SubmitButton label={labels.submit} pendingLabel={labels.submitting} size="large">
              <EventAvailableIcon />
            </SubmitButton>
          </Stack>
        </form>
      )}

      {pressFailed && (
        <Alert severity="error" role="alert" data-testid="rsvp-failed">
          {labels.failed}
        </Alert>
      )}

      <Typography variant="caption" color="text.secondary">
        {labels.help}
      </Typography>

      {/* A small link under the help line, not a second button beside «Nu mai vin»: it forgets the browser, for a shared or borrowed device. */}
      <form
        action={async () => {
          await actions.forget();
          clearHint();
          setState(null);
          router.refresh();
        }}
      >
        <SubmitButton label={labels.notMe} pendingLabel={labels.submitting} variant="text" size="small">
          <PersonOffIcon />
        </SubmitButton>
      </form>
    </Stack>
  );
}
