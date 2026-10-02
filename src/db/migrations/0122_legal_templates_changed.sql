-- expand: the Administrators' notice that a release moved a legal template (§639) is a message type of its own, queued by the maintenance job. An enum value is only added: the code serving while this runs never names it, and nothing stored changes.
ALTER TYPE "public"."email_message_type" ADD VALUE 'LEGAL_TEMPLATES_CHANGED';
