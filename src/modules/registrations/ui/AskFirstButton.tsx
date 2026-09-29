"use client";

import EventBusyIcon from "@mui/icons-material/EventBusy";
import PersonRemoveIcon from "@mui/icons-material/PersonRemove";
import Button from "@mui/material/Button";
import { useRef, useState } from "react";
import ConfirmDialog from "@/shared/feedback/ConfirmDialog";
import type { ConfirmSpec } from "@/shared/feedback/notice";
import { glyphSx, WITH_GLYPH_SX } from "@/shared/ui/button-glyph";
import { TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * The public site's two glyphs for a press that asks first (§547) — by name, because a Server
 * Component cannot hand an element across the boundary (§370), and a public page never imports the
 * backoffice's registry (`action-icons.ts`, §318): this island imports exactly the two it draws.
 */
const GLYPHS = { withdraw: PersonRemoveIcon, cancel: EventBusyIcon } as const;

type Props = {
  label: string;
  glyph: keyof typeof GLYPHS;
  /** The question, worded on the server with the person's name and the event (§384). */
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  testId?: string;
};

/**
 * A quiet, irreversible press on a participant's own page that asks first (§547, over §384): «Renunț
 * la înscrierea pentru Mihai» in the declarations wizard, «Anulează înscrierea pentru Mihai» on the
 * manage page. A text-styled button in the error colour, never the page's primary one, with its glyph
 * and its 44-pixel height (BR-REQ-041-01 criterion 6); the press opens the one `ConfirmDialog`, which
 * names the person, and only its red button submits the form this sits in.
 *
 * **A courtesy, not a permission** (BR-REQ-060-01): the Server Action behind the form checks the link
 * and the person on the server, exactly as without the dialog. With JavaScript off there is no
 * dialog and the button posts the form, as every §384 question falls back.
 */
export default function AskFirstButton({ label, glyph, title, body, confirmLabel, cancelLabel, testId }: Props) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const GlyphIcon = GLYPHS[glyph];
  const spec: ConfirmSpec = { title, body, confirmLabel, cancelLabel, destructive: true };

  return (
    <>
      <Button
        ref={anchor}
        type="submit"
        variant="text"
        color="error"
        data-testid={testId}
        sx={{ ...TAP_TARGET, ...WITH_GLYPH_SX, justifyContent: "flex-start", textAlign: "left" }}
        onClick={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
      >
        <GlyphIcon aria-hidden="true" sx={glyphSx("medium")} />
        {label}
      </Button>
      {open && (
        <ConfirmDialog
          spec={spec}
          open
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            setOpen(false);
            anchor.current?.form?.requestSubmit();
          }}
        />
      )}
    </>
  );
}
