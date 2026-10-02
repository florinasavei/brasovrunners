import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getLocale, getTranslations } from "next-intl/server";
import type { Deadlines } from "@/modules/deadlines/domain/deadlines";
import {
  type PlaceDeadlineCounts,
  type PlaceDeadlineEvent,
  type PlaceDeadlineGroup,
  type PlaceDeadlineLine,
  placeDeadlineSentences,
} from "../domain/place-deadlines";

/**
 * «Când se pierde un loc» (§NNN; the owner, 2026-10-02: «Când pierde lumea locul? Trebuie să apară asta
 * în back-office»): the sentences of `domain/place-deadlines.ts`, one per line, for one event — under
 * «Cine s-a înscris» on the list scoped to it, in the event's «Înscrierile primite», and (the held
 * places' alone) beside the queue's «Rezervate». Server-rendered text, nothing to press. Nothing at all
 * when no count has a sentence.
 *
 * Every role that reads the registrations reads it (§289: the Organizer too); the page asserts that
 * before it reads the counts.
 */
type Input = {
  event: PlaceDeadlineEvent;
  counts: PlaceDeadlineCounts;
  deadlines: Pick<Deadlines, "confirmationHours" | "holdMinutes" | "offerHours">;
  now: Date;
  /** The zone the dates are written in: the club's on the list, the event's beside its other times. */
  timeZone: string;
  /** Only these parts; all of them when absent. */
  groups?: readonly PlaceDeadlineGroup[];
};

/** The lines, in the reader's language, from the `Admin` translator the caller already holds. */
export function placeDeadlineLines(input: Input & { locale: string; t: (key: string, values?: Record<string, string | number>) => string }): PlaceDeadlineLine[] {
  const { groups, ...rest } = input;
  return placeDeadlineSentences(rest).filter((line) => !groups || groups.includes(line.group));
}

/** The lines as text, with «Când se pierde un loc» above them when `heading` is given — synchronous, for a panel rendered whole. */
export function PlaceDeadlineText({
  lines,
  heading,
  testId = "place-deadlines",
  spaceAbove = 0,
}: {
  lines: readonly PlaceDeadlineLine[];
  heading?: string;
  testId?: string;
  /** The gap above the block, in theme units — only when it is drawn. */
  spaceAbove?: number;
}) {
  if (lines.length === 0) return null;
  return (
    <Box data-testid={testId} sx={{ mt: spaceAbove }}>
      {heading && (
        <Typography variant="subtitle2" component="p" sx={{ fontWeight: 600, mb: 0.5 }}>
          {heading}
        </Typography>
      )}
      {lines.map((line, index) => (
        <Typography key={index} variant="body2" color="text.secondary" data-group={line.group}>
          {line.text}
        </Typography>
      ))}
    </Box>
  );
}

export default async function PlaceDeadlines(props: Input & { testId?: string; spaceAbove?: number }) {
  const t = await getTranslations("Admin");
  const locale = await getLocale();
  const lines = placeDeadlineLines({ ...props, locale, t: (key, values) => t(key, values) });
  return <PlaceDeadlineText lines={lines} heading={t("registrations.placeDeadlines.title")} testId={props.testId} spaceAbove={props.spaceAbove} />;
}
