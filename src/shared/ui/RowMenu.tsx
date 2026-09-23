"use client";

import MoreVertIcon from "@mui/icons-material/MoreVert";
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
import { ACTION_ICONS, type ActionIconName } from "./action-icons";

/**
 * The glyph before a verb (the owner: "these should also have icons"), by name — the menu is a
 * client island and makes the element. The names are the one registry's (§318), so a verb in
 * this menu wears the glyph the same verb wears on a button anywhere else.
 */
export type RowMenuIcon = ActionIconName;

export type RowMenuItem =
  /**
   * `color` on a link, for the one link that is a destructive verb's front door: the hard
   * delete opens a screen rather than submitting a form (it has a typed confirmation to ask
   * for), and a menu entry that looks like "Preview" is the wrong preparation for it.
   */
  | { kind: "link"; label: string; href: string; icon?: RowMenuIcon; color?: "error" }
  | {
      kind: "submit";
      label: string;
      icon?: RowMenuIcon;
      /** The id of a form already in the page whose Server Action this item submits. */
      formId: string;
      confirm: { title: string; body: string; confirmLabel: string };
      color?: "primary" | "error" | "warning";
    }
  | { kind: "note"; label: string };

/**
 * The row's "more actions" as a context menu (the owner, 2026-09-18: "More actions should be
 * a context menu").
 *
 * Until now a native `<details>` — no JavaScript, which is the standing preference — but the
 * open disclosure pushed the row down and held two buttons under it, which read as a form
 * rather than a menu. This is the third client island the events list pays for, and it earns
 * it: a menu anchored to the button, closed on the next tap anywhere, is what every other app
 * on the phone does with "⋮".
 *
 * The verbs stay Server Actions. Each `submit` item names a hidden form the page already
 * rendered — the action, the event id, the UI locale — and the confirmation ends in
 * `requestSubmit()` on it, exactly as `ConfirmSubmitButton` does, so nothing behind the menu
 * changed: the role check, the version guard and the refusal to delete an event with
 * registrations against it are the server's, and this only decides which form to post.
 */
export default function RowMenu({
  items,
  ariaLabel,
  cancelLabel,
}: {
  items: RowMenuItem[];
  ariaLabel: string;
  cancelLabel: string;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [pending, setPending] = useState<Extract<RowMenuItem, { kind: "submit" }> | null>(null);
  const glyph = (name: RowMenuIcon | undefined) => {
    if (!name) return null;
    const Icon = ACTION_ICONS[name];
    return (
      <ListItemIcon sx={{ color: "inherit", minWidth: 32 }}>
        <Icon fontSize="small" />
      </ListItemIcon>
    );
  };
  const open = Boolean(anchor);

  return (
    <>
      <IconButton
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open ? "true" : undefined}
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{ minHeight: 40, minWidth: 40, border: 1, borderColor: "divider", borderRadius: 1 }}
        size="small"
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>

      <Menu anchorEl={anchor} open={open} onClose={() => setAnchor(null)}>
        {items.map((item, index) => {
          if (item.kind === "link") {
            return (
              <MenuItem
                key={index}
                component="a"
                href={item.href}
                onClick={() => setAnchor(null)}
                sx={item.color === "error" ? { color: "error.main" } : undefined}
              >
                {glyph(item.icon)}
                <ListItemText>{item.label}</ListItemText>
              </MenuItem>
            );
          }
          if (item.kind === "note") {
            return (
              <MenuItem key={index} disabled sx={{ whiteSpace: "normal", maxWidth: 280 }}>
                <ListItemText secondary={item.label} />
              </MenuItem>
            );
          }
          return (
            <MenuItem
              key={index}
              onClick={() => {
                setAnchor(null);
                setPending(item);
              }}
              sx={item.color === "error" ? { color: "error.main" } : undefined}
            >
              {glyph(item.icon)}
              <ListItemText>{item.label}</ListItemText>
            </MenuItem>
          );
        })}
      </Menu>

      <Dialog open={pending !== null} onClose={() => setPending(null)} aria-labelledby="row-menu-confirm-title">
        {pending && (
          <>
            <DialogTitle id="row-menu-confirm-title">{pending.confirm.title}</DialogTitle>
            <DialogContent>
              <DialogContentText>{pending.confirm.body}</DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setPending(null)} sx={{ minHeight: 44 }}>
                {cancelLabel}
              </Button>
              <Button
                variant="contained"
                color={pending.color ?? "primary"}
                sx={{ minHeight: 44 }}
                onClick={() => {
                  const form = document.getElementById(pending.formId);
                  setPending(null);
                  if (form instanceof HTMLFormElement) form.requestSubmit();
                }}
              >
                {pending.confirm.confirmLabel}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </>
  );
}
