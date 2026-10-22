import type { Locator } from "@playwright/test";
import { openFold } from "./fold";

/**
 * «Setări» → «Costuri» as a person opens it: every card is a fold, closed on arrival with its value on its line, and the
 * database's four — «Planul Neon», «Bugetul lunii», «Limitele bazei de date», «Cât de des verifică site-ul» — are folds inside
 * the card «Baza de date — Neon». The specs that read or change one go through these, so a change of the page is one file's.
 */

/** A card of «Costuri» by its testid, opened — «vercel-plan», «translation-budget», «cost-breakdown», «services». */
export async function openCostsCard(main: Locator, testId: string): Promise<Locator> {
  const card = main.getByTestId(testId);
  await openFold(card);
  return card;
}

/** One of the database's four cards by its testid («neon-plan», «neon-budget», «neon-limits», «job-cadence»), the card around it opened first. */
export async function openDatabaseCard(main: Locator, testId: "neon-plan" | "neon-budget" | "neon-limits" | "job-cadence"): Promise<Locator> {
  await openFold(main.getByTestId("database-config"));
  const card = main.getByTestId(testId);
  await openFold(card);
  return card;
}
