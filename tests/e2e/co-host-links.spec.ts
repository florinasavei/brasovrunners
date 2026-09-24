import { expect, test } from "@playwright/test";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { languageTab, openEditorBox } from "./support/fold";

/**
 * BR-REQ-011-01 criterion 16 (`DECISIONS.md` §168, extended by §344 and §352) — a partner is a
 * card of its own now, in the editor and on the page: its name, what the partnership is in both
 * languages, and its links, where to register with it first.
 *
 * One event, created as a draft and never published: the assertion is what the editor posts
 * and what the preview shows — the event page's own facts, drawn by the same component — not
 * the live listing, so this spec never touches a row any other spec reads.
 */

const SITE_URL = "https://bm.example.test/parteneri";
const FACEBOOK_URL = "https://facebook.com/bm-e2e";
const REGISTER_URL = "https://bm.example.test/inscriere";
const ABOUT_RO = "Alergăm împreună duminică, la festival: un traseu, două cluburi.";
const ABOUT_EN = "We run together on Sunday, at the festival: one course, two clubs.";

test("the editor adds a partner with its description and three links, refuses the description in one language, and the preview shows it in each", async ({
  page,
}) => {
  const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
  const partnerName = `Partener E2E ${suffix}`;

  await signIn(page, "Dev Administrator");
  await page.goto("/ro/admin/events/new");
  await hydrated(page);

  const field = (name: string) => page.locator(`[name="${name}"]`);

  // The date and time are MUI pickers since the pickers landed beside the partners (§347): the
  // posted inputs are hidden, so the picker is driven the way a person drives it.
  await fillDateField(page, "Începutul evenimentului", "2027-06-01");
  await fillTimeField(page, "Ora", "09:00");
  await field("event.locationName").fill("Parcul Tractorul");
  await field("translations.ro.title").fill(`Cros parteneri ${suffix}`);
  await field("translations.ro.slug").fill(`cros-parteneri-${suffix}`);
  await languageTab(page, "title", "en").click();
  await field("translations.en.title").fill(`Partners cross ${suffix}`);
  await languageTab(page, "address", "en").click();
  await field("translations.en.slug").fill(`partners-cross-${suffix}`);

  // The partners' cards live in their own box, "Parteneri — „Împreună cu”" (§350, the editor's
  // boxes), folded until it is opened.
  await openEditorBox(page, "Parteneri");

  // The partner's card: its own name box, "Despre parteneriat" in both languages under it, and
  // its links — the first row is the spare line, the others come from "Adaugă un link". Scoped
  // to the partners' own container, whose id (`recall.idOf("event.coHosts")`) is the only
  // "Adaugă un link" button on this form that belongs to a partner rather than to "Linkuri și
  // fișiere", which carries the same words.
  const coHostsSection = page.locator('[id="field-event.coHosts"]');
  await field("event.coHosts[0].name").fill(partnerName);
  await expect(coHostsSection.getByRole("group", { name: "Despre parteneriat" })).toBeVisible();
  // Romanian only, for now: the save must refuse it (§352, both languages or neither).
  await field("event.coHosts[0].descriptionRo").fill(ABOUT_RO);

  // Named with the partner (§347, batch integration): "Linkuri și fișiere" has its own "Linkul 1".
  const link1 = coHostsSection.getByRole("group", { name: "Linkul 1 al partenerului 1", exact: true });
  await link1.getByRole("combobox").click();
  await page.getByRole("option", { name: "Site-ul partenerului" }).click();
  await field("event.coHosts[0].links[0].url").fill(SITE_URL);

  await coHostsSection.getByRole("button", { name: "Adaugă un link" }).click();
  const link2 = coHostsSection.getByRole("group", { name: "Linkul 2 al partenerului 1", exact: true });
  await link2.getByRole("combobox").click();
  await page.getByRole("option", { name: "Facebook" }).click();
  await field("event.coHosts[0].links[1].url").fill(FACEBOOK_URL);

  // Where to register with the partner, listed last here: the page puts it first.
  await coHostsSection.getByRole("button", { name: "Adaugă un link" }).click();
  const link3 = coHostsSection.getByRole("group", { name: "Linkul 3 al partenerului 1", exact: true });
  await link3.getByRole("combobox").click();
  await page.getByRole("option", { name: "Înscriere la partener" }).click();
  await field("event.coHosts[0].links[2].url").fill(REGISTER_URL);

  // The refusal: the summary names the English box of this partner, and nothing typed is lost.
  await page.getByRole("button", { name: "Creează evenimentul" }).click();
  const refusal = page.getByTestId("form-refusal");
  await expect(refusal).toBeVisible();
  await expect(refusal.getByRole("link", { name: /^Partenerul 1 — despre parteneriat \(English\)/ })).toHaveAttribute(
    "href",
    "#field-event.coHosts[0].descriptionEn",
  );
  await expect(page).toHaveURL(/\/admin\/events\/new$/);
  await expect(field("event.coHosts[0].name")).toHaveValue(partnerName);
  await expect(field("event.coHosts[0].descriptionRo")).toHaveValue(ABOUT_RO);
  await expect(field("event.coHosts[0].descriptionEn")).toHaveValue("");
  await expect(field("event.coHosts[0].descriptionEn")).toHaveAttribute("aria-invalid", "true");
  await expect(field("event.coHosts[0].links[2].url")).toHaveValue(REGISTER_URL);

  // Written in English too, the same press creates the event.
  await field("event.coHosts[0].descriptionEn").fill(ABOUT_EN);
  await page.getByRole("button", { name: "Creează evenimentul" }).click();
  await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/);
  const [, eventId] = /\/admin\/events\/([0-9a-f-]{36})/.exec(page.url()) ?? [];
  expect(eventId).toBeTruthy();

  // The card carried, exactly as typed — the same read `readCoHosts` proves at the unit level.
  await expect(field("event.coHosts[0].name")).toHaveValue(partnerName);
  await expect(field("event.coHosts[0].descriptionRo")).toHaveValue(ABOUT_RO);
  await expect(field("event.coHosts[0].descriptionEn")).toHaveValue(ABOUT_EN);
  await expect(field("event.coHosts[0].links[0].url")).toHaveValue(SITE_URL);
  await expect(field("event.coHosts[0].links[1].url")).toHaveValue(FACEBOOK_URL);
  await expect(field("event.coHosts[0].links[2].url")).toHaveValue(REGISTER_URL);

  // The preview, not the live listing: this event is never published, so nothing here reaches
  // a visitor and no other spec's data is touched.
  await page.goto(`/ro/previzualizare/evenimente/${eventId}`);
  await hydrated(page);

  await expect(page.getByText("Împreună cu")).toBeVisible();
  // Exact: the registration link says the partner's name too ("Înscriere la …").
  await expect(page.getByText(partnerName, { exact: true })).toBeVisible();

  // Scoped to the facts' own "Împreună cu" row: the footer carries its own Facebook mark
  // (`SocialIcon`), and the partner's link must not be confused with it.
  const coHostValue = page.locator("dt", { hasText: "Împreună cu" }).locator("xpath=following-sibling::dd[1]");
  // What the partnership is, in Romanian on the Romanian page, and never the English sentence.
  await expect(coHostValue.getByText(ABOUT_RO)).toBeVisible();
  await expect(coHostValue).not.toContainText(ABOUT_EN);

  // Where to register with the partner comes first, named with the partner, as a link.
  const register = coHostValue.getByRole("link").first();
  await expect(register).toHaveAttribute("href", REGISTER_URL);
  await expect(register).toContainText(`Înscriere la ${partnerName}`);
  await expect(register).toHaveAttribute("target", "_blank");
  expect((await register.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

  const site = coHostValue.getByRole("link", { name: /Site-ul partenerului/ });
  await expect(site).toHaveAttribute("href", SITE_URL);
  await expect(site).toHaveAttribute("target", "_blank");
  await expect(site).toHaveAttribute("rel", /noopener/);
  await expect(site).toHaveAttribute("rel", /noreferrer/);
  await expect(site).toContainText("bm.example.test");
  expect((await site.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

  const facebook = coHostValue.getByRole("link", { name: /^Facebook/ });
  await expect(facebook).toHaveAttribute("href", FACEBOOK_URL);
  await expect(facebook).toHaveAttribute("target", "_blank");
  await expect(facebook).toContainText("facebook.com");
  expect((await facebook.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

  // The English page: the English sentence, and the registration link in English.
  await page.goto(`/en/preview/events/${eventId}`);
  await hydrated(page);
  const coHostValueEn = page.locator("dt", { hasText: "Together with" }).locator("xpath=following-sibling::dd[1]");
  await expect(coHostValueEn.getByText(ABOUT_EN)).toBeVisible();
  await expect(coHostValueEn).not.toContainText(ABOUT_RO);
  const registerEn = coHostValueEn.getByRole("link").first();
  await expect(registerEn).toHaveAttribute("href", REGISTER_URL);
  await expect(registerEn).toContainText(`Register with ${partnerName}`);
});
