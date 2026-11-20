-- «Anonim» → «Cu nume» at the race-day desk: the message type that tells a runner, at once, that a desk role recorded their spoken
-- wish to appear by name on the public list and in the results, with the one-tap way back (LIST_CONSENT_RECORDED). A migration of
-- its own: a value added to an enum cannot be used in the transaction that adds it. Expand only — no table, no column: the wish is
-- the registration's own `list_opt_out`, and who recorded it is the audit row's actor.
ALTER TYPE "public"."email_message_type" ADD VALUE 'LIST_CONSENT_RECORDED';
