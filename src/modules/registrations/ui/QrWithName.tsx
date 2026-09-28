import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { env } from "@/shared/config/env";
import { qrIdentity } from "../domain/qr-identity";

/** The words beside the QR, from the «Registrations» catalogue (`qr.*`, `manage.qrTitle`), filled by the page. */
export type QrWords = {
  /** «Codul QR pentru {name}»: the picture's alternative text. */
  alt: (name: string) => string;
  /** «Număr de concurs: {number}». */
  number: (number: string) => string;
  /** «Cod de acces: {code}». */
  code: (code: string) => string;
};

type Props = {
  checkinCode: string;
  registeredName: string;
  bibNumber: number | null;
  /** The picture's side in pixels: 200 on «Gestionează înscrierea», 160 on «Înscrierile mele». */
  size: number;
  words: QrWords;
};

/**
 * One person's QR code with their name and race number beside it (§NNN; the owner, 2026-09-28: a
 * family's three codes looked the same). The name in bold, then «Număr de concurs: 12» — «—» while
 * none is given — then the access code the desk types when the camera fails. The number is the
 * registration's own (`qrIdentity`): it exists once the registration is confirmed, so nothing here
 * says «provisional».
 *
 * A Server Component, synchronous: the page hands it its words, so the page renders as one tree.
 * Strings in, the picture a hosted PNG from `APP_BASE_URL` (AGENTS.md §8).
 */
export default function QrWithName({ checkinCode, registeredName, bibNumber, size, words }: Props) {
  const who = qrIdentity({ registeredName, bibNumber });
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { xs: "flex-start", sm: "center" } }} data-testid="qr-with-name">
      <Box
        component="img"
        src={`${env.APP_BASE_URL}/api/registrations/qr/${checkinCode}.png`}
        alt={words.alt(who.name)}
        width={size}
        height={size}
        sx={{ width: size, height: size, border: 1, borderColor: "divider", borderRadius: 1, flexShrink: 0 }}
      />
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontWeight: 700, fontSize: "1.125rem", overflowWrap: "anywhere" }} data-testid="qr-name">
          {who.name}
        </Typography>
        <Typography sx={{ fontWeight: 700, fontSize: "1.375rem", color: "primary.main" }} data-testid="qr-number">
          {words.number(who.number)}
        </Typography>
        <Typography sx={{ fontFamily: "monospace", fontWeight: 700, letterSpacing: 2 }} data-testid="qr-code">
          {words.code(checkinCode)}
        </Typography>
      </Box>
    </Stack>
  );
}
