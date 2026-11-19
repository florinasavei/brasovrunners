"use client";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { countForm } from "@/i18n/count-form";
import GlyphButton from "@/shared/ui/GlyphButton";
import { TAP_TARGET } from "@/shared/ui/tap-target";

/** A count's three phrasings (`count-form.ts`), each with `{count}`. */
type Counted = { one: string; few: string; other: string };

/** The island's words, translated on the server and handed over as strings (AGENTS.md §14.5). */
export type SignedContractUploadLabels = {
  /** The file box's name. */
  choose: string;
  /** The press: «Încarcă», «Înlocuiește», «Încarcă contractele semnate». */
  submit: string;
  /** The press while its files go up: «Se încarcă…». */
  pending: string;
  /** The line under it while a file goes up: «Se încarcă…»; for many, «Se încarcă {done} din {total}…». */
  sending: string;
  /** Once the one file is attached. */
  done: string;
  /** Pressed with no file chosen. */
  chooseFirst: string;
  /** A refusal's sentence by its code — the page's own `Admin.errors.*` — and `FAILED` for a request that did not get an answer. */
  errors: Readonly<Record<string, string>>;
  /** Many only: while the names are matched. */
  matching?: string;
  /** Many only: why a file was not attached, by reason (`ContractNameRefusal` and the content's own), `{max}` already filled. */
  reasons?: Readonly<Record<string, string>>;
  /** Many only: «Am atașat {count} …» and «{count} fișiere nu s-au atașat …». */
  attached?: Counted;
  left?: Counted;
  /** Many only: one line of the files left, «{file}: {reason}». */
  line?: string;
};

type Props = {
  /** One volunteer's file, or every file of an event's volunteers at once. */
  mode: "one" | "many";
  /** One: the volunteer's upload route. Many: the event's route, which matches the names (and takes every file with scripts off). */
  action: string;
  /** Many: the volunteer's upload route with `{volunteer}` where the id goes. */
  uploadTemplate?: string;
  /** The page's language: the plain form's way back, and the count's phrasing. */
  locale: string;
  /** Many: the list's address to come back to with scripts off. */
  returnTo?: string;
  maxBytes: number;
  partBytes: number;
  accept: string;
  inputId: string;
  labels: SignedContractUploadLabels;
  testId: string;
};

type Sent = { ok: true } | { ok: false; code: string };
type Left = { file: string; reason: string };
type Status = { kind: "idle" } | { kind: "busy"; text: string } | { kind: "done"; text: string } | { kind: "refused"; text: string };

/** The answer of a route, read as the island needs it; anything that is not the route's own JSON is `FAILED`. */
async function answerOf(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const answer: unknown = await response.json();
    return answer && typeof answer === "object" ? (answer as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * One file to one volunteer's route (§NNN): whole when it fits one request, else in pieces of `partBytes`, each appended in order —
 * a request to a function on the host carries at most 4.5 MB, a signed scan up to ten. The route checks everything again.
 */
async function sendFile(file: File, url: string, partBytes: number): Promise<Sent> {
  try {
    if (file.size <= partBytes) {
      const body = new FormData();
      body.set("answer", "json");
      body.set("file", file, file.name);
      const response = await fetch(url, { method: "POST", body, credentials: "same-origin" });
      const answer = await answerOf(response);
      return response.ok && answer?.done === true ? { ok: true } : { ok: false, code: typeof answer?.error === "string" ? answer.error : "FAILED" };
    }
    let upload = "";
    let offset = 0;
    while (offset < file.size) {
      const body = new FormData();
      body.set("answer", "json");
      body.set("size", String(file.size));
      body.set("offset", String(offset));
      body.set("name", file.name);
      if (upload) body.set("upload", upload);
      body.set("file", file.slice(offset, offset + partBytes), file.name);
      const response = await fetch(url, { method: "POST", body, credentials: "same-origin" });
      const answer = await answerOf(response);
      if (!response.ok || !answer) return { ok: false, code: typeof answer?.error === "string" ? answer.error : "FAILED" };
      if (answer.done === true) return { ok: true };
      if (typeof answer.uploadId !== "string" || typeof answer.received !== "number" || answer.received <= offset) return { ok: false, code: "FAILED" };
      upload = answer.uploadId;
      offset = answer.received;
    }
    return { ok: false, code: "FAILED" };
  } catch {
    return { ok: false, code: "FAILED" };
  }
}

/** A content refusal's code, as the list of files left names it (`signed-contract.ts#batchReasonOf`, the same four). */
function reasonOfCode(code: string): string {
  if (code === "VOLUNTEER_CONTRACT_EMPTY") return "empty";
  if (code === "VOLUNTEER_CONTRACT_TOO_LARGE") return "tooLarge";
  if (code === "VOLUNTEER_CONTRACT_TYPE") return "type";
  return "gone";
}

/**
 * Draws the page again once (`router.refresh`), so the card, the chips and the count show what was attached — the island's own
 * lines stay. Mounted only after an upload, a new key each time: a server render, which has no router to ask, never draws it.
 */
function RefreshOnce() {
  const router = useRouter();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    router.refresh();
  }, [router]);
  return null;
}

