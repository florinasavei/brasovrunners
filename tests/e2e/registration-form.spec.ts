import { expect, test, type Page } from "@playwright/test";
import { ensureRegistrationIsOpen, FEATURED, HUMAN_PAUSE_MS, hydrated, signIn } from "./support/featured-event";

/**
 * BR-REQ-031-01, BR-REQ-031-04, BR-REQ-031-05, BR-REQ-031-06, BR-REQ-041-01 — the shape of the
 * first stage of the registration journey, at 320px and on a desktop.
 *
 * `registration-entry.spec.ts` proves a runner can get from the landing page to a submitted
 * form. This proves the three things that were decided about *how* that form is arranged
 * (`DECISIONS.md` §47): the optional questions are collapsed so the default page is the
 * required set, a rejected submission arrives at a summary that names and reaches the field
 * rather than at the top of a long page, and every control a thumb has to hit is big enough
 * to hit.
 *
 * Needs the seeded database and the development staff switcher, like every spec here.
 */

const registerPath = `/ro/evenimente/${FEATURED.slug}/inscriere`;

/** Everything the schema insists on, minus whichever field a test wants to be missing. */
async function fillRequired(page: Page, omit?: string) {
  const values: Record<string, string> = {
    firstName: "Ana",
    lastName: "Popescu",
    email: `e2e-form-${test.info().project.name}-${Date.now().toString(36)}@test.invalid`,
    birthDate: "1990-05-17",
    city: "Brașov",
    phone: "+40711111111",
    emergencyContactName: "Ion Popescu",
    emergencyContactPhone: "+40722222222",
  };
  for (const [name, value] of Object.entries(values)) {
    if (name === omit) continue;
    await page.locator(`[name="${name}"]`).fill(value);
  }
  /*
    The address a second time (§206): typed by hand on the real form, because QA's outbox held
    three bounced messages to "…@gmail.con" and one letter loses somebody for good. Omitting
    `email` omits both — a test that wants the address missing wants it missing from both boxes,
    or the mismatch would be what refused the form rather than the absence.
  */
  if (omit !== "email") {
    await page.locator('[name="emailConfirm"]').fill(values.email);
  }
  await page.locator('[name="privacyAcknowledged"]').check();
  /*
    "I have read the race conditions" (§195), required on the public form.

    The seeded events carry no rules of their own, so this is the plain-checkbox branch. An event
    that *has* rules gets the panel instead — a button, the text, a scroll to the end, and only
    then a tick — and its hidden input is deliberately `readOnly`, so a spec for that branch has
    to press through the panel rather than check the box. Worth knowing before somebody adds
    rules to the seed and wonders why this stops working.
  */
  await page.locator('[name="rulesAcknowledged"]').check();
  // "Declar că sunt apt medical să particip" (§171): required on the public form, like the
  // privacy acknowledgment beside it.
  await page.locator('[name="fitnessDeclared"]').check();
}

