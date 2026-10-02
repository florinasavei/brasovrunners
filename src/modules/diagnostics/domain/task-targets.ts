import { PAGES_ROW_ROUTE } from "@/modules/content/pages/pages-row";
import { SETTINGS_TAB_ROUTE, type SettingsTab } from "@/modules/staff-identity/domain/settings-tabs";
import type { TaskId } from "../owner-tasks";

/**
 * Where a row of «Sarcini» → «Club» is done in the backoffice, when it is (§516; the owner,
 * 2026-09-27: «ne duce prea dintr-o parte în alta»).
 *
 * A row used to say where to go only inside its folded steps, as a path to read — «/admin/emails →
 * „Cine primește mesajele de contact”» — and the reader then found the section, the panel and the
 * card by hand. Each row whose work is a screen of this backoffice now carries one link to it, named
 * by the navigation's own words («Setări → Costuri», «Pagini → Contact»), and the `#` opens the card on arrival
 * (`OpenFoldFromHash`, §336). A row whose work is outside the backoffice — a hosting variable, a
 * DNS record, a monitor — has no target and keeps its steps alone.
 *
 * Pure data, so a unit test walks every target to a route that exists and an anchor a panel
 * carries.
 */
export type TaskTarget =
  | { kind: "settings"; tab: SettingsTab; hash: string }
  /** A standard page of «Pagini» (§525): «Contact» left «Setări» for it on 2026-09-28. */
  | { kind: "pages"; entry: "contact"; hash: string }
  | { kind: "section"; section: "legal" | "staff" | "events" };

export const TASK_TARGETS: Partial<Record<TaskId, TaskTarget>> = {
  // A text to approve is written and approved on «Documente legale» (§46).
  approveLegalText: { kind: "section", section: "legal" },
  listStatesNotice: { kind: "section", section: "legal" },
  listSocialsNotice: { kind: "section", section: "legal" },
  listNumbersNotice: { kind: "section", section: "legal" },
  promoNotice: { kind: "section", section: "legal" },
  sponsorNotice: { kind: "section", section: "legal" },
  newsletterNotice: { kind: "section", section: "legal" },
  gmailFallbackNotice: { kind: "section", section: "legal" },
  refusalTerms: { kind: "section", section: "legal" },
  teamPageNotice: { kind: "section", section: "legal" },
  groupRunSeriesTexts: { kind: "section", section: "legal" },
  // The people are invited on «Echipa» (§450).
  inviteStaff: { kind: "section", section: "staff" },
  // The race is one save and a publish on «Evenimente» (`SETUP.md` §39).
  publishEvents: { kind: "section", section: "events" },
  // The queue, its stop header and «Reîncearcă emailurile eșuate» (§622); the switch and the cap are the panel above it.
  emailFailSafe: { kind: "settings", tab: "emails", hash: "outbox-queue" },
  // What each job did and how often it may run (§334).
  scheduler: { kind: "settings", tab: "costs", hash: "job-cadence" },
  // The switch and the hidden trap (§254, §282).
  botCheck: { kind: "settings", tab: "platform", hash: "bot-check" },
  // «Declarațiile semnate merg la» is in the club's copies (§244).
  declarationArchiveMail: { kind: "settings", tab: "emails", hash: "club-notices" },
  // The daily allowance and the credit (§464, §497).
  translation: { kind: "settings", tab: "costs", hash: "translation-budget" },
  // Who reads «Scrie-ne» (§164).
  contactForm: { kind: "pages", entry: "contact", hash: "contact-recipients" },
  // The domain's line on «Luna aceasta» (§435, §479).
  domainRenewal: { kind: "settings", tab: "costs", hash: "month-costs" },
  // The database's brakes (§335).
  neonLimits: { kind: "settings", tab: "costs", hash: "neon-limits" },
};

/** The internal route a section target opens. */
export const SECTION_TARGET_ROUTE = {
  legal: "/admin/legal",
  staff: "/admin/staff",
  events: "/admin",
} as const;

type TargetPathname =
  | (typeof SETTINGS_TAB_ROUTE)[SettingsTab]
  | (typeof PAGES_ROW_ROUTE)["contact"]
  | (typeof SECTION_TARGET_ROUTE)[keyof typeof SECTION_TARGET_ROUTE];

/** The internal route and the fragment of a target, for `getPathname`. */
export function targetRoute(target: TaskTarget): { pathname: TargetPathname; hash?: string } {
  switch (target.kind) {
    case "settings":
      return { pathname: SETTINGS_TAB_ROUTE[target.tab], hash: target.hash };
    case "pages":
      return { pathname: PAGES_ROW_ROUTE[target.entry], hash: target.hash };
    default:
      return { pathname: SECTION_TARGET_ROUTE[target.section] };
  }
}
