import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CopyCodeButton from "@/modules/content/member-codes/ui/CopyCodeButton";

type Props = {
  title: string;
  help: string;
  /** Which language the lines are in, said only when it is not the staff member's own (§NNN). */
  languageNote: string | null;
  /** The registration's language: the lines' `lang`, so a screen reader reads them in it. */
  lang: string;
  lines: string[];
  copyLabel: string;
  copiedLabel: string;
};

/**
 * «Ce îi spui» (§NNN): the sentences somebody is told when they ask where their registration stands,
 * on the registration's page, under the state and above the verbs. Server-rendered words; the one
 * client island is the copy button, which takes the same text as a string (`CopyCodeButton`, §552) —
 * without JavaScript the lines are there to select. No address and no verb: every role that reads the
 * page reads it, the Organizer too (§289).
 */
export default function WhatToTell({ title, help, languageNote, lang, lines, copyLabel, copiedLabel }: Props) {
  const text = lines.join(" ");
  return (
    <Box component="section" data-testid="what-to-tell" sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2, minWidth: 0 }}>
      <Typography variant="h3" sx={{ fontSize: "1rem", mb: 0.5 }}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {help}
      </Typography>
      {languageNote && (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }} data-testid="what-to-tell-language">
          {languageNote}
        </Typography>
      )}
      <Stack spacing={0.5} lang={lang} data-testid="what-to-tell-lines">
        {lines.map((line) => (
          <Typography key={line} variant="body2">
            {line}
          </Typography>
        ))}
      </Stack>
      <Box sx={{ mt: 1.5 }}>
        <CopyCodeButton code={text} label={copyLabel} copiedLabel={copiedLabel} />
      </Box>
    </Box>
  );
}
