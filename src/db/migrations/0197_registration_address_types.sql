-- «Schimbă adresa»: the two message types that tell both addresses a registration was moved — the old one
-- (REGISTRATION_ADDRESS_REMOVED) and the new one (REGISTRATION_ADDRESS_ADDED). A migration of its own: a value
-- added to an enum cannot be used in the transaction that adds it. Expand only.
ALTER TYPE "public"."email_message_type" ADD VALUE 'REGISTRATION_ADDRESS_REMOVED';--> statement-breakpoint
ALTER TYPE "public"."email_message_type" ADD VALUE 'REGISTRATION_ADDRESS_ADDED';