-- «Trimite fiecăruia punctul lui» on «Planul voluntarilor»: the message type that tells a volunteer the point of the route
-- they stand at (VOLUNTEER_POINT). A migration of its own: a value added to an enum cannot be used in the transaction
-- that adds it. Expand only — no table, no column: which point a person was already told is read from the outbox's own rows.
ALTER TYPE "public"."email_message_type" ADD VALUE 'VOLUNTEER_POINT';