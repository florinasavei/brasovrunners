import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import type { EmailMessageType } from "@/db/schema/email-outbox";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import Panel from "@/shared/ui/Panel";
import SubNav, { type SubNavItem } from "@/shared/ui/SubNav";

/** One message, already rendered and translated: this component decides only the shape. */
export type ParticipantEmailCard = {
  type: EmailMessageType;
  /** The message's name — "Confirmă adresa de email". */
  name: string;
  /** When it is sent, in a few words, for the closed card's summary. */
  whenShort: string;
  /**
   * "nu se mai trimite", for a type nothing queues any more (§331, `domain/never-queued.ts`):
   * said in the closed card's summary, before `whenShort`, so the list never reads as mail
   * somebody receives. Absent for every type that is sent.
   */
  neverSent?: string;
  /** When it is sent, in full, as the first line inside the card. */
  when: string;
  /** "Subiect: …", as the participant's inbox will show it. */
  subjectLine: string;
  /** The message as it goes out, for the sandboxed preview. */
  html: string;
  /** Whether this card opens by itself: its words were just saved (§NNN). */
  justSaved: boolean;
  /** The words' editor, for whoever writes them (§247); absent for everybody else. */
  editor?: ReactNode;
};

type Props = {
  title: string;
  intro: string;
  /** What the closed card says: how many messages, in which language. */
  aside: string;
  /** "The language the messages are shown in", above the switch it names. */
  languageLabel: string;
  /** The language switch (§268), one entry per locale. */
  languages: readonly SubNavItem[];
  messages: readonly ParticipantEmailCard[];
  openWhen?: FoldOpenWhen;
};

/**
 * Every message a participant can receive, as one card of cards (`DECISIONS.md` §NNN; the
 * owner, 2026-09-23: "'Emailurile trimise participanților' should be a master card with smaller
 * cards within").
 *
 * It was a heading, a language switch and a run of eighteen folds straight on the page, below
 * the panels — nothing said where the list ended, and the switch sat above the list as if it
 * applied to the whole screen. Now the list is one fold, closed, and the switch is inside it,
 * first, under a line that says what it switches: it changes the previews and the words being
 * edited, and nothing else on the page.
 *
 * Each message is a fold of its own inside it, closed, whose summary is the message's name and
 * when it goes out — the two things somebody scans the list for — with the full sentence, the
 * subject, the preview and the words inside. Every card is `Panel`, the outer one at heading
 * level 2 and the inner ones at 3, so the screen and a screen reader's heading list have the
 * same shape. A Server Component with no state: the folds are `<details>`, and the switch is a
 * pair of links, so all of it works with JavaScript off.
 */
export default function ParticipantEmailsPanel({ title, intro, aside, languageLabel, languages, messages, openWhen }: Props) {
  return (
    <Panel title={title} intro={intro} aside={aside} collapsible openWhen={openWhen} id="participant-emails" data-testid="participant-emails">
      <Box sx={{ mb: 2 }} data-testid="participant-emails-language">
        <Typography variant="body2" sx={{ fontWeight: 500, mb: 1 }}>
          {languageLabel}
        </Typography>
        <SubNav items={languages} />
      </Box>
      <Stack spacing={1}>
        {messages.map((message) => (
          <Panel
            key={message.type}
            title={message.name}
            aside={
              message.neverSent ? (
                <>
                  <Box component="span" data-testid="participant-email-never-sent" sx={{ color: "warning.main", fontWeight: 600 }}>
                    {message.neverSent}
                  </Box>
                  {` · ${message.whenShort}`}
                </>
              ) : (
                message.whenShort
              )
            }
            intro={message.when}
            collapsible
            level={3}
            openWhen={{ saved: message.justSaved }}
            id={`email-${message.type}`}
            data-testid="participant-email"
          >
            <Typography variant="body2" sx={{ mb: 1, wordBreak: "break-word" }}>
              {message.subjectLine}
            </Typography>
            {/* Sandboxed: an email has its own `<html>` and styles and must not inherit the backoffice's (§91). */}
            <Box
              component="iframe"
              srcDoc={message.html}
              sandbox=""
              title={message.name}
              sx={{ width: "100%", height: 620, border: 1, borderColor: "divider", borderRadius: 1, mb: 2 }}
            />
            {message.editor}
          </Panel>
        ))}
      </Stack>
    </Panel>
  );
}
