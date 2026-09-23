"use client";

import MoreVertIcon from "@mui/icons-material/MoreVert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import Divider from "@mui/material/Divider";
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
import { ACTION_ICONS, type ActionIconName } from "@/shared/ui/action-icons";

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
/*
  The glyphs are the one registry's (§NNN): the desk's "Dă-i un loc" and this menu's wear the
  same seat, the bib's printed mark the same double tick as the batch button on the bibs panel.
  Cancel and erase stay different shapes there, and deliberately so: a menu where "anulează" and
  "șterge" wear the same icon in the same colour is a menu somebody picks the wrong line out of.
*/
export type RegistrationMenuIcon = ActionIconName;

/**
 * Drawn above the item, with a gap, to break the run of verbs (§180).
 *
 * The registration's own page makes the same separation in the way a page can — erasure sits in
 * its own bordered `<details>`, below cancel, behind a summary somebody has to open. A menu has
 * no room for that, so what carries it here is a rule, a gap and the error colour: everything
 * above the line puts a registration into another state, and the one thing below it removes the
 * registration altogether.
 */
type MenuSeparation = { separated?: boolean };

export type RegistrationMenuItem =
  | ({ kind: "link"; label: string; href: string; icon: RegistrationMenuIcon; color?: "error" } & MenuSeparation)
  | ({
      kind: "submit";
      label: string;
      icon: RegistrationMenuIcon;
      /** The id of a hidden form the page already rendered, whose Server Action this submits. */
      formId: string;
      color?: "primary" | "error" | "warning";
      /** Present for a verb that is hard to undo; absent for one that is a press away from being reversed. */
      confirm?: { title: string; body: string; confirmLabel: string };
    } & MenuSeparation);

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
        {/*
          `flatMap`, not `map`: a separated item contributes two children — the rule and itself —
          and they have to arrive as siblings of every other item. A `<Fragment>` around the pair
          would render identically and break the keyboard: MUI walks the children it was handed
          to decide what the arrow keys move between, and it does not descend into a fragment, so
          the erase item would stop being reachable from the keyboard the moment it gained a
          rule. React flattens a nested array here, and `<Divider>` is skipped by that walk
          already, which is exactly what is wanted.
        */}
        {items.flatMap((item) => {
          const Icon = ACTION_ICONS[item.icon];
          const tint = item.color === "error" ? { color: "error.main" } : undefined;
          const rule = item.separated ? <Divider key={`${item.label}-rule`} sx={{ my: 0.5 }} /> : null;

          const entry =
            item.kind === "link" ? (
              <MenuItem
                key={item.label}
                component="a"
                href={item.href}
                onClick={() => setAnchor(null)}
                sx={{ minHeight: 44, ...tint }}
              >
                <ListItemIcon sx={tint}>
                  <Icon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{item.label}</ListItemText>
              </MenuItem>
            ) : (
              <MenuItem
                key={item.label}
                onClick={() => {
                  setAnchor(null);
                  if (item.confirm) setConfirming(item);
                  else submit(item.formId);
                }}
                sx={{ minHeight: 44, ...tint }}
              >
                <ListItemIcon sx={tint}>
                  <Icon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{item.label}</ListItemText>
              </MenuItem>
            );

          return rule ? [rule, entry] : [entry];
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
