-- Expand only (AGENTS.md §7.6): one enum value. The participant's own switch for the public
-- participant list, after registration (BR-REQ-039-01; DECISIONS.md §143): the token purpose
-- behind the link in the confirmation email.
ALTER TYPE "public"."email_action_token_purpose" ADD VALUE 'LIST_CONSENT';