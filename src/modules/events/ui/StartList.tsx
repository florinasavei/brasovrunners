import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { listPublicStartList } from "@/modules/registrations/repository";
import type { PublicEvent } from "../repository";

/**
 * Who is coming (BR-REQ-039-01, BR-REQ-039-02; `DECISIONS.md` §32, §85): the confirmed, real,
 * not-opted-out participants of an event whose organizer switched the list on.
 *
 * A native disclosure, closed, with the count in its summary: a page whose bottom third is a
 * list of names reads like a list of names, and the event page is about the event. Each row
 * is the display name and — since §85 — the club they wrote, because "who is coming" at a
 * race is answered by clubs as much as by names. Nothing else: the select list in the
 * repository is the guarantee.
 */
export default async function StartList({ event }: { event: PublicEvent }) {
  if (event.participantListVisibility !== "NAMES") return null;

  const t = await getTranslations("Event");
  const participants = await listPublicStartList(getDb(), event.id);

  return (
    <Box
      component="details"
      aria-labelledby="start-list-title"
      data-testid="start-list"
      sx={{
        mt: 4,
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        px: 2,
        "& > summary": { cursor: "pointer", py: 1.5, minHeight: 44, listStyle: "revert" },
      }}
    >
      <Typography component="summary" id="start-list-title" variant="h2" sx={{ fontSize: "1.25rem" }}>
        {t("startList.titleCount", { count: participants.length })}
      </Typography>

      {participants.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ pb: 2 }}>
          {t("startList.empty")}
        </Typography>
      ) : (
        <>
          <Box component="ol" sx={{ listStyle: "none", p: 0, m: 0, columnGap: 3, columns: { sm: 2, md: 3 } }}>
            {participants.map((participant, index) => (
              // The name is not unique — two people called Ana Popescu may both be running —
              // so the position in the confirmed order is what identifies the row to React.
              <Typography component="li" variant="body1" key={`${index}-${participant.displayName}`} sx={{ py: 0.25, breakInside: "avoid" }}>
                {participant.displayName}
                {participant.clubName && (
                  <Typography component="span" variant="body2" color="text.secondary">
                    {" · "}
                    {participant.clubName}
                  </Typography>
                )}
              </Typography>
            ))}
          </Box>

          {/* Said on the page rather than only in the privacy notice: somebody reading their own
              name here should be able to see, without leaving, that it was their choice and how
              to change it. */}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2, pb: 2 }}>
            {t("startList.note")}
          </Typography>
        </>
      )}
    </Box>
  );
}