test.describe("BR-REQ-041-01 the optional half of the form is open, and foldable", () => {
  test("shows the required questions, the consents, and the optional groups open", async ({
    page,
  }) => {
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    await page.goto(registerPath);
    await hydrated(page);

    // Everything a registration cannot be accepted without is on the page as it loads.
    for (const name of [
      "firstName",
      "lastName",
      "birthDate",
      "email",
      "emailConfirm",
      "phone",
      "emergencyContactName",
      "emergencyContactPhone",
      "fitnessDeclared",
      "privacyAcknowledged",
      "rulesAcknowledged",
    ]) {
      await expect(page.locator(`[name="${name}"]`), `${name} is asked up front`).toBeVisible();
    }

    // The public-results consent is not asked (§322): there are no results to consent to.
    await expect(page.locator('[name="resultsNameConsent"]')).toHaveCount(0);
    // Where the runner is from is optional and on the optional side, open (§322).
    await expect(page.locator('[name="city"]')).toBeVisible();
    await expect(page.locator('[name="city"]')).not.toHaveAttribute("required", "");
    // "I want to appear on the participant list" is asked only on an event whose list is switched
    // on (`DECISIONS.md` §85, §143); the seeded events publish none, so the box is absent.
    await expect(page.locator('[name="listOptIn"]')).toHaveCount(0);

    // The optional groups are open as the page loads (the owner's instruction of 2026-09-17,
    // reversing DECISIONS.md §47): a runner's own club was the field people missed when it sat
    // behind a summary, and a field nobody sees is a field nobody fills.
    await expect(page.locator('[name="clubName"]')).toBeVisible();
    // The medical note is the one exception (§171): folded, because asking for free text first
    // read as "tell us your conditions" and buried the statement the club actually needs. It is
    // on the page and one press away — and what is required is the tick among the consents.
    await expect(page.locator('[name="healthNotes"]')).toBeHidden();
    await expect(page.getByText("Informații medicale", { exact: false }).first()).toBeVisible();
    // The public display name is behind `FEATURE_DISPLAY_NAME`, off by default (§95): absent.
    await expect(page.locator('[name="displayName"]')).toHaveCount(0);
    // BR-REQ-031-05 criterion 1: the health question keeps its own consent beside it — inside
    // the same fold, so it is measured for presence rather than visibility.
    await expect(page.locator('[name="healthConsent"]')).toHaveCount(1);
    // BR-REQ-031-06: the club's own people say so here.
    await expect(page.locator('[name="clubMemberDeclared"]')).toBeVisible();

    // Still a disclosure, and the health one starts **closed** (§171): the summary names what
    // it holds, one press opens it, and the statement the club actually needs is the tick among
    // the consents rather than anything inside here.
    await page.getByText("Informații medicale — opțional").click();
    await expect(page.locator('[name="healthNotes"]')).toBeVisible();
    await page.getByText("Informații medicale — opțional").click();
    await expect(page.locator('[name="healthNotes"]')).toBeHidden();
  });

  test("accepts a registration from somebody who says they are in the club", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    await page.goto(registerPath);
    await hydrated(page);

    await fillRequired(page);
    // The group is open as the page loads; the tick is reachable without opening anything.
    await page.locator('[name="clubMemberDeclared"]').check();

    /*
      Ticking it fills the club in and locks it (§215) — and this assertion exists because the
      first version shipped the wrong half of that.

      `ClubForMember` writes the name through a ref onto the real input. MUI forks `inputRef`
      onto the `<input>`; a missing one leaves `inputRef.current` null, so the write goes
      nowhere while the field still turns read-only. On screen that is an empty box nobody can
      type into, under a caption saying it was filled in automatically. Nothing in the type
      system or the unit suite can see it: the ref is only ever null at runtime, in a browser.
    */
    const club = page.locator('[name="clubName"]');
    await expect(club).toHaveValue("Brașov Runners");
    await expect(club).toHaveAttribute("readonly", /.*/);

    /*
      And the label has moved out of the way (§226).

      MUI floats a label from the input's own events, which an imperative write does not fire —
      so the field had the club's name in it and the label was still drawn across the top of it.
      `MuiInputLabel-shrink` is the class MUI adds when the label is in its raised position, so
      asserting it is asserting that the two are not on top of each other.
    */
    const clubLabel = page.locator('label[for="f-clubName"]');
    await expect(clubLabel).toHaveClass(/MuiInputLabel-shrink/);

    // Unticking gives the field back, empty and editable, rather than leaving the club's name
    // behind in a box that now reads as the entrant's own answer.
    await page.locator('[name="clubMemberDeclared"]').uncheck();
    await expect(club).toHaveValue("");
    await expect(club).not.toHaveAttribute("readonly", /.*/);

    await page.locator('[name="clubMemberDeclared"]').check();
    await expect(club).toHaveValue("Brașov Runners");

    // The timing check answers a too-fast form with the same generic success it gives a real
    // one, so submitting immediately would pass without creating anything.
    await page.waitForTimeout(HUMAN_PAUSE_MS);
    await page.getByRole("button", { name: "Trimite înscrierea" }).click();

    // The check-your-email screen greets by the first name `fillRequired` typed (§224).
    await expect(page.getByRole("heading", { name: "Aproape gata, Ana!" })).toBeVisible();
  });

  test("refuses a paste into the second address box, and offers a way through", async ({ page }) => {
    /*
      §227. The paste that matters is from the box above — copy, paste, and the second box has
      confirmed nothing. The block is an enhancement with a door in it (§195's "fă safe"), so
      this asserts both halves: the paste is refused and says why, and the door lets somebody
      who cannot type by hand through.
    */
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    await page.goto(registerPath);
    await hydrated(page);

    const address = `e2e-paste-${test.info().project.name}-${Date.now().toString(36)}@test.invalid`;
    await page.locator('[name="email"]').fill(address);

    // Put it on the clipboard the way a person would: select the first box and copy it.
    await page.locator('[name="email"]').selectText();
    await page.keyboard.press("ControlOrMeta+c");

    const confirm = page.locator('[name="emailConfirm"]');
    await confirm.click();
    await page.keyboard.press("ControlOrMeta+v");

    // Nothing arrived, and the refusal is on screen rather than silent (§217).
    await expect(confirm).toHaveValue("");
    await expect(page.getByText("Scrie adresa de mână aici", { exact: false })).toBeVisible();

    // The door: once pressed, the same paste works.
    await page.getByRole("button", { name: /Lipește oricum/i }).click();
    await confirm.click();
    await page.keyboard.press("ControlOrMeta+v");
    await expect(confirm).toHaveValue(address);
  });
  test("will not submit an emergency contact that is the runner's own number", async ({ page }) => {
    /*
      §231. The rule (§228) lived only on the server, so the first anybody heard of it was a
      rejected submission — the owner: "here I put the same number for emergency contact but
      I only knew that after submitting".

      What is asserted is not the red text: it is that the **browser** refuses. The field
      carries a custom validity, so `form.checkValidity()` is false and a press never leaves
      the page — the same machinery that handles a missing required field, in the reader's
      own language, with none of our JavaScript in the refusal path.
    */
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    await page.goto(registerPath);
    await hydrated(page);

    await fillRequired(page);
    await page.locator('[name="emergencyContactPhone"]').fill("711111111");
    await page.locator('[name="phone"]').fill("711111111");

    // Said where the field is, and said correctly — not "that number is not valid".
    await expect(page.getByText("alt număr decât al tău", { exact: false })).toBeVisible();

    // And the browser will not let the form go.
    const valid = await page.locator('[name="emergencyContactPhone"]').evaluate(
      (node) => (node as HTMLInputElement).checkValidity(),
    );
    expect(valid).toBe(false);

    await page.waitForTimeout(HUMAN_PAUSE_MS);
    await page.getByRole("button", { name: "Trimite înscrierea" }).click();
    // Still on the form: nothing was posted, so there is no check-your-email screen and no
    // error summary. The heading is what that screen always carries, named or not.
    await expect(page.getByRole("heading", { name: /Aproape gata/ })).toHaveCount(0);

    // Correct it and the refusal lifts, rather than sticking for ever.
    await page.locator('[name="emergencyContactPhone"]').fill("722222222");
    await expect(page.getByText("alt număr decât al tău", { exact: false })).toHaveCount(0);
    expect(
      await page.locator('[name="emergencyContactPhone"]').evaluate((node) => (node as HTMLInputElement).checkValidity()),
    ).toBe(true);
  });
  test("offers the address the entrant meant, and fixes both boxes", async ({ page }) => {
    /*
      §233. Every address that has cost this club a registration was syntactically perfect —
      QA bounced three messages to "…@gmail.con". The browser accepts it, the server accepts
      it, and the person waits for an email that can never arrive.

      Accepting the suggestion has to correct **both** boxes: the second was typed to match
      the first, so fixing one alone turns a helpful press into a mismatch error.
    */
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    await page.goto(registerPath);
    await hydrated(page);

    await page.locator('[name="email"]').fill("ana.e2e@gmail.con");
    await page.locator('[name="emailConfirm"]').fill("ana.e2e@gmail.con");
    // No blur needed: a complete address is judged at once, which is when it is most useful.
    await expect(page.getByText("ana.e2e@gmail.com", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: /corectează/i }).click();

    await expect(page.locator('[name="email"]')).toHaveValue("ana.e2e@gmail.com");
    await expect(page.locator('[name="emailConfirm"]')).toHaveValue("ana.e2e@gmail.com");
  });
  test("never scrolls sideways, at either viewport", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    await page.goto(registerPath);
    await hydrated(page);

    // Criterion 1, with every disclosure open — the widest the page can be made. All but the
    // medical note open by default (§59); that one is closed since §171, so it is opened here,
    // because the question is whether the page can ever scroll sideways and not whether it does
    // on load.
    await page.evaluate(() => document.querySelectorAll("details").forEach((details) => (details.open = true)));
    for (const name of ["healthNotes", "clubName", "preferredLocale"]) {
      await expect(page.locator(`[name="${name}"]`)).toBeVisible();
    }
    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  });
});

