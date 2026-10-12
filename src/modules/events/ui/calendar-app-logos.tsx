import AppleIcon from "@mui/icons-material/Apple";
import { PROVIDER_LOGO } from "@/theme/brand";

/**
 * The three calendar apps' marks in the subscribe box (`SubscribeBox`): a reader looks for their
 * app's logo before its name. Plain SVG drawn on the server, decoration only (`aria-hidden`): the
 * row's words name the app. 20 pixels square, the size `SubscribeBox` gives every row's glyph.
 */

/** Google's «G», in its four colours. */
export function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true" focusable="false">
      <path fill={PROVIDER_LOGO.googleRed} d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill={PROVIDER_LOGO.googleBlue} d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill={PROVIDER_LOGO.googleYellow} d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill={PROVIDER_LOGO.googleGreen} d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** Apple's apple, in the text's own ink: black by day, white after dark, as Apple draws it. */
export function AppleLogo() {
  return <AppleIcon aria-hidden="true" sx={{ color: "text.primary" }} />;
}

/** Outlook's mark: the envelope behind, the «O» tile in front, in its two blues. */
export function OutlookLogo() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <rect x="7" y="4" width="15" height="16" rx="2" fill={PROVIDER_LOGO.outlookLight} />
      <path d="M7 9.5 14.5 14 22 9.5" fill="none" stroke={PROVIDER_LOGO.outlookInk} strokeWidth="1.2" strokeLinejoin="round" />
      <rect x="2" y="7" width="11" height="10" rx="1.5" fill={PROVIDER_LOGO.outlookBlue} />
      <ellipse cx="7.5" cy="12" rx="2.4" ry="2.9" fill="none" stroke={PROVIDER_LOGO.outlookInk} strokeWidth="1.5" />
    </svg>
  );
}
