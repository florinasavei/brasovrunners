import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireStaff } from "@/modules/staff-identity/session";
import { canReadContent } from "@/modules/staff-identity/domain/roles";
import Panel from "@/shared/ui/Panel";

export const dynamic = "force-dynamic";

/**
 * The role gate for this section, deliberately **above** the `loading.tsx` boundary beside it.
 *
 * The page asserts the same thing and keeps asserting it — a page is a request of its own, and a
 * guard that depends on a parent having run is a guard that disappears the first time the page is
 * rendered from somewhere else. This exists for the **status code**.
 *
 * `loading.tsx` wraps what is below it in Suspense, and Next flushes the shell as soon as it has
 * one. A `notFound()` raised after that flush cannot change the status any more, so the response
 * became **200 with the not-found page in the body** — which is not a refusal to a crawler, a
 * monitor or a script, and BR-REQ-060-01 asks for a refusal. Deciding it here happens before
 * there is anything to flush, so the answer is a real 404 again.
 *
 * That is also why the list lives in a `(list)` route group: a `loading.tsx` at the section root
 * would cover this section's `[id]` and `new` routes too, and turn *their* 404s into 200s.
 */
export default async function SectionLayout({ children }: { children: ReactNode }) {
  // The section is offered to a reader (§208); each writer inside asks its own question.
  const actor = await requireStaff();
  if (!canReadContent(actor.role)) notFound();

  const t = await getTranslations("Admin");

  return (
    <>
      {/*
        The rule this section lives by, folded shut by default (§336) — it explains, it does not
        warn, so nothing opens it by itself. Shown only here, where "the page below" is true:
        every other admin page used to carry this and had nothing below it to point at.
      */}
      <Box sx={{ mb: 3 }}>
        <Panel title={t("legalNotice.title")} collapsible>
          <Typography variant="body2" color="text.secondary">
            {t("legalNotice.body")}
          </Typography>
        </Panel>
      </Box>
      {children}
    </>
  );
}
