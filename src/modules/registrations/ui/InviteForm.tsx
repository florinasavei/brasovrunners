"use client";

import SendIcon from "@mui/icons-material/Send";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { type FormEvent, useActionState, useMemo, useRef, useState } from "react";
import { countForm } from "@/i18n/count-form";
import ConfirmDialog from "@/shared/feedback/ConfirmDialog";
import type { ConfirmSpec } from "@/shared/feedback/notice";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { parseInvitationLines } from "../domain/invitations";

type Counted = { one: string; few: string; other: string };

/** Every word the island says, translated on the server (a Server Component passes strings, never `t`). */
export type InviteFormWords = {
  membersLegend: string;
  membersSearch: string;
  membersNone: string;
  typedLabel: string;
  typedHelp: string;
  daysLabel: string;
  daysHelp: string;
  outsideLabel: string;
  outsideHelp: string;
  /** «Limba invitației», its two answers and the sentence saying whom it is for. */
  localeLegend: string;
  localeRo: string;
  localeEn: string;
  localeHelp: string;
  submit: string;
  dialogTitle: string;
  /** «{count} invitații», counted. */
  dialogCount: Counted;
  /** «Locuri libere pentru invitații acum: {free} — cine așteaptă pe listă are întâietate.» */
  dialogFree: string;
  /** «Se adaugă {count} locuri suplimentare: capacitatea devine {capacity}.», counted. */
  dialogRaise: Counted;
  dialogNoRaise: string;
  dialogOutside: string;
  /** «Invitația expiră în {count} zile, cel mult la start.», counted: the deadline the press sends. */
  dialogDays: Counted;
  /** «Limba pentru adresele pe care clubul nu le cunoaște: {language}.»: the language the press sends. */
  dialogLocale: string;
  dialogEmail: Counted;
  /** «Adaugă {count} locuri și trimite», counted. */
  confirmRaise: Counted;
  confirm: string;
  cancel: string;
  nobody: string;
  /** `Admin.invitations.errors.<code>`, with `{name}` or `{lines}` where they say whose. */
  errors: Readonly<Record<string, string>>;
  errorGeneric: string;
};

/**
 * A refusal handed back by the action: the marker, whose line it is, and — read again by the server
 * after the refusal (`readInvitationForecast`) — the capacity and the places free for invitations, which
 * the next dialog asks on instead of the page's (the page is not redrawn on a refusal).
 */
export type InviteFormState = {
  error: string;
  person?: string | null;
  lines?: string;
  forecast?: { capacity: number | null; free: number | null } | null;
} | null;

type Forecast = { capacity: number | null; free: number | null };

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (values[name] === undefined ? whole : String(values[name])));
}

/**
 * «Trimite invitații» (§NNN): the members' zone accounts as ticks with a search, the typed lines
 * «Nume <adresă>», the days, «Pe lista ascunsă» (§643's `outside_capacity`) and «Limba invitației» for
 * an address the club has never seen, and — before anything is sent — the dialog that
 * says how many people, how many places are free, and whether the send adds supplementary places and
 * what the capacity becomes (§642: a raise is never pressed through a button that does not name it).
 * The capacity the dialog named is posted (`addPlace`), and the server adds exactly that or refuses.
 * The counts are the page's forecast (`invitationForecastFree`); the server decides under the lock.
 *
 * Without JavaScript the form posts without `addPlace`: a send that needs a place is refused, never
 * raised unasked. A refusal comes back here with the person it is about — in the response, never a URL.
 */