test.describe("BR-REQ-041-01 criterion 6 the controls are big enough for a thumb", () => {
  /**
   * `DECISIONS.md` §283 — Amalia: the telephone needs a maximum and a clearer answer as it is
   * typed. E.164 is fifteen digits including the country code, so what the box still has room
   * for depends on the country chosen beside it, and the cap is applied at the keystroke: the
   * digit somebody has just typed is the one they can still see.
   */
  test("caps the telephone at what the chosen country leaves, and says when it is right", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    await page.goto(registerPath);
    await hydrated(page);

    const phone = page.locator('[name="phone"]');
    // E.164 is fifteen digits in all and Romania's code is two of them, so thirteen remain.
    // Sixteen typed, thirteen kept — and the cap is per country, not one number for everybody.
    await phone.fill("0712345678999999");
    await expect(phone).toHaveValue("0712345678999");
    await expect(phone).toHaveAttribute("maxlength", "14");

    // And the confirmation is the number itself, which is the only thing that proves the
    // country beside it was understood.
    await expect(page.getByText("+40712345678")).toBeVisible();
  });

  test("gives the submit button and the required consent at least 44 pixels", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    await page.goto(registerPath);
    await hydrated(page);

    const submit = page.getByRole("button", { name: "Trimite înscrierea" });
    const submitBox = await submit.boundingBox();
    expect(submitBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    /*
      MUI's default checkbox is 42 by 42 — under the rule by two pixels, which is exactly the
      kind of miss that survives a review and fails on a phone.

      Measured on the **input**, which is where the hit area is: MUI's
      `PrivateSwitchBase-input` fills its control and `CHECKBOX_TAP_TARGET` sizes it, while the
      wrapping span has no box of its own — `boundingBox()` answers null for it, which this
      assertion read as zero and called a failure. The thing a thumb lands on is the input.
    */
    const consentBox = await page.locator('[name="privacyAcknowledged"]').evaluate((input) => {
      /*
        Whichever node carries the target, found rather than assumed.

        `CHECKBOX_TAP_TARGET` is applied to MUI's `Checkbox`, and which element in its slot tree
        ends up with the box has moved between versions and between compositions — the input
        itself, or the `PrivateSwitchBase-root` span around it. Asserting on one of them by name
        made this test fail twice for a rule that was being kept: `boundingBox()` answers null
        for a node with no area, which the old assertion read as zero.

        So: walk from the input up to its label and take the largest box on the way. A thumb
        lands on whichever of them is biggest, which is the thing the rule is about.
      */
      let node: HTMLElement | null = input as HTMLElement;
      let best = { width: 0, height: 0 };
      for (let step = 0; step < 4 && node; step += 1) {
        const rect = node.getBoundingClientRect();
        if (rect.width * rect.height > best.width * best.height) {
          best = { width: rect.width, height: rect.height };
        }
        if (node.tagName === "LABEL") break;
        node = node.parentElement;
      }
      return best;
    });
    expect(consentBox.height).toBeGreaterThanOrEqual(44);
    expect(consentBox.width).toBeGreaterThanOrEqual(44);

    // BR-REQ-031-01 criterion 5 (`DECISIONS.md` §102): what is being signed up for, on the
    // form — the event's page, the terms and the privacy notice as links, each a tap target.
    /*
      Not `exact` since §197: the two legal links open in a tab of their own, and their
      accessible name says so — "Termeni de concurs — se deschide într-o filă nouă". That
      sentence is the point of the icon beside them, so the test matches the beginning of the
      name rather than insisting the name never grew.
    */
    for (const name of ["Detaliile evenimentului", "Termeni de concurs", "Confidențialitate"]) {
      const link = page.locator("#main").getByRole("link", { name }).first();
      await expect(link).toBeVisible();
      expect((await link.boundingBox())?.height ?? 0, name).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("BR-REQ-031-04 a rejected submission says what to fix, and goes there", () => {
  test("lands on the error summary and links to the field it names", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    await page.goto(registerPath);
    await hydrated(page);

    await fillRequired(page, "firstName");

    // The browser would refuse this submission itself and focus the empty field, which is the
    // path a person actually takes. Turning native validation off is how the *server's* answer
    // gets exercised — the round trip that has to work for a form posted without JavaScript,
    // by an older browser, or by a bot.
    await page.locator("form").evaluate((form) => {
      (form as HTMLFormElement).noValidate = true;
    });
    await page.getByRole("button", { name: "Trimite înscrierea" }).click();

    // The redirect carries the code, the field names and the fragment that puts somebody at
    // the summary instead of at the top of the page.
    await page.waitForURL(/error=VALIDATION_ERROR/);
    expect(page.url()).toContain("fields=firstName");
    expect(page.url()).toContain("#registration-errors");

    const summary = page.locator("#registration-errors");
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("Verifică aceste câmpuri");

    // The field is named in the summary and marked at the field itself, not only in red.
    const link = summary.getByRole("link", { name: "Prenume" });
    await expect(link).toBeVisible();
    await expect(page.locator('[name="firstName"]')).toHaveAttribute("aria-invalid", "true");

    // Following it moves focus to the input, which is what makes the summary a route back to
    // the form rather than a label on it.
    await link.click();
    await expect(page.locator('[name="firstName"]')).toBeFocused();

    // What was typed is still there (`DECISIONS.md` §142) — and not in the address.
    await expect(page.locator('[name="lastName"]')).toHaveValue("Popescu");
    await expect(page.locator('[name="city"]')).toHaveValue("Brașov");
    /*
      With its plus. The digit filter (§223) strips punctuation as it is typed and **keeps a
      leading `+`** (§226), because that character decides how `composePhone` reads the rest:
      with it, the number must carry the selected country's dialing code; without it, the
      country's code is bolted on to whatever was typed. Dropping the plus briefly turned a
      refused French number under Romania into a silently stored `+4033…`.

      So this is `+40711111111` and not `40711111111` — if it ever fails again, the filter has
      started eating the plus, which is a stored-number bug and not a test to adjust.
    */
    await expect(page.locator('[name="phone"]')).toHaveValue("+40711111111");
    await expect(page.locator('[name="emergencyContactName"]')).toHaveValue("Ion Popescu");
    expect(page.url()).not.toContain("Popescu");
  });

  test("keeps a chosen option and says a phone number is not valid", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    await page.goto(registerPath);
    await hydrated(page);
    await hydrated(page);

    await fillRequired(page);
    await page.locator('[name="phone"]').fill("12");
    // A MUI select: the choice lives in React state, which is exactly what a redirect loses (§142).
    await page.locator("#f-sex").click();
    await page.getByRole("option", { name: "Feminin" }).click();
    // Behind the fold since §171; the point of the test is that what was typed comes back.
    await page.evaluate(() => document.querySelectorAll("details").forEach((details) => (details.open = true)));
    await page.locator('[name="healthNotes"]').fill("Astm");
    // The browser would refuse "12" itself; the server's answer is what this proves.
    await page.locator("form").evaluate((form) => {
      (form as HTMLFormElement).noValidate = true;
    });
    await page.getByRole("button", { name: "Trimite înscrierea" }).click();

    await page.waitForURL(/error=VALIDATION_ERROR/);
    expect(page.url()).toContain("fields=phone");
    await expect(page.locator("#f-sex")).toHaveText("Feminin");
    await expect(page.locator('[name="phone"]')).toHaveValue("12");
    await expect(page.locator('[name="healthNotes"]')).toHaveValue("Astm");
    await expect(page.locator("#main")).toContainText("Numărul nu e valid");
    expect(page.url()).not.toContain("Astm");
  });

  test("refuses somebody under fourteen on the race day, in the picker and on the server", async ({ page }) => {
    /*
      §321 — "Min age must be 14". The picker's `max` is the latest birth date that is still
      fourteen on this race's day, computed on the server from the arithmetic it refuses with, so
      the browser refuses a thirteen-year-old first. Without that — JavaScript off, an old
      browser, a bot — the server refuses, the summary names the birth date with the rule in a
      sentence, and every answer comes back (§286).
    */
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    await page.goto(registerPath);
    await hydrated(page);

    // Said before the first field, and again under the birth date.
    await expect(page.locator("#main")).toContainText("Participanți de la 14 ani");
    await expect(page.locator("#main")).toContainText("Vârsta minimă este 14 ani împliniți în ziua cursei");

    const birthDate = page.locator('[name="birthDate"]');
    const max = await birthDate.getAttribute("max");
    expect(max, "the picker carries the youngest birth date the race accepts").toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const dayAfter = new Date(`${max}T00:00:00Z`);
    dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
    const thirteen = dayAfter.toISOString().slice(0, 10);

    await fillRequired(page);
    await birthDate.fill(thirteen);
    // A minor: the parent's box opens from the date (§188), and is answered, so that the age is
    // the only thing wrong with this form.
    await page.locator('[name="guardianName"]').fill("Ion Popescu");

    // The browser refuses first: the date is past the picker's upper bound.
    expect(await birthDate.evaluate((node) => (node as HTMLInputElement).validity.rangeOverflow)).toBe(true);
    await page.waitForTimeout(HUMAN_PAUSE_MS);
    await page.getByRole("button", { name: "Trimite înscrierea" }).click();
    await expect(page.getByRole("heading", { name: /Aproape gata/ })).toHaveCount(0);
    expect(page.url()).not.toContain("error=");

    // And the server refuses the same, for the submission the browser's check never saw.
    await page.locator("form").evaluate((form) => {
      (form as HTMLFormElement).noValidate = true;
    });
    await page.getByRole("button", { name: "Trimite înscrierea" }).click();
    await page.waitForURL(/error=VALIDATION_ERROR/);
    expect(page.url()).toContain("birthDate");

    const summary = page.locator("#registration-errors");
    await expect(summary.getByRole("link", { name: "Data nașterii" })).toBeVisible();
    await expect(summary).toContainText("Vârsta minimă de participare este 14 ani împliniți în ziua cursei");
    await expect(birthDate).toHaveAttribute("aria-invalid", "true");

    // Nothing typed is lost — and nothing typed is in the address.
    await expect(birthDate).toHaveValue(thirteen);
    await expect(page.locator('[name="lastName"]')).toHaveValue("Popescu");
    await expect(page.locator('[name="guardianName"]')).toHaveValue("Ion Popescu");
    await expect(page.locator('[name="privacyAcknowledged"]')).toBeChecked();
    expect(page.url()).not.toContain(thirteen);
  });

  test("takes the socials out of a minor's form, even with a bad Strava value typed first", async ({ page }) => {
    /*
      BR-REQ-031-04 criterion 8 and §323: the club keeps no Strava or Instagram of a minor, so the
      socials go away once the birth date says under eighteen. Hidden alone was not enough (review
      finding): the Strava box is `type="url"`, and a hidden invalid control stops the browser
      submitting with nothing on screen to say why. The block is disabled while hidden, so a value
      typed before the date was neither blocks the form nor reaches the server.
    */
    test.skip(test.info().project.name !== "mobile", "the 320px form is the one that matters; one registration per run");
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    await page.goto(registerPath);
    await hydrated(page);

    await fillRequired(page);
    // An adult first: the socials are offered, and something that is not a link goes in.
    await page.getByText("Rețele sociale — opțional").click();
    const strava = page.locator('[name="stravaUrl"]');
    await expect(strava).toBeVisible();
    await strava.fill("not a link");
    expect(await strava.evaluate((node) => (node as HTMLInputElement).validity.valid)).toBe(false);

    // Then a birth date of somebody sixteen today: a minor, and old enough for the race (§321).
    const sixteen = new Date();
    sixteen.setUTCFullYear(sixteen.getUTCFullYear() - 16);
    await page.locator('[name="birthDate"]').fill(sixteen.toISOString().slice(0, 10));
    await page.locator('[name="guardianName"]').fill("Ion Popescu");

    // Gone from sight and out of the form: not validated, not posted.
    await expect(strava).toBeHidden();
    await expect(page.getByText("Rețele sociale — opțional")).toBeHidden();
    await expect(strava).toBeDisabled();
    await expect(page.locator('[name="instagramHandle"]')).toBeDisabled();

    await page.waitForTimeout(HUMAN_PAUSE_MS);
    await page.getByRole("button", { name: "Trimite înscrierea" }).click();
    await expect(page.getByRole("heading", { name: "Aproape gata, Ana!" })).toBeVisible();
  });

  test("does not render a field name it does not recognize", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);

    // Anybody can type this parameter. Unknown names are dropped rather than looked up, so the
    // summary falls back to the generic sentence instead of echoing the parameter back.
    await page.goto(`${registerPath}?error=VALIDATION_ERROR&fields=notAField`);

    const summary = page.locator("#registration-errors");
    await expect(summary).toBeVisible();
    await expect(summary).not.toContainText("notAField");
    await expect(summary).toContainText("Verifică datele completate");
  });
});
