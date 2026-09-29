"use client";

import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArticleIcon from "@mui/icons-material/Article";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import CardMembershipIcon from "@mui/icons-material/CardMembership";
import EventIcon from "@mui/icons-material/Event";
import GroupsIcon from "@mui/icons-material/Groups";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import MailOutlineIcon from "@mui/icons-material/MailOutlined";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import Typography from "@mui/material/Typography";
import { type ComponentType, useEffect, useRef, useState } from "react";
import { useRecall } from "@/shared/forms/recall";
import { type MenuSectionKey, moveMenuEntry, sortByMenuOrder } from "../order";

/** One entry of the menu, as the card shows it. A name, never an element, crosses from the server (§370). */
export type MenuOrderEntry = {
  key: string;
  name: string;
  /** Whether the menu shows it now: an unpublished page keeps its place, greyed (`notYet`). */
  appears: boolean;
  /** A custom page rather than one of the site's own sections. */
  custom: boolean;
  /** Each entry's «Sus» / «Jos» said with its name, for a screen reader. */
  upLabel: string;
  downLabel: string;
};

export type MenuOrderLabels = {
  listLabel: string;
  up: string;
  down: string;
  notYet: string;
  custom: string;
  /** "„{name}” e acum pe locul {position}." — filled here, where the move happens. */
  movedTo: string;
  unsaved: string;
};

/** Each section's picture — the same subjects «Pagini standard» draws; a custom page is a page. */
const GLYPHS: Record<MenuSectionKey, ComponentType<SvgIconProps>> = {
  events: EventIcon,
  calendar: CalendarMonthIcon,
  contact: MailOutlineIcon,
  gallery: PhotoLibraryIcon,
  team: GroupsIcon,
  faq: HelpOutlineIcon,
  members: CardMembershipIcon,
};

function glyphOf(entry: MenuOrderEntry): ComponentType<SvgIconProps> {
  return entry.custom ? ArticleIcon : (GLYPHS[entry.key as MenuSectionKey] ?? ArticleIcon);
}

/**
 * «Ordinea meniului» (§NNN): every entry of the site menu in the club's order, with «Sus» and
 * «Jos» on each. The island only moves entries; the order is posted as one hidden `order` field
 * (the keys, comma-separated) by the form the Server Component draws around it, behind its
 * «Salvează ordinea» and its question (§384). The buttons are the way to reorder — a keyboard and
 * a thumb reach them alike, so there is no drag to be an alternative to. After a refused save the
 * order comes back as it was posted (§315).
 *
 * `mayEdit` false draws the same list without the buttons: an Organizer or a Redactor reads the
 * order, and the action refuses them anyway (BR-REQ-060-01).
 */
export default function MenuOrderList(props: MenuOrderListProps) {
  const recall = useRecall();
  // A new refusal is a new starting order: re-mounted, as `TeamLinkRowsEditor` is (§315).
  return <MenuOrderListIsland key={recall.generation} {...props} />;
}

type MenuOrderListProps = {
  entries: readonly MenuOrderEntry[];
  labels: MenuOrderLabels;
  mayEdit: boolean;
};

function MenuOrderListIsland({ entries, labels, mayEdit }: MenuOrderListProps) {
  const recall = useRecall();
  const recalled = recall.has ? recall.value("order") : undefined;
  const initial = entries.map((entry) => entry.key);
  const [order, setOrder] = useState<string[]>(() =>
    recalled ? sortByMenuOrder(initial, (key) => key, recalled.split(",")) : initial,
  );
  const [said, setSaid] = useState("");
  // The button to put the focus back on after a move: the pressed one, or its twin at an end.
  const [focus, setFocus] = useState<{ key: string; direction: "up" | "down" } | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement | null>());
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  const changed = order.join(",") !== initial.join(",");

  useEffect(() => {
    if (!focus) return;
    const index = order.indexOf(focus.key);
    const atEnd = focus.direction === "up" ? index === 0 : index === order.length - 1;
    const direction = atEnd ? (focus.direction === "up" ? "down" : "up") : focus.direction;
    buttons.current.get(`${focus.key}:${direction}`)?.focus();
  }, [focus, order]);

  const move = (key: string, direction: "up" | "down") => {
    const next = moveMenuEntry(order, key, direction);
    setOrder(next);
    setFocus({ key, direction });
    const entry = byKey.get(key);
    if (entry) setSaid(labels.movedTo.replace("{name}", entry.name).replace("{position}", String(next.indexOf(key) + 1)));
  };

  return (
    <Box>
      <input type="hidden" name="order" value={order.join(",")} />
      <Stack component="ol" spacing={0.75} aria-label={labels.listLabel} sx={{ listStyle: "none", m: 0, p: 0 }} data-testid="menu-order-list">
        {order.map((key, index) => {
          const entry = byKey.get(key);
          if (!entry) return null;
          const Glyph = glyphOf(entry);
          return (
            <Box
              component="li"
              key={key}
              data-testid={`menu-order-entry-${key}`}
              data-appears={entry.appears ? "yes" : "no"}
              sx={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 1,
                minHeight: 44,
                px: 1,
                py: 0.5,
                border: 1,
                borderColor: "divider",
                borderRadius: 1,
                bgcolor: "background.paper",
              }}
            >
              <Typography component="span" variant="body2" color="text.secondary" sx={{ minWidth: 24, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {index + 1}.
              </Typography>
              <Glyph aria-hidden fontSize="small" color={entry.appears ? "action" : "disabled"} />
              <Box sx={{ flex: "1 1 10rem", minWidth: 0, color: entry.appears ? "text.primary" : "text.disabled" }}>
                <Typography component="span" variant="body1" sx={{ fontWeight: 600, color: "inherit" }}>
                  {entry.name}
                </Typography>
                {(entry.custom || !entry.appears) && (
                  <Typography component="span" variant="body2" sx={{ color: entry.appears ? "text.secondary" : "inherit", ml: 1 }}>
                    {[entry.custom ? labels.custom : null, entry.appears ? null : labels.notYet].filter(Boolean).join(" · ")}
                  </Typography>
                )}
              </Box>
              {mayEdit && (
                <Stack direction="row" spacing={0.5}>
                  <Button
                    type="button"
                    variant="outlined"
                    size="small"
                    startIcon={<ArrowUpwardIcon fontSize="small" />}
                    onClick={() => move(key, "up")}
                    disabled={index === 0}
                    aria-label={entry.upLabel}
                    ref={(element: HTMLButtonElement | null) => {
                      buttons.current.set(`${key}:up`, element);
                    }}
                    sx={{ minHeight: 44 }}
                  >
                    {labels.up}
                  </Button>
                  <Button
                    type="button"
                    variant="outlined"
                    size="small"
                    startIcon={<ArrowDownwardIcon fontSize="small" />}
                    onClick={() => move(key, "down")}
                    disabled={index === order.length - 1}
                    aria-label={entry.downLabel}
                    ref={(element: HTMLButtonElement | null) => {
                      buttons.current.set(`${key}:down`, element);
                    }}
                    sx={{ minHeight: 44 }}
                  >
                    {labels.down}
                  </Button>
                </Stack>
              )}
            </Box>
          );
        })}
      </Stack>
      {/* What the last press did, said once to a screen reader; and a note while the new order is unsaved. */}
      <Box role="status" aria-live="polite" sx={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>
        {said}
      </Box>
      {mayEdit && changed && (
        <Typography variant="body2" color="warning.main" sx={{ mt: 1 }} data-testid="menu-order-unsaved">
          {labels.unsaved}
        </Typography>
      )}
    </Box>
  );
}
