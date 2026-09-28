import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DrawIcon from "@mui/icons-material/Draw";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { countForm } from "@/i18n/count-form";
import { formatBirthDate } from "@/i18n/dates";
import { Link } from "@/i18n/navigation";
import CheckboxField from "@/shared/ui/CheckboxField";
import SubmitButton from "@/shared/ui/SubmitButton";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import type { FamilySittingLink } from "../family-sitting-confirm";

type Props = {
  locale: string;
  token: string;
  link: Extract<FamilySittingLink, { ok: true }>;
  /** `fitnessAcknowledged` when the press came back for the adult's tick; anything else is ignored. */
  refused?: string;
  /** The press (`confirmFamilySittingAction`). */
  action: (form: FormData) => Promise<void>;
};

/**
 * The page the family message's one button opens (§519): everybody the sitting sent the form for,
 * one line each — name in bold, birth date in words — with a tick on each kept form (on by default:
 * untick somebody and their details are deleted at the press, nobody registered for them), who the
 * address held before, what the press does, and the one button «Confirm și semnez declarațiile (N)».
 *
 * GET reads, and nothing else (§12.8): a mail scanner opening it leaves the link working. A Server
 * Component; the glyphs are children, never props across the boundary (§370).
 */
export default async function FamilySittingConfirm({ locale, token, link, refused, action }: Props) {
  const t = await getTranslations("Registrations");
  const count = link.people.length;
  const people = (n: number) => t(`family.people.${countForm(n, locale)}`, { count: n });
  const anyAdult = link.people.some((person) => person.adultEntry);

  return (
    <Stack spacing={2} data-testid="family-sitting-confirm">
      {/* The places hold until the sitting's deadline, the link for longer (§NNN): past it, said so. */}
      <Typography data-testid="family-sitting-intro">
        {t(link.reserved ? "familySitting.intro" : "familySitting.introLapsed", { email: link.email, people: people(count) })}
      </Typography>

      {refused === "fitnessAcknowledged" && (
        <Alert severity="warning" data-testid="family-refused">
          {t("family.fitnessMissing")}
        </Alert>
      )}

      <form action={action}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="token" value={token} />
        <Stack spacing={2}>
          <Box component="section" aria-labelledby="family-sitting-people" sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}>
            <Typography id="family-sitting-people" component="h2" sx={{ fontWeight: 600, fontSize: "1rem", mb: 1 }}>
              {t("familySitting.joining")}
            </Typography>
            <Stack component="ol" spacing={1} sx={{ listStyle: "none", m: 0, p: 0 }} data-testid="family-sitting-people">
              {link.people.map((person, index) => {
                const born = formatBirthDate(person.birthDate, locale);
                const label = (
                  <>
                    <Box component="span" sx={{ fontWeight: 700 }}>
                      {t("familySitting.personLabel", { n: index + 1, total: count, name: person.name })}
                    </Box>
                    {born && (
                      <Box component="span" sx={{ display: "block", color: "text.secondary", fontSize: "0.875rem" }}>
                        {t("familySitting.born", { date: born })}
                      </Box>
                    )}
                  </>
                );
                return (
                  <Box component="li" key={person.key}>
                    {person.optional ? (
                      <CheckboxField name="include" value={person.key} defaultChecked>
                        {label}
                      </CheckboxField>
                    ) : (
                      // A registration of the sitting: its own form made it, and the press confirms it with the address.
                      <Box sx={{ display: "flex", gap: 1.5, alignItems: "flex-start", minHeight: TAP_TARGET.minHeight, py: 0.5 }}>
                        <CheckCircleIcon aria-hidden="true" color="success" sx={{ mt: 0.25 }} />
                        <Box>{label}</Box>
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {/* Only a kept form can be unticked (§446); a registration a sitting's form wrote is withdrawn afterwards (§NNN). */}
              {link.people.some((person) => person.optional) ? t("familySitting.untick") : t("familySitting.withdrawLater")}
            </Typography>
          </Box>

          {link.registered.length > 0 && (
            <Box>
              <Typography component="h2" sx={{ fontWeight: 600, fontSize: "1rem" }}>
                {t("family.registered")}
              </Typography>
              <Typography component="ul" data-testid="family-registered" sx={{ my: 0.5, pl: 3 }}>
                {link.registered.map((name, index) => (
                  <li key={`${index}-${name}`}>{name}</li>
                ))}
              </Typography>
            </Box>
          )}

          <Typography variant="body2">{t("familySitting.next", { email: link.email, people: people(link.registrationsPerAddress) })}</Typography>
          {anyAdult && (
            <Typography variant="body2" color="text.secondary">
              {t("family.adultNote")}
            </Typography>
          )}
          <Typography variant="body2" color="text.secondary">
            {t("family.consent")} <Link href="/legal/privacy">{t("family.privacy")}</Link>
          </Typography>
          {/* Another adult's fitness is theirs to declare, when they sign (§421): the holder acknowledges it, once for all. */}
          {anyAdult && (
            <CheckboxField id="fitnessAcknowledged" name="fitnessAcknowledged">
              {t("familySitting.fitnessAcknowledged")}
            </CheckboxField>
          )}
          {/* The shared send button (§371): one press, held while in flight — a second would find the link spent. */}
          <Box data-testid="family-sitting-confirm-button">
            <SubmitButton label={t("familySitting.action", { count })} pendingLabel={t("familySitting.actionPending")} size="large">
              <DrawIcon />
            </SubmitButton>
          </Box>
        </Stack>
      </form>
    </Stack>
  );
}
