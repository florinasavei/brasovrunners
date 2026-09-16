import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { listPublicStartList } from "@/modules/registrations/repository";
import type { PublicEvent } from "../repository";

/**
 * Who is coming, when the club has decided to say (BR-REQ-039-01).
 *
 * Off unless the event's own `participant_list_visibility` is `NAMES`, which no event has by
 * default and which an organizer sets one event at a time. This renders nothing at all
 * otherwise — not an empty heading, not a count, nothing that says a list exists.
 *
 * What it can show is exactly what `listPublicStartList` returns: the names of the people who
 * confirmed and did not ask to be left out, in the order they confirmed. There is no code path
 * here that could render an address, a status or a number of people still deciding, because
 * none of those is fetched.
 */
export default async function StartList({ event }: { event: PublicEvent }) {
  if (event.participantListVisibility !== "NAMES") return null;

  const t = await getTranslations("Event");
  const participants = await listPublicStartList(getDb(), event.id);

  return (
    <Box component="section" aria-labelledby="start-list-title" sx={{ mt: 4 }}>
      <Typography id="start-list-title" variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
        {t("startList.title")}
      </Typography>

      {participants.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("startList.empty")}
        </Typography>
      ) : (
        <>
          <Stack component="ol" spacing={0.5} sx={{ listStyle: "none", p: 0, m: 0 }}>
            {participants.map((participant, index) => (
              // The name is not unique — two people called Ana Popescu may both be running —
              // so the position in the confirmed order is what identifies the row to React.
              <Typography component="li" variant="body1" key={`${index}-${participant.displayName}`}>
                {participant.displayName}
              </Typography>
            ))}
          </Stack>

          {/* Said on the page rather than only in the privacy notice: somebody reading their own
              name here should be able to see, without leaving, that it was their choice and how
              to change it. */}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            {t("startList.note")}
          </Typography>
        </>
      )}
    </Box>
  );
}
