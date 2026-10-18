/**
 * How long the «Da, vin» link of a «Vin!» message lives, in hours (§NNN). The service mints the link with it, and the email's
 * sentence and the privacy notice's section 5 say it from the same number (a test pins the texts to it): the link also never
 * outlives the event's start. «Nu vin» lives until the event starts, whenever the message was sent.
 */
export const RSVP_CONFIRM_HOURS = 48;
