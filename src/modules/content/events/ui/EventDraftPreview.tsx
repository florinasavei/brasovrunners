"use client";

import ArticleIcon from "@mui/icons-material/Article";
import DesktopWindowsIcon from "@mui/icons-material/DesktopWindows";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import SmartphoneIcon from "@mui/icons-material/Smartphone";
import TranslateIcon from "@mui/icons-material/Translate";
import ViewAgendaIcon from "@mui/icons-material/ViewAgenda";
import VisibilityIcon from "@mui/icons-material/Visibility";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fieldLabelOf, revealField } from "@/shared/forms/ActionFormIsland";
import { fieldId } from "@/shared/forms/outcome";
import { type DraftPreviewView, type FromFrame, formEntries, readPreviewMessage, type ToFrame } from "./draft-preview-messages";

type Locale = "ro" | "en";
type Width = "phone" | "desktop";
type Outcome = Extract<FromFrame, { type: "br-draft-preview:result" }>;

/** The two widths the frame is drawn at: a phone's 360 pixels, and a desktop's, scaled down to fit. */
export const DRAFT_PREVIEW_WIDTH: Readonly<Record<Width, number>> = { phone: 360, desktop: 1280 };

/** The frame's height before it has said how tall it is. */
const FRAME_MIN_HEIGHT = 120;

export type EventDraftPreviewLabels = {
  run: string;
  running: string;
  views: string;
  card: string;
  page: string;
  form: string;
  language: string;
  width: string;
  phone: string;
  desktop: string;
  idle: string;
  asOfPress: string;
  /** "{language} incomplet — lipsește: {missing}", raw; filled here. */
  incomplete: string;
  complete: string;
  refused: string;
  failed: string;
  forbidden: string;
  frameTitle: string;
};

const BOTH: Record<Locale, false> = { ro: false, en: false };

/**
 * **«Previzualizare» in the event editor (§579, amending §406 and §371)** — the owner, 2026-09-30:
 * «vreau să pot face preview la eveniment, înainte de salvare și publicare, ca să știu cum arată,
 * atât pe card cât și descrierea completă».
 *
 * «Previzualizează» takes the save form's values as they stand (`formEntries` on `#formId`, the form
 * «Salvează» / «Creează» posts) and hands them to a frame of the site itself, in the language chosen,
 * which asks the server once and draws the listing card, the event page or the registration form
 * with the listing's, the page's and the register page's own parts (`EventDraftFrame`,
 * `draft-preview.tsx`, `draft-form.tsx` — «Formular», §586). Nothing is saved or published: the
 * frame's action writes nothing, and the form it draws sends nothing.
 *
 * **Why a frame, and not markup painted into this page.** The card and the page are the site's
 * components with the site's theme, fonts and words — the public catalogue in the language being
 * previewed, not the backoffice's — and their breakpoints are the screen's: a 360-pixel box inside a
 * desktop editor would still be laid out as a desktop. A frame of the site's own layout is a real
 * 360-pixel screen, or a real desktop scaled down, with nothing copied. It is `sandbox`ed: it opens
 * no window, sends no form and never navigates the editor, and its own links go nowhere.
 *
 * **The press paints first (§371)**: the button says it is working and the frame dims the moment it
 * is pressed, before any request. A frame is loaded on its language's first press only — nothing is
 * asked while nobody presses, no polling, no redraw on a keystroke. Card | Pagina and the width redraw
 * nothing; a language not yet drawn for the last press is drawn when it is chosen.
 */
