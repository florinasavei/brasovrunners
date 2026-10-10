import type { EmailLocale } from "@/infrastructure/email/adapter";
import { formatLei, orderTotalBani } from "@/modules/content/shop/domain";

/**
 * The members' shop's three emails (§683), the order's facts in each half's own language — the
 * platform's lines, kept whoever wrote the message's words (the club's text replaces only the subject
 * and the body, §247): the bold line with the order, then the payment words the club set on «Magazin»
 * and the note the member wrote. Read at the send from the order's own copy (`render.ts`), so an
 * edited product never changes what an email about an order says.
 */
export type ShopOrderFacts = {
  number: number;
  titleRo: string;
  titleEn: string;
  variant: string | null;
  quantity: number;
  unitPriceBani: number;
  note: string | null;
  /** «Cum se plătește» in each language, both or neither (§352). */
  paymentRo: string | null;
  paymentEn: string | null;
  /** The ordering member's name, for the club's notice. */
  memberName: string;
};

export function shopOrderTitle(locale: EmailLocale, order: ShopOrderFacts | undefined): string {
  if (!order) return locale === "ro" ? "produs" : "item";
  return locale === "ro" ? order.titleRo : order.titleEn;
}

/** «Comanda nr. 12: Tricou — M × 2 — 90 lei». */
export function shopOrderLine(locale: EmailLocale, order: ShopOrderFacts): string {
  const what = `${shopOrderTitle(locale, order)}${order.variant ? ` — ${order.variant}` : ""} × ${order.quantity}`;
  const total = formatLei(orderTotalBani(order), locale);
  return locale === "ro" ? `Comanda nr. ${order.number}: ${what} — ${total}` : `Order no. ${order.number}: ${what} — ${total}`;
}

/** The lines after the words: how to pay (on the member's messages), and the note. */
export function shopOrderLines(locale: EmailLocale, order: ShopOrderFacts, options: { payment: boolean }): string[] {
  const lines: string[] = [];
  if (options.payment) {
    const words = order.paymentRo && order.paymentEn ? (locale === "ro" ? order.paymentRo : order.paymentEn) : null;
    lines.push(
      words
        ? `${locale === "ro" ? "Cum se plătește" : "How to pay"}: ${words}`
        : locale === "ro"
          ? "Clubul îți spune cum se plătește."
          : "The club will tell you how to pay.",
    );
  }
  if (order.note) lines.push(locale === "ro" ? `Nota comenzii: „${order.note}”` : `The order's note: “${order.note}”`);
  return lines;
}
