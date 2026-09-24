-- Expand only (AGENTS.md §7.6): one enum value, nothing else. "Trimite un mesaj participanților":
-- a message the organizer writes per send, in Romanian and English, to the registrants of one
-- event (ORGANIZER_MESSAGE). The words travel in the outbox payload; no column changes.
ALTER TYPE "public"."email_message_type" ADD VALUE 'ORGANIZER_MESSAGE';
