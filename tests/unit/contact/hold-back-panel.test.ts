import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import ro from "../../../messages/ro.json";

/**
 * BR-REQ-070-04, `DECISIONS.md` §744 (amends §310) — the settings card, rendered: the tick beside its
 * help line and the 30-day count for the Administrator; the read-only view says whether the tick is on.
 */
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "ro", messages: (ro as unknown as Record<string, Record<string, unknown>>)[namespace] as never }),
}));
vi.mock("@/shared/feedback/confirm-words", () => ({ confirmWords: async () => ({ cancel: "Renunță" }) }));
vi.mock("@/shared/forms/refusal-messages", () => ({ refusalMessages: async () => ({}) }));
vi.mock("@/app/[locale]/admin/pages/contact/actions", () => ({ updateContactRecipientsAction: vi.fn() }));

const { default: ContactRecipientsPanel } = await import("@/modules/contact/ui/ContactRecipientsPanel");

type Props = Record<string, unknown> & { children?: ReactNode };
function elements(node: ReactNode, acc: ReactElement<Props>[] = []): ReactElement<Props>[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child as ReactNode, acc);
    return acc;
  }
  if (!isValidElement<Props>(node)) return acc;
  acc.push(node);
  elements(node.props.children, acc);
  return acc;
}
const text = (node: ReactNode): string => (Array.isArray(node) ? node.map(text).join("") : typeof node === "string" || typeof node === "number" ? String(node) : "");

async function render(over: { holdBackSuspected: boolean; mayEdit: boolean; heldBack: number }) {
  const tree = await ContactRecipientsPanel({
    locale: "ro",
    recipients: { to: ["club@example.org"], cc: [], bcc: [], holdBackSuspected: over.holdBackSuspected, updatedAt: null },
    resolved: { to: ["club@example.org"], cc: [], bcc: [], source: "setting" },
    mayEdit: over.mayEdit,
    heldBack: over.heldBack,
  });
  return elements(tree);
}
const byTestId = (all: ReactElement<Props>[], id: string) => all.filter((element) => element.props["data-testid"] === id);

describe("BR-REQ-070-04 the card's tick and count", () => {
  it("draws the tick with its own help line, and the count beside it when on", async () => {
    const all = await render({ holdBackSuspected: true, mayEdit: true, heldBack: 2 });
    const box = all.find((element) => element.props.name === "holdBackSuspected");
    expect(box?.props.defaultChecked).toBe(true);
    expect(box?.props.help).toBe(ro.Admin.emails.contacts.holdBackHelp);
    expect(text(byTestId(all, "contact-held-back")[0].props.children)).toContain("2");
  });

  it("hides a zero count while the tick is off, and shows it once a message was stopped", async () => {
    expect(byTestId(await render({ holdBackSuspected: false, mayEdit: true, heldBack: 0 }), "contact-held-back")).toHaveLength(0);
    expect(byTestId(await render({ holdBackSuspected: false, mayEdit: true, heldBack: 3 }), "contact-held-back")).toHaveLength(1);
  });

  it("read-only: no tick, but says whether it is on, and the count", async () => {
    const all = await render({ holdBackSuspected: true, mayEdit: false, heldBack: 1 });
    expect(all.find((element) => element.props.name === "holdBackSuspected")).toBeUndefined();
    expect(byTestId(all, "contact-hold-back-state")[0].props.children).toBe(ro.Admin.emails.contacts.holdBackOn);
    expect(byTestId(all, "contact-held-back")).toHaveLength(1);
    const off = await render({ holdBackSuspected: false, mayEdit: false, heldBack: 0 });
    expect(byTestId(off, "contact-hold-back-state")[0].props.children).toBe(ro.Admin.emails.contacts.holdBackOff);
  });
});

