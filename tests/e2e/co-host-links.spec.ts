import { expect, test } from "@playwright/test";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";

/**
 * BR-REQ-011-01 criterion 16 (`DECISIONS.md` §168, extended by §NNN) — a partner is a card of
 * its own links now, in the editor and on the page.
 *
 * One event, created as a draft and never published: the assertion is what the editor posts
 * and what the preview shows, not the live listing, so this spec never touches a row any other
 * spec reads.
 */

const SITE_URL = "https://bm.example.test/parteneri";
const FACEBOOK_URL = "https://facebook.com/bm-e2e";

test("the editor adds a partner with two links, and the preview shows both under «Împreună cu»", async ({ page }) => {
  const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
  const partnerName = `Partener E2E ${suffix}`;

  await signIn(page, "Dev Administrator");
  await page.goto("/ro/admin/events/new");
  await hydrated(page);

  const field = (name: string) => page.locator(`[name="${name}"]`);

  // The date and time are MUI pickers since the pickers landed beside the partners (§NNN): the
  // posted inputs are hidden, so the picker is driven the way a person drives it.
  await fillDateField(page, "Începutul evenimentului", "2027-06-01");
  await fillTimeField(page, "Ora", "09:00");
  await field("event.locationName").fill("Parcul Tractorul");
  await field("translations.ro.title").fill(`Cros parteneri ${suffix}`);
  await field("translations.ro.slug").fill(`cros-parteneri-${suffix}`);
  await page.getByRole("tab", { name: /English/ }).click();
  await field("translations.en.title").fill(`Partners cross ${suffix}`);
  await field("translations.en.slug").fill(`partners-cross-${suffix}`);
  await page.getByRole("tab", { name: /Română/ }).click();

  // The partner's card: its own name box, and its links — the first row is the spare line,
  // the second comes from "Adaugă un link". Scoped to the partners' own container, whose id
  // (`recall.idOf("event.coHosts")`) is the only "Adaugă un link" button on this form that
  // belongs to a partner rather than to "Linkuri și fișiere", which carries the same words.
  const coHostsSection = page.locator('[id="field-event.coHosts"]');
  await field("event.coHosts[0].name").fill(partnerName);

  const link1 = coHostsSection.getByRole("group", { name: "Linkul 1" });
  await link1.getByRole("combobox").click();
  await page.getByRole("option", { name: "Site-ul partenerului" }).click();
  await field("event.coHosts[0].links[0].url").fill(SITE_URL);

  await coHostsSection.getByRole("button", { name: "Adaugă un link" }).click();
  const link2 = coHostsSection.getByRole("group", { name: "Linkul 2" });
  await link2.getByRole("combobox").click();
  await page.getByRole("option", { name: "Facebook" }).click();
  await field("event.coHosts[0].links[1].url").fill(FACEBOOK_URL);

  await page.getByRole("button", { name: "Creează evenimentul" }).click();
  await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/);
  const [, eventId] = /\/admin\/events\/([0-9a-f-]{36})/.exec(page.url()) ?? [];
  expect(eventId).toBeTruthy();

  // The card carried, exactly as typed — the same read `readCoHosts` proves at the unit level.
  await expect(field("event.coHosts[0].name")).toHaveValue(partnerName);
  await expect(field("event.coHosts[0].links[0].url")).toHaveValue(SITE_URL);
  await expect(field("event.coHosts[0].links[1].url")).toHaveValue(FACEBOOK_URL);

  // The preview, not the live listing: this event is never published, so nothing here reaches
  // a visitor and no other spec's data is touched.
  await page.goto(`/ro/previzualizare/evenimente/${eventId}`);
  await hydrated(page);

  await expect(page.getByText("Împreună cu")).toBeVisible();
  await expect(page.getByText(partnerName)).toBeVisible();

  // Scoped to the facts' own "Împreună cu" row: the footer carries its own Facebook mark
  // (`SocialIcon`), and the partner's link must not be confused with it.
  const coHostValue = page.locator("dt", { hasText: "Împreună cu" }).locator("xpath=following-sibling::dd[1]");
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
});
