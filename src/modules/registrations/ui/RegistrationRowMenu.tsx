"use client";

import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import PersonAddAlt1Icon from "@mui/icons-material/PersonAddAlt1";
import RemoveCircleIcon from "@mui/icons-material/RemoveCircle";
import UndoIcon from "@mui/icons-material/Undo";
import VisibilityIcon from "@mui/icons-material/Visibility";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import { useState } from "react";

/**
 * A registration's verbs behind "⋮" (`DECISIONS.md` §178).
 *
 * The owner: "trebe sa pot face management de inscrieri mai eficient", "CRUD participants",
 * "and statuses should be drop-down". The drop-down is **this** — the verbs that already exist,
 * each the same Server Action the registration's own page calls — and deliberately not a status
 * select. Picking a state and saving would be a second write path into `registrations` past the
 * allocator that hands out places under a lock (`AGENTS.md` §10.6), past the signed declaration a
 * confirmation requires (§10.8), and past §15.11's closed list of what staff may do. Every verb
 * here goes the long way round, through its service, which checks the role again
 * (BR-REQ-060-01).
 *
 * The same shape as `EventRowMenu` and for the same reasons: the Server Component renders a
 * hidden `<form>` per verb, already carrying its action and its fields, and this island calls
 * `requestSubmit()` on the one that was chosen. Nothing about authorization lives here; what
 * lives here is which form to post and whether to ask first.
 */
export type RegistrationMenuIcon = "open" | "resend" | "confirm" | "place" | "checkIn" | "undo" | "cancel";

const ICONS: Record<RegistrationMenuIcon, typeof MoreVertIcon> = {
  open: VisibilityIcon,
  resend: PersonAddAlt1Icon,
  confirm: CheckCircleIcon,
  place: HowToRegIcon,
  checkIn: HowToRegIcon,
  undo: UndoIcon,
  cancel: RemoveCircleIcon,
};

export type RegistrationMenuItem =
  | { kind: "link"; label: string; href: string; icon: RegistrationMenuIcon }
  | {
      kind: "submit";
      label: string;
      icon: RegistrationMenuIcon;
      /** The id of a hidden form the page already rendered, whose Server Action this submits. */
      formId: string;
      color?: "primary" | "error" | "warning";
      /** Present for a verb that is hard to undo; absent for one that is a press away from being reversed. */
      confirm?: { title: string; body: string; confirmLabel: string };
    };

export default function RegistrationRowMenu({
  ariaLabel,
  cancelLabel,
  items,
}: {
  ariaLabel: string;
  cancelLabel: string;
  items: readonly RegistrationMenuItem[];
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [confirming, setConfirming] = useState<Extract<RegistrationMenuItem, { kind: "submit" }> | null>(null);

  const submit = (formId: string) => {
    // `requestSubmit`, never `submit()`: it runs the form's own validation and fires the event
    // React's Server Action handler listens for.
    (document.getElementById(formId) as HTMLFormElement | null)?.requestSubmit();
  };

  return (
    <>
      <IconButton aria-label={ariaLabel} onClick={(event) => setAnchor(event.currentTarget)} sx={{ minHeight: 44, minWidth: 44 }}>
        <MoreVertIcon />
      </IconButton>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          if (item.kind === "link") {
            return (
              <MenuItem key={item.label} component="a" href={item.href} onClick={() => setAnchor(null)} sx={{ minHeight: 44 }}>
                <ListItemIcon>
                  <Icon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{item.label}</ListItemText>
              </MenuItem>
            );
          }
          return (
            <MenuItem
              key={item.label}
              onClick={() => {
                setAnchor(null);
                if (item.confirm) setConfirming(item);
                else submit(item.formId);
              }}
              sx={{ minHeight: 44, ...(item.color === "error" ? { color: "error.main" } : {}) }}
            >
              <ListItemIcon sx={item.color === "error" ? { color: "error.main" } : undefined}>
                <Icon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{item.label}</ListItemText>
            </MenuItem>
          );
        })}
      </Menu>

      <Dialog open={confirming !== null} onClose={() => setConfirming(null)} aria-labelledby="registration-confirm-title">
        <DialogTitle id="registration-confirm-title">{confirming?.confirm?.title}</DialogTitle>
        <DialogContent>
          <DialogContentText>{confirming?.confirm?.body}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(null)} sx={{ minHeight: 44 }}>
            {cancelLabel}
          </Button>
          <Button
            color={confirming?.color ?? "primary"}
            variant="contained"
            sx={{ minHeight: 44 }}
            onClick={() => {
              const item = confirming;
              setConfirming(null);
              if (item) submit(item.formId);
            }}
          >
            {confirming?.confirm?.confirmLabel}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
