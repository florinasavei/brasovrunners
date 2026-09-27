"use client";

import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useRef, useState } from "react";
import { countForm } from "@/i18n/count-form";
import ConfirmDialog from "@/shared/feedback/ConfirmDialog";
import GlyphButton from "@/shared/ui/GlyphButton";
import { ASK_ABOVE_CHARACTERS } from "../domain/budget";
import { labelOfBox, planTranslateAll, type TranslateAllPlan } from "./form-fields";
import { type TranslateOffer, useTranslateOffer } from "./TranslateProvider";
import { useTranslatePress } from "./use-translate-press";

/**
 * «Copiază și tradu tot: RO → EN» at the top of a record's editor (`DECISIONS.md` §464, §482; the
 * owner, 2026-09-26: «I wanna override the descriptions and all from RO to EN so I have the same
 * layout and all», and 2026-09-27: «I can't find or don't know how to use the AI translate … I
 * just wanna copy all from RO to English and auto-translate with a single button click»).
 *
 * Every English box of the form whose Romanian twin has words — the title, the summary, the
 * description, the rules, the route, the programme's notes and rows, what to bring, the place's
 * name, the partners' texts, the links' labels, the search-engine texts; on «Echipa» the role, the
 * words about the person and the links' labels — is filled with the Romanian translated, a rich
 * text keeping the Romanian's layout exactly (headings, lists, tables, pictures, films;
 * `domain/rich-text-html.ts`). One request; nothing saved until the ordinary save.
 *
 * **One press** (§482). Where every English box it fills is empty, the press translates at once.
 * It asks first (§384) only when English words already written would be replaced — naming how
 * many and which, and offering «Înlocuiește tot» or «Doar cele goale», so the remaining empty boxes
 * are still one press — or when the press would send more than `ASK_ABOVE_CHARACTERS` of the
 * day's budget, naming the figure (`charactersToSend`, the service's own count).
 *
 * **Always there** (§482) for a role that writes the club's words: a deployment with no DeepL key
 * draws it greyed, with the sentence saying why and, for a reader who may open the tasks page,
 * the link to the row with the steps — a missing button is one nobody can find. A key whose DeepL
 * credit is spent (§NNN) draws it greyed the same way, saying so and linking Costuri. A role that
 * writes no words sees nothing.
 *
 * Inside the form it reads, so it finds the boxes by the form they post in.
 */
export default function TranslateAllButton() {
  const offer = useTranslateOffer();
  if (!offer) return null;
  return offer.action ? <TranslateAllButtonIsland /> : <TranslateAllButtonOff offer={offer} />;
}

/** The frame both states share: an outlined card, the button first, the sentence under it. */
function Frame({ children, off }: { children: ReactNode; off?: boolean }) {
  return (
    <Paper
      variant="outlined"
      sx={{ p: { xs: 1.5, sm: 2 }, display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 1.5, rowGap: 1, borderColor: off ? "divider" : "primary.main" }}
      data-testid="translate-all"
      data-translate-state={off ? "off" : "ready"}
    >
      {children}
    </Paper>
  );
}

function TranslateAllButtonOff({ offer }: { offer: TranslateOffer }) {
  const t = useTranslations("Translate");
  if (offer.spent) {
    return (
      <Frame off>
        <GlyphButton icon="translate" variant="contained" disabled sx={{ minHeight: 44 }}>
          {t("all")}
        </GlyphButton>
        <Typography variant="body2" color="text.secondary" sx={{ flexBasis: "100%" }} data-testid="translate-all-off" data-reason="spent">
          {offer.costsHref ? (
            <>
              {t("spent")}{" "}
              <MuiLink href={offer.costsHref} sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
                {t("spentSteps")}
              </MuiLink>
            </>
          ) : (
            t("spentAskAdmin")
          )}
        </Typography>
      </Frame>
    );
  }
  return (
    <Frame off>
      <GlyphButton icon="translate" variant="contained" disabled sx={{ minHeight: 44 }}>
        {t("all")}
      </GlyphButton>
      <Typography variant="body2" color="text.secondary" sx={{ flexBasis: "100%" }} data-testid="translate-all-off">
        {offer.setupHref ? t("off") : t("offAskAdmin")}{" "}
        {offer.setupHref && (
          <MuiLink href={offer.setupHref} sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
            {t("offSteps")}
          </MuiLink>
        )}
      </Typography>
    </Frame>
  );
}