export default function EventDraftPreview({
  formId,
  frameSrc,
  languageCodes,
  languageNames,
  fieldLabels,
  errors,
  labels,
}: {
  formId: string;
  /** The frame's address in each language (`/ro/previzualizare/ciorna`, `/en/preview/draft`). */
  frameSrc: Readonly<Record<Locale, string>>;
  /** The site's locale switcher's words, «RO» | «EN». */
  languageCodes: Readonly<Record<Locale, string>>;
  /** The languages in their own words, for the «incomplet» line. */
  languageNames: Readonly<Record<Locale, string>>;
  /** Every box's label by the name it posts — the save's refusal summary's (`eventFormFieldLabels`). */
  fieldLabels: Readonly<Record<string, string>>;
  /** `Admin.errors`, raw: a refusal's sentence by its code. */
  errors: Readonly<Record<string, string>>;
  labels: EventDraftPreviewLabels;
}) {
  const [view, setView] = useState<DraftPreviewView>("card");
  const [locale, setLocale] = useState<Locale>("ro");
  const [width, setWidth] = useState<Width>("phone");
  /** The languages whose frame is on the page: a frame loads on its language's first press. */
  const [mounted, setMounted] = useState<Locale[]>([]);
  const [pending, setPending] = useState<Record<Locale, boolean>>(BOTH);
  const [outcomes, setOutcomes] = useState<Partial<Record<Locale, Outcome>>>({});
  const [heights, setHeights] = useState<Record<Locale, number>>({ ro: 0, en: 0 });
  const [available, setAvailable] = useState(0);
  const [pressed, setPressed] = useState(false);

  const frames = useRef<Partial<Record<Locale, HTMLIFrameElement | null>>>({});
  const ready = useRef<Record<Locale, boolean>>({ ro: false, en: false });
  /** The values of the last press, numbered; and which press each language was last asked to draw. */
  const snapshot = useRef<{ id: number; entries: [string, string][] } | null>(null);
  const asked = useRef<Record<Locale, number>>({ ro: 0, en: 0 });
  const wrapper = useRef<HTMLDivElement>(null);
  /** The view a frame is asked to open on, kept beside the state for the message handlers. */
  const viewNow = useRef<DraftPreviewView>("card");

  const send = useCallback((target: Locale, message: ToFrame) => {
    frames.current[target]?.contentWindow?.postMessage(message, window.location.origin);
  }, []);

  /** Ask one language's frame to draw the last press's values — once per press, and only once it is loaded. */
  const draw = useCallback(
    (target: Locale) => {
      const values = snapshot.current;
      if (!values || !ready.current[target] || asked.current[target] === values.id) return;
      asked.current[target] = values.id;
      send(target, { type: "br-draft-preview:render", entries: values.entries, view: viewNow.current, snapshot: values.id });
    },
    [send],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const message = readPreviewMessage<FromFrame>(event.data);
      if (!message) return;
      const from = (Object.keys(frames.current) as Locale[]).find((code) => frames.current[code]?.contentWindow === event.source);
      if (!from) return;
      if (message.type === "br-draft-preview:ready") {
        ready.current[from] = true;
        draw(from);
      } else if (message.type === "br-draft-preview:height") {
        setHeights((current) => (current[from] === message.height ? current : { ...current, [from]: message.height }));
      } else if (message.snapshot === snapshot.current?.id) {
        setOutcomes((current) => ({ ...current, [from]: message }));
        setPending((current) => ({ ...current, [from]: false }));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [draw]);

  // How wide the card is, so a desktop's frame is scaled down to fit it.
  const hasFrames = mounted.length > 0;
  useLayoutEffect(() => {
    const box = wrapper.current;
    if (!box) return;
    const measure = () => setAvailable(box.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [hasFrames]);

  /** Draw `target` from the last press: its frame loads first when it is not on the page yet. */
  const showIn = (target: Locale) => {
    if (!snapshot.current || asked.current[target] === snapshot.current.id) return;
    setPending((current) => ({ ...current, [target]: true }));
    if (mounted.includes(target)) draw(target);
    else setMounted((current) => [...current, target]);
  };

  const press = () => {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return;
    // The press paints first (§371): the state says so before anything is asked.
    setPressed(true);
    snapshot.current = { id: (snapshot.current?.id ?? 0) + 1, entries: formEntries(form) };
    showIn(locale);
  };

  const chooseLocale = (next: Locale | null) => {
    if (!next || next === locale) return;
    setLocale(next);
    showIn(next);
  };

  const chooseView = (next: DraftPreviewView | null) => {
    if (!next) return;
    viewNow.current = next;
    setView(next);
    for (const target of mounted) send(target, { type: "br-draft-preview:view", view: next });
  };

  const frameWidth = DRAFT_PREVIEW_WIDTH[width];
  const scale = available > 0 ? Math.min(1, available / frameWidth) : 1;
  const outcome = outcomes[locale];
  const busy = pending[locale];

  const missingLines =
    outcome?.outcome === "ready"
      ? (Object.keys(languageNames) as Locale[]).flatMap((code) => {
          const names = outcome.missing?.[code] ?? [];
          if (names.length === 0) return [];
          const missing = names.map((name) => fieldLabelOf(fieldLabels, name)).join(" · ");
          return [{ code, text: labels.incomplete.replace("{language}", languageNames[code]).replace("{missing}", missing) }];
        })
      : [];

  return (
    <Stack spacing={1.5} data-testid="draft-preview">
      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
        <ToggleButtonGroup exclusive size="small" value={view} onChange={(_, next: DraftPreviewView | null) => chooseView(next)} aria-label={labels.views}>
          <ToggleButton value="card" sx={TOGGLE_SX} data-testid="draft-preview-view-card">
            <ViewAgendaIcon aria-hidden="true" fontSize="small" />
            {labels.card}
          </ToggleButton>
          <ToggleButton value="page" sx={TOGGLE_SX} data-testid="draft-preview-view-page">
            <ArticleIcon aria-hidden="true" fontSize="small" />
            {labels.page}
          </ToggleButton>
          {/* The registration form (§586, amending §579): the glyph of the five steps' «form» step. */}
          <ToggleButton value="form" sx={TOGGLE_SX} data-testid="draft-preview-view-form">
            <PersonAddIcon aria-hidden="true" fontSize="small" />
            {labels.form}
          </ToggleButton>
        </ToggleButtonGroup>
        <ToggleButtonGroup exclusive size="small" value={locale} onChange={(_, next: Locale | null) => chooseLocale(next)} aria-label={labels.language}>
          {(Object.keys(languageCodes) as Locale[]).map((code) => (
            <ToggleButton key={code} value={code} sx={TOGGLE_SX} data-testid={`draft-preview-locale-${code}`} aria-label={languageNames[code]}>
              <TranslateIcon aria-hidden="true" fontSize="small" />
              {languageCodes[code]}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <ToggleButtonGroup exclusive size="small" value={width} onChange={(_, next: Width | null) => next && setWidth(next)} aria-label={labels.width}>
          <ToggleButton value="phone" sx={TOGGLE_SX} data-testid="draft-preview-width-phone">
            <SmartphoneIcon aria-hidden="true" fontSize="small" />
            {labels.phone}
          </ToggleButton>
          <ToggleButton value="desktop" sx={TOGGLE_SX} data-testid="draft-preview-width-desktop">
            <DesktopWindowsIcon aria-hidden="true" fontSize="small" />
            {labels.desktop}
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      <Box>
        <Button
          type="button"
          variant="contained"
          onClick={press}
          startIcon={<VisibilityIcon />}
          sx={{ minHeight: 44 }}
          aria-busy={busy || undefined}
          data-testid="draft-preview-run"
        >
          {busy ? labels.running : labels.run}
        </Button>
      </Box>

      <Box aria-live="polite">
        {!pressed && (
          <Typography variant="body2" color="text.secondary">
            {labels.idle}
          </Typography>
        )}
        {outcome?.outcome === "ready" && (
          <Stack spacing={1}>
            {missingLines.length === 0 ? (
              <Typography variant="body2" color="text.secondary" data-testid="draft-preview-complete">
                {labels.complete}
              </Typography>
            ) : (
              missingLines.map((line) => (
                <Alert key={line.code} severity="warning" data-testid={`draft-preview-incomplete-${line.code}`}>
                  {line.text}
                </Alert>
              ))
            )}
            <Typography variant="caption" color="text.secondary">
              {labels.asOfPress}
            </Typography>
          </Stack>
        )}
        {outcome?.outcome === "refused" && (
          <Alert severity="error" data-testid="draft-preview-refused">
            <AlertTitle>{labels.refused}</AlertTitle>
            {outcome.error && errors[outcome.error] && (
              <Box component="p" sx={{ m: 0 }}>
                {errors[outcome.error]}
              </Box>
            )}
            {(outcome.fields ?? []).length > 0 && (
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {(outcome.fields ?? []).map((name) => (
                  <li key={name}>
                    {/* The box itself, opened and brought forward, as the save's summary links it (§315). */}
                    <Link href={`#${fieldId(name)}`} color="inherit" onClick={() => revealField(document.getElementById(fieldId(name)))}>
                      {fieldLabelOf(fieldLabels, name)}
                    </Link>
                  </li>
                ))}
              </Box>
            )}
          </Alert>
        )}
        {(outcome?.outcome === "failed" || outcome?.outcome === "notFound") && <Alert severity="error">{labels.failed}</Alert>}
        {outcome?.outcome === "forbidden" && <Alert severity="info">{labels.forbidden}</Alert>}
      </Box>

      {hasFrames && (
        <Box ref={wrapper} sx={{ width: "100%", overflow: "hidden" }}>
          {mounted.map((code) => (
            <Box
              key={code}
              sx={{
                display: code === locale && outcomes[code]?.outcome !== "refused" ? "block" : "none",
                width: frameWidth * scale,
                height: Math.max(heights[code], FRAME_MIN_HEIGHT) * scale,
                mx: "auto",
                border: 1,
                borderColor: "divider",
                borderRadius: 1,
                overflow: "hidden",
                opacity: pending[code] ? 0.55 : 1,
                transition: "opacity 120ms",
              }}
            >
              <Box
                component="iframe"
                ref={(element: HTMLIFrameElement | null) => {
                  frames.current[code] = element;
                }}
                src={frameSrc[code]}
                title={`${labels.frameTitle} · ${languageNames[code]}`}
                // Its own scripts and its own session, nothing else: no window, no top navigation, no form.
                sandbox="allow-scripts allow-same-origin"
                data-testid={`draft-preview-frame-${code}`}
                sx={{
                  display: "block",
                  border: 0,
                  width: frameWidth,
                  height: Math.max(heights[code], FRAME_MIN_HEIGHT),
                  transform: `scale(${scale})`,
                  transformOrigin: "top left",
                }}
              />
            </Box>
          ))}
        </Box>
      )}
    </Stack>
  );
}

/** A toggle a thumb can hit (BR-REQ-041-01 criterion 6), its glyph before its word (§521). */
const TOGGLE_SX = { minHeight: 44, gap: 0.75, px: 1.5, textTransform: "none" } as const;
