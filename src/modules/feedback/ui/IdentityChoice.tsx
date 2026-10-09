import PersonOutlinedIcon from "@mui/icons-material/PersonOutlined";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { ComponentType } from "react";
import {
  FEEDBACK_LINE_MAX,
  FEEDBACK_NAME_MAX,
  type FeedbackAudience,
  type FeedbackField,
  feedbackFieldId,
} from "@/modules/feedback/domain/branches";
import RadioField from "@/shared/ui/RadioField";
import IncognitoIcon from "./IncognitoIcon";

type Props = {
  /** The branch's way back: an address on the three ordinary forms, an address or a telephone on the safety form. */
  wayBack: "email" | "contact";
  /** «Cu nume și prenume» checked — a refused named post coming back; «Anonim» otherwise. */
  named: boolean;
  /** The boxes a refusal named. */
  invalid: ReadonlySet<FeedbackField>;
  /** What the refused post typed, from the sealed draft (§142). */
  kept: (name: string) => string | undefined;
  /** The safety branch's first name, the club's own setting — the way back's label and «Cine să afle?»'s second answer. */
  safetyName: string;
  /** Whom a named message may reach (`audiencesFor`); fewer than two draws no «Cine să afle?». */
  audiences: readonly FeedbackAudience[];
  /** The answer checked by default: a refused post's, else the branch's own reader. */
  audience: FeedbackAudience;
};

/**
 * One radio with its sentence under it, and, where it has one, a 24-pixel glyph before its words (§NNN):
 * decoration (`aria-hidden`), drawn inside the label, so the whole row is still the radio's tap target.
 */
function Choice({
  name,
  value,
  checked,
  label,
  hint,
  glyph: Glyph,
}: {
  name: string;
  value: string;
  checked: boolean;
  label: string;
  hint: string;
  glyph?: ComponentType<SvgIconProps>;
}) {
  return (
    <Box>
      <RadioField name={name} value={value} defaultChecked={checked}>
        {Glyph ? (
          <Box component="span" data-testid={`feedback-identity-${value}`} sx={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
            <Glyph aria-hidden="true" sx={{ fontSize: 24, flexShrink: 0 }} />
            {label}
          </Box>
        ) : (
          label
        )}
      </RadioField>
      <Typography variant="body2" color="text.secondary" sx={{ ml: 6, mt: -0.5 }}>
        {hint}
      </Typography>
    </Box>
  );
}

/**
 * «Spune-ne ceva»'s first box (§678), every branch's form: «Cum vrei să trimiți?» — «Anonim», the
 * default, or «Cu nume și prenume», each with its glyph before its words (the incognito hat and
 * glasses, a person; §NNN) and its sentence under it. The named mode shows the name
 * (2–80 characters, required there by the server), the branch's way back and, when a named message may
 * reach either, «Cine să afle?»: «Clubul» or the safety branch's person by her first name — never an
 * address. They show only while «Cu nume și prenume» is checked, in CSS alone (`:has`), no island;
 * without `:has` they simply stay visible and the server drops them from an anonymous post. No
 * `required` and no `type="email"` on a box the anonymous mode hides: the browser would refuse a post
 * on a box it cannot show. The page draws none of this while the privacy notice in force does not
 * name the named mode (`{{feedbackFormsNamed}}`): every form is anonymous only then.
 */
export default async function IdentityChoice({ wayBack, named, invalid, kept, safetyName, audiences, audience }: Props) {
  const t = await getTranslations("Tell");
  const box = (name: FeedbackField, help?: string) => ({
    id: feedbackFieldId(name),
    name,
    error: invalid.has(name),
    helperText: invalid.has(name) ? t("errors.field") : help,
    defaultValue: kept(name) ?? "",
  });
  return (
    <Box data-testid="feedback-identity" sx={{ "&:has(input[name='identity'][value='anonymous']:checked) [data-named-only]": { display: "none" } }}>
      <Box component="fieldset" id={feedbackFieldId("identity")} sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
        <Typography component="legend" variant="body1" sx={{ fontWeight: 600 }}>
          {t("identity.legend")}
        </Typography>
        {/* «We love icons» (§NNN): the incognito hat and glasses for «Anonim», a person for the named mode. */}
        <Choice name="identity" value="anonymous" checked={!named} label={t("identity.anonymous")} hint={t("identity.anonymousHint")} glyph={IncognitoIcon} />
        <Choice name="identity" value="named" checked={named} label={t("identity.named")} hint={t("identity.namedHint")} glyph={PersonOutlinedIcon} />
      </Box>
      <Stack spacing={2} data-named-only="" data-testid="feedback-named" sx={{ mt: 2 }}>
        <TextField
          {...box("name")}
          label={t("name")}
          autoComplete="name"
          fullWidth
          slotProps={{ htmlInput: { maxLength: FEEDBACK_NAME_MAX, "aria-required": "true" } }}
        />
        {wayBack === "contact" ? (
          <TextField
            {...box("contact", t("safety.contactHelp"))}
            label={t("safety.contact", { name: safetyName })}
            fullWidth
            slotProps={{ htmlInput: { maxLength: FEEDBACK_LINE_MAX } }}
          />
        ) : (
          <TextField
            {...box("email", t("emailHelp"))}
            label={t("email")}
            autoComplete="email"
            fullWidth
            slotProps={{ htmlInput: { inputMode: "email", spellCheck: false, autoCapitalize: "none" } }}
          />
        )}
        {audiences.length > 1 && (
          <Box component="fieldset" id={feedbackFieldId("audience")} data-testid="feedback-audience" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
            <Typography component="legend" variant="body1" sx={{ fontWeight: 600 }} color={invalid.has("audience") ? "error" : undefined}>
              {t("audience.legend")}
            </Typography>
            {audiences.map((answer) => (
              <Choice
                key={answer}
                name="audience"
                value={answer}
                checked={answer === audience}
                label={answer === "club" ? t("audience.club") : t("audience.person", { name: safetyName })}
                hint={answer === "club" ? t("audience.clubHint") : t("audience.personHint", { name: safetyName })}
              />
            ))}
          </Box>
        )}
      </Stack>
    </Box>
  );
}