function TranslateAllButtonIsland() {
  const t = useTranslations("Translate");
  const locale = useLocale();
  const anchor = useRef<HTMLSpanElement>(null);
  const [asking, setAsking] = useState<{ plan: TranslateAllPlan; labels: string[] } | null>(null);
  const { pending, message, translate } = useTranslatePress();

  const form = () => anchor.current?.closest("form") ?? null;
  const press = () => {
    const current = form();
    const plan = planTranslateAll(current);
    // Empty English boxes and an ordinary amount of words: one press, no question.
    if (plan.replaced.length === 0 && plan.characters <= ASK_ABOVE_CHARACTERS) {
      void translate(current, plan.names, { all: true });
      return;
    }
    setAsking({ plan, labels: plan.replaced.map((name) => labelOfBox(current, name)) });
  };
  const run = (names: readonly string[]) => {
    setAsking(null);
    void translate(form(), names, { all: true });
  };
  const figure = (count: number) => new Intl.NumberFormat(locale).format(count);

  const spec = (() => {
    if (!asking) return null;
    const { plan, labels } = asking;
    const big = plan.characters > ASK_ABOVE_CHARACTERS;
    const budget = big
      ? [
          t("confirm.budget", { count: figure(plan.characters) }),
          plan.replaced.length > 0 && plan.empty.length > 0 ? t("confirm.budgetEmpty", { count: figure(plan.emptyCharacters) }) : "",
        ]
          .filter(Boolean)
          .join(" ")
      : "";
    if (plan.replaced.length === 0) {
      return { title: t("confirm.bigTitle"), body: `${budget} ${t("confirm.bigBody")}`, confirmLabel: t("confirm.go"), cancelLabel: t("confirm.cancel") };
    }
    const body = t("confirm.allBody", { count: plan.replaced.length, fields: labels.join(" · ") });
    return {
      // Counted through `countForm`, never an ICU plural (`docs/VIBECODING.md`, §341).
      title: t(`confirm.allTitle.${countForm(plan.replaced.length, locale)}`, { count: plan.replaced.length }),
      body: budget ? `${body} ${budget}` : body,
      confirmLabel: t("confirm.replaceAll"),
      cancelLabel: t("confirm.cancel"),
    };
  })();

  return (
    <Frame>
      <span ref={anchor} hidden />
      <GlyphButton icon="translate" variant="contained" onClick={press} disabled={pending} sx={{ minHeight: 44 }} aria-busy={pending || undefined}>
        {pending ? t("pending") : t("all")}
      </GlyphButton>
      <Typography variant="body2" color="text.secondary" sx={{ flexBasis: "100%" }}>
        {t("allHelp")}
      </Typography>
      <Typography
        variant="body2"
        role="status"
        color={message?.tone === "refused" ? "error" : "text.secondary"}
        sx={{ flexBasis: "100%" }}
        data-testid="translate-all-status"
      >
        {message?.text ?? ""}
      </Typography>
      <ConfirmDialog
        open={asking !== null}
        spec={spec}
        onCancel={() => setAsking(null)}
        onConfirm={() => run(asking?.plan.names ?? [])}
        alternative={
          asking && asking.plan.replaced.length > 0 && asking.plan.empty.length > 0
            ? { label: t("confirm.onlyEmpty"), onClick: () => run(asking.plan.empty) }
            : null
        }
      />
    </Frame>
  );
}
