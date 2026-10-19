import { expect, type Page } from "@playwright/test";

/**
 * The newest message the server captured for this address whose words contain `needle`, as `/devs` → «Emailuri» shows it (local and
 * test only): its words and its real links, the ones the person would have been sent. The outbox drains after the response that queued
 * it, so it is waited for. A spec that has to walk an emailed link reads it here instead of storing a secret of its own: the link is
 * then minted by the platform, at the send, and the render → mint → link path is under test (`family-registration.spec.ts`,
 * `volunteers.spec.ts`).
 */
export async function capturedEmail(page: Page, email: string, needle: string): Promise<{ text: string; links: string[] }> {
  let found: { text: string; links: string[] } | undefined;
  await expect(async () => {
    await page.goto("/ro/devs?panel=email");
    const boxes = page.getByTestId("captured-email").filter({ hasText: email });
    const all = await boxes.evaluateAll((elements) =>
      elements.map((element) => ({
        text: element.querySelector('[data-testid="captured-text"]')?.textContent ?? "",
        links: Array.from(element.querySelectorAll("a")).map((anchor) => anchor.href),
      })),
    );
    found = all.find((message) => message.text.includes(needle));
    expect(found).toBeTruthy();
  }).toPass({ timeout: 45_000 });
  return found!;
}
