import {
  cachedVolunteerAgreementDescribed,
  cachedVolunteerAgreementInForce,
  cachedVolunteerMinorsOpen,
  cachedVolunteerProfileDescribed,
  cachedVolunteerRoles,
  cachedVolunteersDescribed,
} from "@/modules/public-cache/reads";
import { volunteerBoxRoles, volunteerEventAhead, volunteerOfferClosedFor } from "./domain/volunteer";
import type { PublicVolunteerRole } from "./volunteers";

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
  /** The roles still needing people, in the club's order — empty only for a person reading the answer to their own post. */
  roles: PublicVolunteerRole[];
  /** «Oferim tricouri voluntarilor» (§765): the form asks the size. */
  shirts: boolean;
  /**
   * «Arată public câți voluntari mai sunt necesari» (§NNN): the page says how many people a role still needs only while it is on —
   * off, a role says only that it still takes people. Every public number about volunteers asks this one flag.
   */
  showCounts: boolean;
  /** The notice in force names what a volunteer says about themselves (§765): the form asks it — else §758's tick. */
  profile: boolean;
  /** The club may take a person under eighteen (§768): the notice and the agreement in force both describe minors. */
  minors: boolean;
};

export async function readVolunteerOffer(
  event: { id: string; eventStatus: string; startsAt: Date | null; endsAt: Date | null },
  now: Date,
  answer: "done" | "full" | "invalid" | "captcha" | "limited" | null = null,
): Promise<VolunteerOffer | null> {
  const { acceptsVolunteers, shirts, showCounts, roles } = await cachedVolunteerRoles(event.id);
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
  return { roles: boxRoles, shirts, showCounts, profile, minors };
}
