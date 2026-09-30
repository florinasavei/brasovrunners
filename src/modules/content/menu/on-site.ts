import type { Locale } from "@/i18n/routing";
import { contactFormReaches } from "@/modules/contact/delivery";
import { faqOnSite } from "@/modules/content/faq/on-site";
import { offersMembersEntry } from "@/modules/content/members/page-settings";
import { teamPageOnSite } from "@/modules/content/team/repository";
import {
  cachedContactFormReaches,
  cachedMenuOrder,
  cachedMembersPage,
  cachedPublishedAlbums,
  cachedShownContactAddresses,
  cachedTeamPage,
} from "@/modules/public-cache/reads";
import { readWithLastGood } from "@/modules/resilience/last-good";
import { env } from "@/shared/config/env";
import type { MenuSectionKey } from "./order";

/**
 * Which of the platform's sections the site menu offers right now, and in what order — the header's
 * questions, asked in one place so the backoffice's «Ordinea meniului» card greys exactly the
 * entries the header leaves out (§571). Every read is the public cache's (§333), each guarded: a
 * failure is an entry not offered, never an error page — a header that throws is a site with no
 * way out of any page.
 */

/** Whether the gallery section is offered: a published album in this locale, or nothing. */
async function hasPublishedAlbum(locale: Locale) {
  try {
    return (await readWithLastGood(`nav:gallery:${locale}`, async () => (await cachedPublishedAlbums(locale)).length > 0)).value;
  } catch {
    return false;
  }
}

/** Whether «Echipa» is offered (§459): the page published with a card on it, or nothing — the gallery's rule. */
async function hasVisibleTeam(locale: Locale) {
  try {
    return (await readWithLastGood(`nav:team:${locale}`, async () => teamPageOnSite(await cachedTeamPage(locale)))).value;
  } catch {
    return false;
  }
}

/**
 * Whether the members' zone is linked (§524): «Beneficiile membrilor» published with its words
 * (`offersMembersEntry`), or nothing. The footer's fold asks it since §NNN; the menu no longer does.
 */
export async function membersOnSite(locale: Locale) {
  try {
    return (await readWithLastGood(`nav:members:${locale}`, async () => offersMembersEntry(await cachedMembersPage(locale)))).value;
  } catch {
    return false;
  }
}

/**
 * "Contact" leads to the form, or to the club's address; a deployment with neither has no entry
 * (BR-REQ-070-04 criterion 1) — the gallery's rule, for the same reason.
 *
 * The same question the page itself asks, and it has to be: since §164 `CONTACT_FORM_MODE` answers
 * for the transport alone, so "can send" no longer implies "has somebody to send to". The reads
 * are skipped by the `||` on the common path: an address to write to, or an environment that
 * already reaches somebody, answers without them — a setting can only *add* recipients.
 */
async function offersContact(): Promise<boolean> {
  try {
    return (
      Boolean(env.EMAIL_REPLY_TO) ||
      contactFormReaches(env, null) ||
      (await cachedContactFormReaches()) ||
      // The club's Gmail alone is an address to write to as well (§442).
      (await cachedShownContactAddresses()).length > 0
    );
  } catch {
    return Boolean(env.EMAIL_REPLY_TO) || contactFormReaches(env, null);
  }
}

/** Whether each of the platform's sections is in the menu now. «Evenimente» and «Calendar» always are. */
export async function menuSectionsOnSite(locale: Locale): Promise<Record<MenuSectionKey, boolean>> {
  const [gallery, team, faq, contact] = await Promise.all([
    hasPublishedAlbum(locale),
    hasVisibleTeam(locale),
    // «Întrebări frecvente» (§525): the page published with a question on it — «Echipa»'s rule.
    faqOnSite(locale),
    offersContact(),
  ]);
  return { events: true, calendar: true, contact, gallery, team, faq };
}

/**
 * The club's stored order for the public menu (§571), or no list — today's default order —
 * whatever goes wrong. The header and the footer both read it; the merge rule is `order.ts`'s.
 */
export async function menuOrderOnSite(): Promise<string[]> {
  try {
    return await cachedMenuOrder();
  } catch {
    return [];
  }
}
