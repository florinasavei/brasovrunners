-- Expand only (AGENTS.md §7.6): a column default, nothing added or removed. The public
-- participant list is a disclosure (BR-REQ-039-01; DECISIONS.md §32, §323), so a registration
-- written without an answer is off the list rather than on it. Every insert in the code states
-- the person's answer, so no existing row and no running build is affected.
ALTER TABLE "registrations" ALTER COLUMN "list_opt_out" SET DEFAULT true;
