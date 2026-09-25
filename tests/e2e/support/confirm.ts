import { expect, type Page } from "@playwright/test";

/**
 * The backoffice's one confirmation dialog (`DECISIONS.md` §NNN, `ConfirmDialog`), answered the
 * way a person does: wait for it, press its confirm button, wait for it to go.
 *
 * Every spec that presses a verb which asks first goes through here, so the day the dialog
 * changes shape — a different button, a different test id — is one edit and not forty. `name` is
 * the dialog's title, for the specs that check which question was asked.
 */
export async function confirmDialog(page: Page, name?: string | RegExp): Promise<void> {
  const dialog = name === undefined ? page.getByRole("dialog") : page.getByRole("dialog", { name });
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("confirm-dialog-confirm").click();
  await expect(dialog).toBeHidden();
}

/** The same dialog, declined: its cancel button, and nothing is sent. */
export async function cancelDialog(page: Page, name?: string | RegExp): Promise<void> {
  const dialog = name === undefined ? page.getByRole("dialog") : page.getByRole("dialog", { name });
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("confirm-dialog-cancel").click();
  await expect(dialog).toBeHidden();
}
