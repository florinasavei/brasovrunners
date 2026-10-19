import {
  cachedVolunteerAgreementDescribed,
  cachedVolunteerAgreementInForce,
  cachedVolunteerMinorsOpen,
  cachedVolunteerProfileDescribed,
  cachedVolunteerRoles,
  cachedVolunteersDescribed,
  cachedVolunteersListDescribed,
} from "@/modules/public-cache/reads";
import { volunteerBoxRoles, volunteerEventAhead, volunteerOfferClosedFor } from "./domain/volunteer";
import type { VolunteersAccess } from "./domain/access";
import type { PublicVolunteerCategory, PublicVolunteerRole } from "./volunteers";

/**
 * What an event offers volunteers right now, for the two public surfaces that ask (§768, amending §754): the event page's
 * short box («Căutăm voluntari: …», a button) and the volunteers' own page, `/evenimente/<slug>/voluntari` — one read, so
 * the box that says «Căutăm voluntari» and the page it links to can never disagree about whether there is a form.
 *
 * `null` is closed — the event takes no volunteers, is not ahead, no role needs people, or the privacy notice or the
 * volunteer agreement in force does not describe them (`volunteerOfferClosedFor`, the one rule the card and the action
 * read too): the box draws nothing and the page answers 404, never a form that cannot be sent. Everything comes from the
 * public cache (§327), expired by every write to the roles, the people and the texts; the action asks the database again.
 *
 * `answer` is how the form just answered (`?volunteer=`): a person whose post was the last one the organizers' roles
 * had room for still reads the answer on the page (`volunteerBoxRoles`: «toate rolurile s-au umplut»), so the page
 * stays for them with no role and no form. The event page passes none.
 */
export type VolunteerOffer = {
  /**
   * «Cine se poate oferi» (§NNN): the choice, read with the roles from the same cache entry. It decides what each surface draws, never
   * whether the offer is open (`null` is that): the event page's box (anyone, the club's members, or no box at all) and the volunteers'
   * page's door (`volunteerDoorFor`), which adds what only a request knows — the session and the emailed link. The read itself holds
   * nothing per viewer, so everything it feeds stays shareable.
   */
  access: VolunteersAccess;
  /** The roles still needing people, in the club's order — empty only for a person reading the answer to their own post. */
  roles: PublicVolunteerRole[];
  /** The event's categories in the club's order, each with its contact person (§774): the page draws a heading for each that has a role in `roles`. */
  categories: PublicVolunteerCategory[];
  /** «Oferim tricouri voluntarilor» (§765): the form asks the size. */
  shirts: boolean;
  /**
   * «Arată public câți voluntari mai sunt necesari» (§773): the page says how many people a role still needs only while it is on —
   * off, a role draws no count, never how many. Every public number about volunteers asks this one flag.
   */
  showCounts: boolean;
  /** The notice in force names what a volunteer says about themselves (§765): the form asks it — else §758's tick. */
  profile: boolean;
  /** The club may take a person under eighteen (§768): the notice and the agreement in force both describe minors. */
  minors: boolean;
  /**
   * The form asks «Vreau să apar pe lista publică a voluntarilor» (§NNN): the club ticked «Lista voluntarilor e publică pe pagina evenimentului» **and**
   * the notice in force describes the list (`{{volunteersList}}`). Off, the box is not drawn — a tick that promised nothing would mean nothing — and
   * the service drops one posted anyway (`submitVolunteer`).
   */
  listTick: boolean;
};

export async function readVolunteerOffer(
  event: { id: string; eventStatus: string; startsAt: Date | null; endsAt: Date | null; volunteersListPublic?: boolean | null },
  now: Date,
  answer: "done" | "full" | "invalid" | "captcha" | "limited" | null = null,
): Promise<VolunteerOffer | null> {
  const { acceptsVolunteers, access, shirts, showCounts, roles, categories } = await cachedVolunteerRoles(event.id);
  if (!acceptsVolunteers) return null;
  const closed = volunteerOfferClosedFor({
    acceptsVolunteers,
    standings: roles,
    noticeDescribes: await cachedVolunteersDescribed(now),
    agreementInForce: await cachedVolunteerAgreementInForce(now),
    noticeDescribesAgreement: await cachedVolunteerAgreementDescribed(now),
    eventAhead: volunteerEventAhead(event, now),
    // A published, public event: the members' events never reach the public read, and neither does a draft.
    published: true,
    membersOnly: false,
  });
  const boxRoles = volunteerBoxRoles(closed, roles, answer);
  if (boxRoles === null) return null;
  const profile = await cachedVolunteerProfileDescribed(now);
  // Minors ride on the profile form: no age is asked without it, so no minor is either (§768).
  const minors = profile && (await cachedVolunteerMinorsOpen(now));
  // A cache entry written before the categories existed has none: the roles are then simply listed (§774).
  // «Vreau să apar pe lista publică a voluntarilor» (§NNN): asked only where the club made the list public and the notice says what it shows. A last good copy of the event made before the column has none.
  const listTick = event.volunteersListPublic === true && (await cachedVolunteersListDescribed(now));
  return { access: access ?? "ANYONE", roles: boxRoles, categories: categories ?? [], shirts, showCounts, profile, minors, listTick };
}