export default function InviteForm({
  action,
  locale,
  eventId,
  members,
  capacity,
  free,
  daysDefault,
  daysMax,
  hiddenListEnabled,
  words,
}: {
  action: (state: InviteFormState, form: FormData) => Promise<InviteFormState>;
  locale: string;
  eventId: string;
  members: readonly { id: string; name: string; email: string }[];
  capacity: number | null;
  free: number | null;
  daysDefault: number;
  daysMax: number;
  /** The event's «Folosește lista ascunsă» (§648; the send obeys it, §647): off, the tick is not drawn and the server refuses it anyway. */
  hiddenListEnabled: boolean;
  words: InviteFormWords;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const form = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);
  const [search, setSearch] = useState("");
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [typed, setTyped] = useState("");
  const [outside, setOutside] = useState(false);
  /*
    Controlled, as the ticks and the lines are: React resets an uncontrolled field of a form once its
    action completes, and a refusal answered with state completes it — the corrected second press would
    otherwise go in Romanian with the default days whatever was chosen (the invitations review of 2026-10-03).
  */
  const [days, setDays] = useState(String(daysDefault));
  const [inviteLocale, setInviteLocale] = useState<"ro" | "en">("ro");
  /*
    The numbers the dialog asks on: the page's when it was drawn, the server's newer read after a
    refusal, and the page's again whenever it is redrawn with different ones (after a send).
  */
  const [forecast, setForecast] = useState<Forecast>({ capacity, free });
  const [drawn, setDrawn] = useState<Forecast>({ capacity, free });
  const [answered, setAnswered] = useState<InviteFormState>(null);
  if (drawn.capacity !== capacity || drawn.free !== free) {
    setDrawn({ capacity, free });
    setForecast({ capacity, free });
  }
  if (state !== answered) {
    setAnswered(state);
    if (state?.forecast) setForecast(state.forecast);
  }
  const [addPlace, setAddPlace] = useState("");
  const [dialog, setDialog] = useState<{ spec: ConfirmSpec; addPlace: string } | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const needle = search.trim().toLocaleLowerCase(locale);
  const shown = useMemo(
    () => new Set(members.filter((member) => needle === "" || `${member.name} ${member.email}`.toLocaleLowerCase(locale).includes(needle)).map((member) => member.id)),
    [members, needle, locale],
  );

  const counted = (forms: Counted, count: number, values: Record<string, string | number> = {}) => fill(forms[countForm(count, locale)], { count, ...values });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (confirmed.current) {
      confirmed.current = false;
      return;
    }
    event.preventDefault();
    const lines = parseInvitationLines(typed);
    if (lines.unread.length > 0) {
      setLocalError(fill(words.errors.INVITATION_UNREAD_LINE ?? words.errorGeneric, { lines: lines.unread.join(", ") }));
      return;
    }
    const count = ticked.size + lines.people.length;
    if (count === 0) {
      setLocalError(words.nobody);
      return;
    }
    // The days as the action reads them: empty is the default; anything else a whole number in range.
    const dayCount = days.trim() === "" ? daysDefault : /^\d+$/.test(days.trim()) ? Number(days.trim()) : NaN;
    if (!Number.isInteger(dayCount) || dayCount < 1 || dayCount > daysMax) {
      setLocalError(words.errors.INVITATION_BAD_DAYS ?? words.errorGeneric);
      return;
    }
    setLocalError(null);
    const { capacity: nowCapacity, free: nowFree } = forecast;
    const raises = !(hiddenListEnabled && outside) && nowCapacity !== null && nowFree !== null ? Math.max(count - nowFree, 0) : 0;
    const raisedTo = raises > 0 && nowCapacity !== null ? nowCapacity + raises : null;
    const body = [
      counted(words.dialogCount, count),
      hiddenListEnabled && outside ? words.dialogOutside : nowFree === null ? null : fill(words.dialogFree, { free: nowFree }),
      (hiddenListEnabled && outside) || nowFree === null ? null : raisedTo !== null ? counted(words.dialogRaise, raises, { capacity: raisedTo }) : words.dialogNoRaise,
      counted(words.dialogDays, dayCount),
      fill(words.dialogLocale, { language: inviteLocale === "en" ? words.localeEn : words.localeRo }),
    ]
      .filter((sentence): sentence is string => sentence !== null)
      .join(" ");
    setDialog({
      spec: {
        title: words.dialogTitle,
        body,
        email: counted(words.dialogEmail, count),
        confirmLabel: raisedTo !== null ? counted(words.confirmRaise, raises) : words.confirm,
        cancelLabel: words.cancel,
      },
      addPlace: raisedTo === null ? "" : String(raisedTo),
    });
  }

  function onConfirm() {
    if (!dialog) return;
    setAddPlace(dialog.addPlace);
    setDialog(null);
    confirmed.current = true;
    // After React wrote the hidden field: the press posts the capacity the question named.
    queueMicrotask(() => requestAnimationFrame(() => form.current?.requestSubmit()));
  }

  const serverError = state?.error ? fill(words.errors[state.error] ?? words.errorGeneric, { name: state.person ?? "", lines: state.lines ?? "" }) : null;

  return (
    <Box component="form" ref={form} action={formAction} onSubmit={onSubmit} data-testid="invite-form">
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="addPlace" value={addPlace} />
      {hiddenListEnabled && outside && <input type="hidden" name="outside" value="1" />}
      <Stack spacing={2}>
        {(localError ?? serverError) && (
          <Alert severity="error" role="alert" data-testid="invite-error">
            {localError ?? serverError}
          </Alert>
        )}
        <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
          <Typography component="legend" variant="subtitle2" sx={{ mb: 1 }}>
            {words.membersLegend}
          </Typography>
          {members.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {words.membersNone}
            </Typography>
          ) : (
            <>
              <TextField label={words.membersSearch} value={search} onChange={(event) => setSearch(event.target.value)} size="small" fullWidth sx={{ mb: 1 }} />
              <Box sx={{ maxHeight: 280, overflowY: "auto", border: 1, borderColor: "divider", borderRadius: 1, px: 1 }}>
                {members.map((member) => (
                  <Box key={member.id} sx={{ display: shown.has(member.id) ? "block" : "none" }}>
                    <FormControlLabel
                      sx={{ minHeight: TAP_TARGET.minHeight, width: "100%", mr: 0 }}
                      control={
                        <Checkbox
                          name="member"
                          value={member.id}
                          checked={ticked.has(member.id)}
                          onChange={(event) => {
                            const next = new Set(ticked);
                            if (event.target.checked) next.add(member.id);
                            else next.delete(member.id);
                            setTicked(next);
                          }}
                        />
                      }
                      label={
                        <Box component="span" sx={{ wordBreak: "break-all" }}>
                          {member.name} · {member.email}
                        </Box>
                      }
                    />
                  </Box>
                ))}
              </Box>
            </>
          )}
        </Box>
        <TextField
          name="typed"
          label={words.typedLabel}
          helperText={words.typedHelp}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          multiline
          minRows={3}
          fullWidth
          slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: "off" } }}
        />
        <TextField
          name="days"
          label={words.daysLabel}
          helperText={words.daysHelp}
          value={days}
          onChange={(event) => setDays(event.target.value)}
          type="number"
          slotProps={{ htmlInput: { min: 1, max: daysMax, step: 1, inputMode: "numeric" } }}
          sx={{ maxWidth: 240 }}
        />
        <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
          <Typography component="legend" variant="subtitle2">
            {words.localeLegend}
          </Typography>
          <RadioGroup name="inviteLocale" value={inviteLocale} onChange={(event) => setInviteLocale(event.target.value === "en" ? "en" : "ro")} row>
            <FormControlLabel sx={{ minHeight: TAP_TARGET.minHeight }} value="ro" control={<Radio />} label={words.localeRo} />
            <FormControlLabel sx={{ minHeight: TAP_TARGET.minHeight }} value="en" control={<Radio />} label={words.localeEn} />
          </RadioGroup>
          <Typography variant="body2" color="text.secondary">
            {words.localeHelp}
          </Typography>
        </Box>
        {hiddenListEnabled && (
          <Box>
            <FormControlLabel
              sx={{ minHeight: TAP_TARGET.minHeight }}
              control={<Checkbox checked={outside} onChange={(event) => setOutside(event.target.checked)} />}
              label={words.outsideLabel}
            />
            <Typography variant="body2" color="text.secondary">
              {words.outsideHelp}
            </Typography>
          </Box>
        )}
        <Box>
          <Button type="submit" variant="contained" startIcon={<SendIcon fontSize="small" />} disabled={pending} sx={{ minHeight: TAP_TARGET.minHeight }} data-testid="invite-submit">
            {words.submit}
          </Button>
        </Box>
      </Stack>
      <ConfirmDialog spec={dialog?.spec ?? null} open={dialog !== null} onCancel={() => setDialog(null)} onConfirm={onConfirm} />
    </Box>
  );
}
