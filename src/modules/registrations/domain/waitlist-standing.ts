/**
 * Where a person waiting stands in the event's line (§629; the owner:
 * „Ești pe locul 3 din 10”): the three numbers every surface that says it reads, from the one reader
 * (`repository.ts#readWaitlistPosition`) — the registration's own page, «Toate înscrierile mele» and
 * the `WAITLIST_JOINED` email.
 *
 * - `position` — 1 + the `WAITLISTED` rows ahead in queue order, `lockOldestWaitlisted`'s own
 *   `(waitlisted_at, id)`: the order the allocator offers places in on «Da».
 * - `length` — every `WAITLISTED` row of the event. An offered person (`WAITLIST_OFFERED`) has left
 *   the line; a cancelled or expired row never was; a `TEST` row stands in it like a real one
 *   (`AGENTS.md` §12.6).
 * - `autoOffer` — the event's «Ofertele din lista de așteptare pleacă automat» (§615): whether a
 *   freed place goes to the head of the line on its own, or the club chooses who is offered it.
 * - `countPublic` — the event's «Arată public câți așteaptă» (§NNN): false, and no surface says the
 *   line's length, how many others wait, or the person's position — whoever has just joined is last,
 *   so their place is the length. A person on the list is outside the backoffice, so a count told to
 *   them is told to anyone who joins. Absent reads as on (a caller from before the switch).
 *
 * No name and no other person's data: a number is all the line says about anybody else.
 */
export type WaitlistStanding = {
  position: number;
  length: number;
  autoOffer: boolean;
  countPublic?: boolean;
};
