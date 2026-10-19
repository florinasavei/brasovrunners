/**
 * How long the «Da, vin» link of a «Vin!» message lives, in hours (§812). The service mints the link with it, and the email's
 * sentence and the privacy notice's section 5 say it from the same number (a test pins the texts to it): the link also never
 * outlives the event's start. «Nu vin» lives until the event starts, whenever the message was sent.
 */
export const RSVP_CONFIRM_HOURS = 48;

/**
 * A withdraw link (and, §NNN, the question's «Nu mă mai întreba la seria aceasta») outlives the start it was sent with by this many days;
 * the event's start at the press decides «Nu mai vin» (a moved event keeps its links), while the refusal link simply lives this long after it.
 */
export const RSVP_LINK_GRACE_DAYS = 60;