const fill = (text: string, values: Record<string, string | number>) => Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, String(value)), text);

/**
 * «Contract semnat» (§NNN): the file box and its press — on a volunteer's card one file («Încarcă» / «Înlocuiește»), on the
 * event's «Voluntari» list every file at once («Încarcă contractele semnate»).
 *
 * **A real form first.** It posts multipart to the route as it stands, so with scripts off it works: one file comes back to the
 * person's page, many come back to the list with how many were attached. With scripts this island takes the press for what only
 * a browser can do: send a file larger than one request carries in pieces, match many files by their names before a byte goes up,
 * and list the files left with their reasons — in the page, never in an address. Then the page is drawn again (`router.refresh`),
 * so the card, the chips and the count show what was attached.
 *
 * Strings and numbers only cross to it: no row, no component, no element; the glyph by its name. The file box and the press are
 * 44 pixels tall (BR-REQ-041-01 criterion 6).
 */
export default function SignedContractUpload({ mode, action, uploadTemplate, locale, returnTo, maxBytes, partBytes, accept, inputId, labels, testId }: Props) {
  const input = useRef<HTMLInputElement>(null);
  /** How many times the page was asked to be drawn again: each upload that attached something mounts a new `RefreshOnce`. */
  const [refreshes, setRefreshes] = useState(0);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [left, setLeft] = useState<Left[]>([]);
  const busy = status.kind === "busy";
  const sentence = (code: string) => labels.errors[code] ?? labels.errors.FAILED;
  const reasonText = (reason: string) => labels.reasons?.[reason] ?? labels.errors.FAILED;

  /** A file the route would refuse by its length alone, said before it goes up. */
  const tooBig = (file: File) => (file.size === 0 ? "VOLUNTEER_CONTRACT_EMPTY" : file.size > maxBytes ? "VOLUNTEER_CONTRACT_TOO_LARGE" : null);

  async function sendOne(file: File) {
    const refused = tooBig(file);
    if (refused) return setStatus({ kind: "refused", text: sentence(refused) });
    setStatus({ kind: "busy", text: labels.sending });
    const sent = await sendFile(file, action, partBytes);
    if (!sent.ok) return setStatus({ kind: "refused", text: sentence(sent.code) });
    if (input.current) input.current.value = "";
    setStatus({ kind: "done", text: labels.done });
    setRefreshes((count) => count + 1);
  }

  async function sendMany(files: File[]) {
    setLeft([]);
    setStatus({ kind: "busy", text: labels.matching ?? labels.sending });
    const body = new FormData();
    body.set("answer", "json");
    for (const file of files) body.append("names", file.name);
    let matches: Array<{ kind: string; volunteerId?: string; reason?: string }> = [];
    try {
      const response = await fetch(action, { method: "POST", body, credentials: "same-origin" });
      const answer = await answerOf(response);
      if (!response.ok || !Array.isArray(answer?.matches)) return setStatus({ kind: "refused", text: sentence(typeof answer?.error === "string" ? answer.error : "FAILED") });
      matches = answer.matches as typeof matches;
    } catch {
      return setStatus({ kind: "refused", text: sentence("FAILED") });
    }
    const leftOver: Left[] = [];
    // Every file that names one volunteer: the first of theirs, and a later one (`twice`) as a spare behind it.
    const toSend = files.flatMap((file, index) => {
      const match = matches[index];
      if ((match?.kind === "matched" || match?.reason === "twice") && typeof match.volunteerId === "string") return [{ file, volunteerId: match.volunteerId }];
      leftOver.push({ file: file.name, reason: reasonText(match?.reason ?? "gone") });
      return [];
    });
    /** The volunteers a file of this upload was attached to. */
    const attachedTo = new Set<string>();
    for (const [index, { file, volunteerId }] of toSend.entries()) {
      // A spare goes up only when no earlier file of this upload was attached to the person: the earlier one was refused.
      if (attachedTo.has(volunteerId)) {
        leftOver.push({ file: file.name, reason: reasonText("twice") });
        continue;
      }
      setStatus({ kind: "busy", text: fill(labels.sending, { done: index + 1, total: toSend.length }) });
      const refused = tooBig(file);
      const sent = refused ? ({ ok: false, code: refused } as const) : await sendFile(file, (uploadTemplate ?? "").replace("{volunteer}", volunteerId), partBytes);
      if (sent.ok) attachedTo.add(volunteerId);
      else leftOver.push({ file: file.name, reason: reasonText(reasonOfCode(sent.code)) });
    }
    const attached = attachedTo.size;
    if (input.current) input.current.value = "";
    setLeft(leftOver);
    const said = labels.attached ? fill(labels.attached[countForm(attached, locale)], { count: attached }) : "";
    const told = leftOver.length > 0 && labels.left ? ` ${fill(labels.left[countForm(leftOver.length, locale)], { count: leftOver.length })}` : "";
    setStatus({ kind: leftOver.length > 0 && attached === 0 ? "refused" : "done", text: `${said}${told}` });
    if (attached > 0) setRefreshes((count) => count + 1);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const files = Array.from(input.current?.files ?? []);
    if (files.length === 0) return setStatus({ kind: "refused", text: labels.chooseFirst });
    void (mode === "one" ? sendOne(files[0]) : sendMany(files));
  }

  return (
    <Box component="form" method="post" action={action} encType="multipart/form-data" onSubmit={onSubmit} noValidate data-testid={testId} sx={{ minWidth: 0 }}>
      <input type="hidden" name="locale" value={locale} />
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
      <Stack direction={{ xs: "column", sm: "row" }} sx={{ alignItems: { xs: "stretch", sm: "center" }, flexWrap: "wrap", gap: 1 }}>
        {/* The native box, visible: with scripts off it is the only place the chosen file is named. */}
        <input
          ref={input}
          id={inputId}
          type="file"
          name={mode === "one" ? "file" : "files"}
          multiple={mode === "many"}
          accept={accept}
          aria-label={labels.choose}
          disabled={busy}
          data-testid={`${testId}-input`}
          style={{ ...TAP_TARGET, minWidth: 0, maxWidth: "100%", font: "inherit", paddingBlock: 8 }}
        />
        <GlyphButton type="submit" icon="upload" variant="contained" disabled={busy} aria-busy={busy || undefined} sx={TAP_TARGET} data-testid={`${testId}-submit`}>
          {busy ? labels.pending : labels.submit}
        </GlyphButton>
      </Stack>
      {refreshes > 0 && <RefreshOnce key={refreshes} />}
      {status.kind !== "idle" && (
        <Typography
          variant="body2"
          color={status.kind === "refused" ? "error" : "text.secondary"}
          role={status.kind === "refused" ? "alert" : "status"}
          sx={{ mt: 0.5, overflowWrap: "anywhere" }}
          data-testid={`${testId}-status`}
        >
          {status.text}
        </Typography>
      )}
      {left.length > 0 && (
        <Box component="ul" sx={{ mt: 0.5, mb: 0, pl: 2.5 }} data-testid={`${testId}-left`}>
          {left.map((one, index) => (
            <Typography component="li" variant="body2" key={`${one.file}-${index}`} sx={{ overflowWrap: "anywhere" }}>
              {fill(labels.line ?? "{file}: {reason}", { file: one.file, reason: one.reason })}
            </Typography>
          ))}
        </Box>
      )}
    </Box>
  );
}
