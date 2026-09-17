import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { env } from "@/shared/config/env";
import { PAGE_WIDTH } from "@/theme/brand";

/**
 * "This is not the real site."
 *
 * QA runs the same code, the same design and the same seeded events as production will, on a
 * hostname nobody recognises. A visitor sent a link to it — a club member asked to try the
 * registration form, somebody the owner is showing the work to — has no way to tell it apart
 * from the club's actual website, and every consequence of that is bad: they register for a race
 * on a system whose data is wiped by the next seed, they bookmark the wrong address, or they
 * tell other people about it.
 *
 * So every environment that is not production says so, in words, above everything else on the
 * page. The rule is stated as "not production" rather than "qa" on purpose: a fifth environment
 * added later gets the banner by default rather than being silently mistaken for the real thing.
 *
 * Static rather than fixed, and it scrolls away with the rest of the page: a fixed bar costs
 * vertical space on every screen of a 320px phone, which is the viewport BR-REQ-041-01 is about.
 * It is not dismissible, because a visitor who dismissed it a week ago on another device is
 * exactly the person this is for.
 *
 * The club's real address is deliberately not named here. It is not registered yet, and
 * `AGENTS.md` §8 keeps the hostname out of every file but `SETUP.md` §26 regardless.
 */
export default async function EnvironmentNotice() {
  if (env.APP_ENV === "production") return null;

  const t = await getTranslations("Site");

  return (
    <Box
      component="aside"
      aria-label={t("environmentNotice.label")}
      sx={{
        bgcolor: "warning.main",
        color: "warning.contrastText",
        borderBottom: 1,
        borderColor: "warning.dark",
      }}
    >
      <Container maxWidth={PAGE_WIDTH} sx={{ py: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {t("environmentNotice.title", { environment: env.APP_ENV })}
        </Typography>
        <Typography variant="body2">
          {t("environmentNotice.body")}
          {/*
            And where to go instead. A visitor who was sent a link to this host has no way to
            find the real one — the whole reason this notice exists — and telling them it is the
            wrong site without saying where the right one is leaves them nowhere.

            `PRODUCTION_SITE_URL` rather than a literal: §8 forbids a hostname under `src/`,
            and it cannot derive from `APP_BASE_URL`, which is deliberately *this* environment's
            host. Unset, the sentence simply ends — which is right on a laptop, where there is no
            other site to point at.
          */}
          {env.PRODUCTION_SITE_URL && (
            <>
              {" "}
              <Link href={env.PRODUCTION_SITE_URL} sx={{ color: "inherit", fontWeight: 600 }}>
                {t("environmentNotice.realSite")}
              </Link>
            </>
          )}
        </Typography>
      </Container>
    </Box>
  );
}
