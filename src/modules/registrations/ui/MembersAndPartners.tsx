import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { countForm } from "@/i18n/count-form";
import type { RegistrationComposition } from "../admin-repository";

/** The counted phrases of the block, each in one, few and other (`count-form.ts`): «1 membru», «2 membri», «20 de membri». */
type Counted = "title" | "members" | "verified" | "declared" | "partners" | "others" | "both";

/** A link's own line height: 44 pixels to press, inline in the sentence. */
const LINK_SX = { display: "inline-flex", alignItems: "center", minHeight: 44, color: "primary.main" } as const;

/**
 * «Dintre cei {n} confirmați» under the registrations list's state chips, for one event (§NNN; the owner, 2026-11-18, of
 * «Cine s-a înscris»: «aș vrea să văd mai clar, câți sunt Brașov Runners și câți sunt de la sponsori?»). Among the people the
 * chip «Confirmată» counts — the confirmed real registrations, the special guests among them, never a test row (§12.6):
 *
 * - how many are the club's members by the filter «Doar membrii {club}»'s own rule (§662, §973), with how many of them an
 *   address of a member account vouches for and how many only ticked «Sunt membru» — said only when there are both;
 * - how many came through a partner or a sponsor («De la parteneri»), then, quieter, each partner by name with its count,
 *   largest first;
 * - how many are neither — and, when somebody is both, how many, so the three numbers add up honestly.
 *
 * Each count is a link to the list filtered to exactly those people where the list has that filter (`hrefs`: the members, any
 * partner, one partner by name); «ceilalți» has none — the list has no «not a member» filter (`admin-repository.ts` says why).
 * Nothing is drawn while nobody is confirmed. `club` is the club's short mark, from its identity.
 */
export default async function MembersAndPartners({
  composition,
  locale,
  club,
  hrefs,
  spaceAbove = 0,
}: {
  composition: RegistrationComposition;
  /** The page's language, for the counted words. */
  locale: string;
  club: string;
  /** The list filtered to those people; a partner absent from `byPartner` has no filter by its name, and no link. */
  hrefs: { members?: string; partners?: string; byPartner?: Readonly<Record<string, string>> };
  spaceAbove?: number;
}) {
  if (composition.confirmed === 0) return null;
  const t = await getTranslations("Admin");
  const counted = (key: Counted, count: number) => t(`registrations.composition.${key}.${countForm(count, locale)}`, { count, club });
  const link = (href: string | undefined, testId: string, chunks: ReactNode) =>
    href ? (
      <Box component="a" href={href} sx={LINK_SX} data-testid={testId}>
        {chunks}
      </Box>
    ) : (
      <Box component="span" data-testid={testId}>
        {chunks}
      </Box>
    );
  const { members, verified, declared, partners, byPartner, both, others } = composition;
  return (
    <Box data-testid="registrations-composition" sx={{ mt: spaceAbove }}>
      <Typography variant="subtitle2" component="p" sx={{ fontWeight: 600 }} data-testid="registrations-composition-title">
        {counted("title", composition.confirmed)}
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        <Typography component="li" variant="body2">
          {link(members > 0 ? hrefs.members : undefined, "registrations-composition-members", counted("members", members))}
          {verified > 0 && declared > 0 && (
            <Box component="span" sx={{ color: "text.secondary" }} data-testid="registrations-composition-member-split">
              {" "}
              {t("registrations.composition.split", { verified: counted("verified", verified), declared: counted("declared", declared) })}
            </Box>
          )}
        </Typography>
        <Typography component="li" variant="body2">
          {link(partners > 0 ? hrefs.partners : undefined, "registrations-composition-partners", counted("partners", partners))}
          {byPartner.length > 0 && (
            <Box component="span" sx={{ color: "text.secondary" }} data-testid="registrations-composition-by-partner">
              {" — "}
              {byPartner.map((entry, index) => (
                <Box component="span" key={entry.name}>
                  {index > 0 && " · "}
                  {link(hrefs.byPartner?.[entry.name], "registrations-composition-partner", `${entry.name} ${entry.count}`)}
                </Box>
              ))}
            </Box>
          )}
        </Typography>
        <Typography component="li" variant="body2" data-testid="registrations-composition-others">
          {counted("others", others)}
        </Typography>
      </Box>
      {both > 0 && (
        <Typography variant="body2" color="text.secondary" data-testid="registrations-composition-both">
          {counted("both", both)}
        </Typography>
      )}
    </Box>
  );
}
