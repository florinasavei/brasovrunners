import { and, desc, eq, inArray, ne, or, sql, type SQLWrapper } from "drizzle-orm";
import { type AuditLog, auditLogs } from "@/db/schema/audit-logs";
import { staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";

/**
 * Writing and reading the audit trail (AGENTS.md §12.12; BR-REQ-037-03 criterion 3).
 *
 * One writer, and it is deliberately the only one: every administrative change to a
 * registration goes through `modules/registrations/admin-service.ts`, which calls this
 * immediately after the change it describes. The two rows that record what a participant did
 * rather than what staff did — the public-list answer changed from their own link, and the
 * form filled a second time (§312) — are written by the participant's own path, with no actor.
 *
 * Not inside the same transaction, and that is a trade rather than an oversight. Each of those
 * changes runs through the registration allocator, which owns its own transaction around the
 * event-row lock (§10.6); reaching inside it would mean either nesting transactions or writing
 * a second path into `registrations`, and a second write path into that table is the thing the
 * whole module exists to prevent. The consequence is bounded and worth naming: a process that
 * dies in the microseconds between the two leaves a change with no audit row — never an audit
 * row for a change that did not happen.
 *
 * `AuditAction` is a closed union rather than free text so the trail can be read months later
 * by somebody who was not here: a typo'd action string is a row nothing will ever find.
 */
export type AuditAction =
  | "registration.created_by_staff"
  | "registration.name_corrected"
  /**
   * «Modifică datele» (§645): one answer the person typed, corrected by an Administrator —
   * `{ field, from, to }`, the column and its two values, one row per changed column (the name of
   * record keeps its own `registration.name_corrected`). The values are the person's data, so they
   * go with the row: the erase and the retention sweep remove `from` and `to` as they do a rename's
   * (`scrubRegistrationsFromAudit`), and the emergency contact's seven days after the event
   * (`jobs/retention.ts`), leaving which field was corrected, by whom and when.
   */
  | "registration.answer_corrected"
  /**
   * «Scoate bifa la cele {n}» (§645): one row per sweep of «Bife de membru fără cont de membru»,
   * beside each registration's own `registration.answer_corrected` — `{ count, eventId }`, the event
   * the list was scoped to or null for every event that has not started. Never who.
   */
  | "registrations.member_ticks_cleared"
  | "registration.cancelled_by_staff"
  /**
   * A participant cancelled their own registration (§547): from their manage link, «Înscrierile
   * mele» or the family's declarations wizard. No staff actor; the metadata is the state it left and
   * the door (`{ from, via }`), never the name.
   */
  | "registration.cancelled_by_participant"
  /**
   * Erasure (BR-REQ-037-06). The one action whose audit row outlives the thing it describes:
   * `entity_id` carries no foreign key, so this survives the delete and is the only remaining
   * evidence that the registration existed and who authorised its removal.
   */
  | "registration.deleted_by_staff"
  /** A refusal rather than a change — BR-REQ-037-02 criterion 5 requires it be recorded. */
  | "registration.resend_rate_limited"
  /**
   * A resend sent at once, past the scheduled pass (§540): the staff member (the actor), the outbox
   * row's id and its message type — never the address or a body.
   */
  | "registration.sent_now"
  /** «Retrimite familiei» (§588): one email for every person on the address at the event; the row it was sent for, never a name. */
  | "registration.family_resent"
  /**
   * «Retrimite declarația tuturor care nu au semnat» (§606): one row for the press, on the event —
   * the Administrator (the actor) and the counts `{ queued, skippedRecent, skippedLimited }` of real
   * registrations, the test ones apart under `test`; never a name or an address. Each row it queued
   * is a manual resend on its own registration's outbox history, as a single press leaves it.
   */
  | "registration.bulk_resend"
  /** The same press refused by its own hourly limit per event (§606), recorded as BR-REQ-037-02 criterion 5 asks. */
  | "registration.bulk_resend_rate_limited"
  /** Race numbers given to an event's confirmed registrations, as a batch (BR-REQ-038-01). */
  | "registration.bibs_assigned"
  // The desk's spare numbers reserved by a print (§444): the range, never a name.
  | "registration.bib_spares_reserved"
  /** One number typed by hand, or cleared (BR-REQ-038-01 criterion 7). */
  | "registration.bib_set"
  /**
   * Bibs the club says are on paper, or no longer are (§264).
   *
   * The batch's row names the event, the scope and the count and no participant — a printing
   * record is not a record of who was printed, and the count is what answers "did somebody
   * already print these".
   */
  | "registration.bibs_printed"
  | "registration.bibs_unprinted"
  /** Confirmed at the desk: address vouched for, declaration on paper (BR-REQ-037-07). */
  | "registration.confirmed_by_staff"
  /** Given a place ahead of the queue, into a free one (BR-REQ-037-07). */
  | "registration.promoted_by_staff"
  /**
   * «Trimite-i oferta» (§615): a free place offered by the organizer to a named waiting-list
   * registration — the ordinary offer and its email, no confirmation. From and to, and how many
   * waited before this person in the line (`aheadOf`) — never a name.
   */
  | "registration.offered_by_staff"
  /**
   * «Dă-i un loc acum» (§637): an Administrator vouched for the address of a registration still
   * waiting for it and gave it a place ahead of the line, the declaration still the person's to sign.
   * From and to, how many waited at that moment (`waiting`), and `familyReservation` when the place
   * was the family's own reserved one — never a name or an address.
   */
  | "registration.address_vouched_by_staff"
  /**
   * «În afara locurilor» set or cleared by an Administrator (§643): `from` and `to` (the flag before
   * and after), the state the row was in and, when the change moved it, the state after — never a name.
   */
  | "registration.outside_capacity_changed"
  /**
   * A deadline of this registration moved later by the maintenance job's outage grace (§657): the
   * site's name did not resolve, or no scheduler call arrived. No actor; `kind` (which deadline),
   * `from` and `to` (instants), the window's id and `source` — never a name.
   */
  | "registration.deadline_moved_for_outage"
  /**
   * This registration's declaration hold followed its event's changed participation window (§665): the
   * actor who saved the event, `from` and `to` (instants) — never a name.
   */
  | "registration.hold_moved_by_window"
  /**
   * The outage grace did not revive this registration's lapsed claim (§657): an offer or a family's
   * reservation whose deadline passed while the platform could not be reached, and whose counted place
   * was given meanwhile. It lapses as it would have; the job seats nobody, an Administrator decides. No
   * actor; `kind`, the window's id and the `deadline` left as it was — never a name.
   */
  | "registration.not_revived_for_outage"
  /** The participant is here (BR-REQ-037-08); by staff, or by themselves. */
  | "registration.checked_in"
  | "registration.checkin_undone"
  /**
   * The participant's own answer to the public list, changed after registration
   * (BR-REQ-039-01; `registrations/list-consent.ts`). The one action with no staff actor: the
   * person did it themselves, from a link. Metadata is the shape — LISTED or NOT_LISTED, before
   * and after, and which door — never the name that went on or came off the list.
   */
  | "registration.list_consent_changed"
  /**
   * The public form filled again, with the same address, for a registration that is still
   * active (§312). Written by `submitRegistration` itself, inside the transaction that queues
   * the re-send, with no staff actor: nobody at the club did anything, the person did. It is
   * here so the club can answer "she says she registered twice" from the screen — the
   * participant is told in the re-sent message (§235), and the public screen stays generic for
   * everybody (§19.4). Metadata is the state it found and the message type re-sent, or null;
   * never the address or the name that was typed.
   */
  | "registration.resubmitted"
  /**
   * «Nu înscriu această persoană» pressed on the family link (§468, amending §446): the kept form
   * of another person on one address deleted, nobody registered. No staff actor — the address
   * holder answered from their inbox; the participant is the address's own, the entity the event,
   * the metadata `{ by: "family_link" }` — never the name or birth date the form carried.
   */
  | "event.family_entry_declined"
  /**
   * Somebody at the club read a registration's emergency details — the phone, the emergency
   * contact and the health note (§322). Written each time the section is opened, with the
   * reader as the actor and no value in the metadata: Article 9 data is read by name, and the
   * trail is how the club answers "who has seen my health note".
   */
  | "registration.health_viewed"
  /**
   * «Datele înscrierii» opened (§645): every answer the person typed, the phone and the emergency
   * contact among them, so it is recorded like the emergency section beside it — the reader as the
   * actor, no value in the metadata. The health note is not among the answers and is not shown.
   */
  | "registration.answers_viewed"
  /**
   * Optional data withdrawn (§322): the health note and its consent, the socials, or the
   * results consent. By the participant from their own link (no staff actor, the door in the
   * metadata) or by an Administrator (the actor, and the reason typed). The metadata names the
   * fields — `["health"]`, `["socials"]` — and never what they held.
   */
  | "registration.consent_withdrawn"
  /**
   * «Vreau să primesc oferte și beneficii» switched (§562, `registrations/promo-consent.ts`): the
   * new value (`to: true | false`) and the door — the manage link, «Înscrierile mele», the
   * declaration page, or an Administrator withdrawing it for a person who wrote (the actor and the
   * reason then). Never the name or the address.
   */
  | "registration.promo_consent_changed"
  /** The registrations exported to a file (§322): the event, the format and the row count — never a row. */
  | "registration.exported"
  /**
   * One registration's signed declaration downloaded as a PDF (§324): a file that names a
   * person and an identity document and leaves the application, where no erase can reach it.
   * The reader as the actor, `{ format: "pdf" }` as the metadata — never a value.
   */
  | "registration.declaration_downloaded"
  /**
   * A declaration held for a complaint or a dispute, or released (§556): the Administrator (the
   * actor), the typed reason and the acceptance's id on the registration's trail — never the person.
   */
  | "registration.declaration_hold_set"
  | "registration.declaration_hold_cleared"
  /** Every signed declaration of one event downloaded as one PDF (§324): the event and how many, never who. */
  | "event.declarations_downloaded"
  /**
   * One group run's optional self-declaration downloaded as a PDF from the backoffice (§393, as
   * §324 for the race's): the event as the entity, `{ format: "pdf" }` — never whose it was.
   */
  | "event.group_run_declaration_downloaded"
  /**
   * One group run's self-declaration erased by an Administrator (§393, as §67 and §88 for a
   * registration): written first, in the transaction that deletes the row. Names who acted and why
   * (the reason typed) and the event — never who had signed: the row it would name is gone.
   */
  | "event.group_run_declaration_erased"
  /**
   * A group-run declaration held for a complaint or a dispute, or released (§556): the Administrator,
   * the typed reason, the event and the declaration's id — never who had signed.
   */
  | "event.group_run_declaration_hold_set"
  | "event.group_run_declaration_hold_cleared"
  /** One event's emergency sheet rendered (§322): the event and the row count, never a value. */
  | "event.emergency_sheet_viewed"
  /**
   * Everything the platform holds about one person, downloaded as a file by an Administrator
   * (§322) — the answer to an access request (art. 15 GDPR). Counts only in the metadata.
   */
  | "participant.data_exported"
  /** The outbox drained by hand from the backoffice, within the day's allowance (`DECISIONS.md` §80). */
  | "outbox.sent_by_staff"
  /**
   * «Reîncearcă emailurile eșuate» (§622): the week's FAILED rows put back in the queue — how many and
   * who pressed, never an address or a message.
   */
  | "email_outbox.retry_failed"
  /** The thank-you sent once per event to everyone checked in — the event and the count, never who (§82). */
  | "event.thanks_sent"
  /**
   * The event cancelled in the editor (§331): the reason the organizer typed, whether the
   * participants were told and how many were — never who they are. One row per date the save
   * cancelled, a date of the series that had already begun included: that one is marked
   * `alreadyStarted` and told nobody.
   */
  | "event.cancelled"
  /** "Detalii actualizate" queued (§331): which facts changed, the organizer's note and the count. */
  | "event.update_notice_sent"
  /**
   * "Trimite un mesaj participanților" (§364): who sent it (the actor), to which part of the
   * event's registrants, how many real ones and how many test ones, the subject in both languages
   * and the send's own id — never who received it, and never the body (§12.12: no email body).
   * The event's "Mesaje trimise" history is read from these rows.
   */
  | "event.participant_message_sent"
  /**
   * A newsletter queued from `/admin/newsletter` (§445): who (the actor), the topic, how many
   * subscribers and the subject in both languages — never an address, never the body (§12.12).
   */
  | "newsletter.sent"
  /** A subscription removed by an Administrator at the person's written request (§445) — never the address. */
  | "newsletter.address_withdrawn"
  /**
   * A subscription removed from the «Abonați» list's row (§550): who, why (the list, at the club's
   * hand) and whether it had confirmed; the subscriber's id, which no longer names a row — never the address.
   */
  | "newsletter.subscriber_unsubscribed"
  /** The «Abonați» list downloaded as a CSV (§550): who, the filter's shape and how many rows — never a row. */
  | "newsletter.subscribers_exported"
  /** Who said yes to offers and benefits, downloaded as a CSV (§562): who and how many rows — never a row. */
  | "newsletter.promo_consenters_exported"
  /**
   * «Descarcă lista pentru sponsori» (§570): the minimal CSV a partner receives — the event, or
   * null for every event, how many rows, the ids of the registrations in it (never a name or an
   * address) and the recipient the download named, or null. The file is the one copy a withdrawal
   * cannot reach, so the trail says which registrations went to whom (`listPartnerShares`).
   */
  | "registrations.sponsor_list_exported"
  /**
   * An event erased outright, with everyone registered for it (BR-REQ-037-06). Like
   * `registration.deleted_by_staff` it outlives what it describes, and like it, it names the
   * thing and never the people: the event's title and date, how many registrations went with
   * it, and the reason the Administrator typed. One of these, plus one
   * `registration.deleted_by_staff` per registration, is the whole record that the event and
   * its queue ever existed.
   */
  | "event.hard_deleted"
  /**
   * A series' "Publică datele noi automat" switched (§350): on the source's rule, from and to,
   * and which date's editor it was pressed from — a change to what the site will publish by
   * itself every week, so the trail says who made it.
   */
  | "event.repeat_publish_changed"
  /**
   * «Locurile din lista de așteptare se alocă automat» switched (§615): from and to, on every date a
   * save changed it — the editor's own date and each date of a series the scoped save carried it to.
   */
  | "event.waitlist_auto_offer_changed"
  /**
   * One supplementary place added by «Trimite-i oferta» on a full event (§642): the capacity from and
   * to, the Administrator (the actor), the event (the entity) and the registration offered the place
   * (`registrationId`, an id, never a name) — written in the transaction that makes the offer, under
   * the event lock. Shown on that registration's page among «Ce a făcut echipa» (`listAuditTrail`).
   */
  | "event.capacity_raised_for_offer"
  /** The same supplementary place, added by «Dă-i un loc acum» on a full event (§637, §642): same metadata. */
  | "event.capacity_raised_for_place_now"
  /**
   * The same supplementary place, added by a send of invitations on a full event (§647, §642): from and
   * to, and the invitation it was added for (`invitationId`, an id, never a name or an address).
   */
  | "event.capacity_raised_for_invitation"
  /**
   * Invitations (§647), each row about one invitation of the event (the entity), by its id in the
   * metadata — never the name or the address, which the invitation row keeps and the retention erases:
   * sent (the deadline, «În afara locurilor», whether a place was added, and the member's account when
   * one was picked), resent (the deadline before and after), withdrawn, expired (no actor: the
   * maintenance job), and accepted (no actor: the person, from the link; the registration's id).
   */
  | "event.invitation_sent"
  | "event.invitation_resent"
  | "event.invitation_withdrawn"
  | "event.invitation_expired"
  | "event.invitation_accepted"
  /**
   * An invitation's deadline moved later by the outage grace (§657): the invitation's id, from and to,
   * the window's id and source — never a name or an address.
   */
  | "event.invitation_deadline_moved_for_outage"
  /**
   * A save of the event moved the declaration holds its participation window gave (§665): who saved,
   * how many (`moved` real, `test` apart), `to` (the instant) and how many declaration emails it queued
   * — never a name.
   */
  | "event.holds_moved_by_window"
  /**
   * An invitation the outage grace did not revive (§657): it lapsed while the platform could not be
   * reached and its counted place was given meanwhile. The invitation's id, the window's id and the
   * `deadline` left as it was — never a name or an address.
   */
  | "event.invitation_not_revived_for_outage"
  /**
   * «Arată public câți așteaptă» switched (§634): from and to, on every date a save changed it — the
   * editor's own date and each date of a series the scoped save carried it to.
   */
  | "event.waitlist_count_public_changed"
  /**
   * «Lista ascunsă» changed on an event (§647): the switch, the hidden list's first number or «Numără și
   * lista ascunsă» — `from` and `to` name only the ones that moved, on every date a save changed them.
   */
  | "event.hidden_list_changed"
  /**
   * «Arată public numărătoarea» switched (§647): from and to, on every date a save changed it. Its own
   * action, not the hidden list's: the tick acts on every event, whether it uses the hidden list or not.
   */
  | "event.participant_count_public_changed"
  /** The Mailgun plan the club says it is on, from and to, with the note (§100). */
  | "email_plan.changed"
  /** Which road each group of emails takes, Gmail's cap and pace, the overflow (§443): from and to. */
  | "email_transport.changed"
  /** The Neon plan the club says it is on — Free or Launch — from and to, with the note (§280's follow-up). */
  | "neon_plan.changed"
  /** The Vercel plan the club says it is on — Hobby or Pro — and its seats, from and to, with the note (§610). */
  | "vercel_plan.changed"
  /** The minimum minutes between two real runs of each scheduled job, from and to (§334). */
  | "job_cadence.changed"
  /** The shares of the Neon quota that turn the month's budget amber and red, from and to (§447). */
  | "neon_budget_thresholds.changed"
  /** The club's deadlines ("Termene", §377): which ones moved, each from and to. */
  | "deadlines.changed"
  /** How many registrations one address may carry at one event (§389), from and to. */
  | "registrationsPerAddress.changed"
  /**
   * One press of the one-off button that gives the pictures stored before §414 their ladder
   * (§430): how many it converted, how many it could not read from the store, how many are left.
   * About no single row — a press is a batch — so `entity_id` is null.
   */
  | "media.ladder_given"
  /**
   * «Înlocuiește» (§NNN): a stored picture replaced in place by a new upload — `entity_id` the new
   * picture, the metadata `{ from, to, where, oldDeleted }`: the two asset ids, the place whose
   * reference moved (`{ kind: "album", albumId, itemId }`) and whether the old picture went with it
   * (it stays while anything else still uses it). Never the file's bytes or a person.
   */
  | "media.picture_replaced"
  /**
   * The database's brakes changed from `/admin/tasks` (§335): the compute's size ceiling and the
   * period's CU-hour limit, from and to as Neon stated them before and after — never the request —
   * with what was asked, the environment, and whether all of it was applied.
   */
  | "neon_limits.changed"
  | "delivery_timing.changed"
  | "contact_recipients.changed"
  /** «Adresa de contact afișată»: the mailbox, the club's Gmail, or both (§442). */
  | "shown_contact_address.changed"
  /** «Telefon public»: the number the footer's «Contact» shows, set or cleared (§565); whether one is set, never the number. */
  | "public_phone.changed"
  /** «Aspectul site-ului»: the public pages' light background tint, a preset or a typed colour (§488). */
  | "site_tint.changed"
  /** «Mărimea textului»: the public pages' text size, one of four steps (§530). */
  | "site_font_size.changed"
  /** «Ordinea meniului»: the site menu's one order, every entry's key from first to last (§571). */
  | "menu_order.changed"
  /** The anti-bot challenge switched on or off from the backoffice (§254). */
  | "bot_check.changed"
  /**
   * The club's checklist «De făcut» on `/admin/tasks` (§438): a line added, reworded, ticked,
   * unticked, moved or deleted. Entity `platform_setting` `…e00b`; the metadata is the line's id,
   * its words and its owner (an edit: from and to) — the club's own work, never a participant.
   */
  | "club_todo.added"
  | "club_todo.edited"
  | "club_todo.done"
  | "club_todo.reopened"
  | "club_todo.moved"
  | "club_todo.deleted"
  /** A message's own words, rewritten by the club (§247). */
  | "email_copy.changed"
  /** Who at the club receives the declaration copies and the confirmation notices (§244, §245). */
  | "club_notices.changed"
  /** «Răspunsurile din calendar merg la» (§NNN): the club's address an invitation's answers go to, from and to; empty is off. */
  | "calendar_rsvp_to.changed"
  /**
   * An approved legal version taken out of circulation (`DECISIONS.md` §46, §53).
   *
   * The second action whose row outlives what it describes, in the sense that matters: the
   * `legal_documents` row stays, but nothing in the application will offer, render or resolve
   * it again, so this is the only place that still says the club once published those words,
   * under that number, and who decided it should stop. The metadata carries the key, the
   * version, its effective date and the content hashes — never the text itself (§12.12).
   */
  | "legal_document.withdrawn"
  /**
   * An approved legal version deleted outright (`DECISIONS.md` §151).
   *
   * The strongest case of a row that outlives what it describes: the `legal_documents` row, its
   * text and both translations are gone, so this entry is the *only* record that the club ever
   * published those words under that number — the key, the version, the date it took effect,
   * who approved it, the SHA-256 of each language's text and the reason typed by the person who
   * removed it. Never the text itself (§12.12): the hash is what makes the row checkable
   * against a copy rather than a copy in its own right.
   *
   * The number is retired in the same transaction, so nothing will ever be issued this
   * version's number again; `versionNumberRetired` says so on the row rather than leaving it to
   * be inferred from another table.
   */
  | "legal_document.deleted"
  /**
   * «Șterge» on a version somebody relied on (`DECISIONS.md` §567): retired and hidden from the
   * list, **its text kept** — signatures, events or registrations still point at it. The key, the
   * number, the reason, the counts that stood on it and the hashes; never the text (§12.12), which
   * is still on its row. Told apart from `legal_document.deleted`, which destroyed a version nothing
   * relied on.
   */
  | "legal_document_version.deleted"
  /**
   * A draft made from the platform's template by «Regenerează din șablon» — one text's press on
   * its card, or «Regenerează toate» (§532, §539). One row per draft: the key and the version it
   * was given, so "who regenerated the privacy notice, and when" has an answer. Nothing is in
   * force by it; approving stays its own press.
   */
  | "legal_document.regenerated"
  /**
   * «Echipa» (§459): a card added, written, shown or taken off, moved, or deleted, and the page
   * published, taken off or its introduction saved. The card's id, never its words or the
   * person's name (§12.12): the row says who put a person's photograph on the site, and when.
   */
  | "team_member.created"
  | "team_member.saved"
  | "team_member.shown"
  | "team_member.hidden"
  | "team_member.moved"
  | "team_member.deleted"
  | "team_page.published"
  | "team_page.unpublished"
  | "team_page.intro_saved"
  /**
   * «Întrebări frecvente» (§525): the page saved as one — its introduction and every question,
   * the ids added, deleted, shown and taken off in the metadata, never the words (§12.12) — and
   * the page published or taken off.
   */
  | "faq_page.saved"
  | "faq_page.published"
  | "faq_page.unpublished"
  /**
   * The members' pages (§524): «Beneficiile membrilor» on or off the site, and either of its two
   * texts saved — which text, and whether it is written; never the words.
   */
  | "members_page.published"
  | "members_page.unpublished"
  | "members_page.text_saved"
  /**
   * The members' discount codes (§552): a code added, written, hidden or shown again, moved, or
   * deleted. The code's row id and the shape of the change — never the code, the partner or the words.
   */
  | "member_code.created"
  | "member_code.saved"
  | "member_code.hidden"
  | "member_code.shown"
  | "member_code.moved"
  | "member_code.deleted"
  /**
   * «Adaugă mai mulți membri» (§524): one row per press — how many were added, how many were
   * already members, and each member's sign-in account by row id (created, invited, failed with
   * the provider's words, unconfigured). Never an address or a name: the ids are the staff rows.
   * The result page reads its report back from this row.
   */
  | "staff.members_invited"
  /**
   * «Retrimite invitația» sent at once, past the scheduled pass (§540): the staff member who pressed
   * (the actor), the invited row (the entity), the outbox row's id and its message type — never the
   * address.
   */
  | "staff.invitation_sent_now"
  /**
   * «Tradu din română» (§464): one row per press — who, which boxes by name, how many characters
   * went to which provider. Never the words, in either language. Also the day's meter: the
   * translation budget sums these rows' `characters` since the club's midnight.
   */
  | "content.translated"
  | "translationBudget.changed";

export type RecordAuditInput = {
  actorStaffUserId: string | null;
  participantId?: string | null;
  action: AuditAction;
  // `event` for the one action that is about a whole event's registrations at once;
  // `email_outbox` for the one that is about the queue itself; `legal_document` for the one
  // that is about a version of the club's own text; `participant` for the one about a person
  // across all their registrations (§322).
  // `newsletter` for a send (its id) or a subscription removed by hand (no id: the row is gone).
  // `team_member` for a card of «Echipa» (§459).
  // `content` for a translation press, about boxes in a form rather than a stored row (§472).
  // `staff_user` for the team's rows — a bulk invitation of members names no single one (§524).
  entityType:
    | "registration"
    | "event"
    | "email_outbox"
    | "platform_setting"
    | "legal_document"
    | "participant"
    | "media_asset"
    | "newsletter"
    | "team_member"
    | "content"
    | "staff_user"
    // `member_discount_code` for a code of the members' zone (§552).
    | "member_discount_code";
  /** Null only for an act about no single row — an export of every event's registrations (§322). */
  entityId: string | null;
  /**
   * The shape of the change, never a copy of what it was about. §12.12: no email body, no raw
   * token, no declaration text, no participant export. A name before and after, a status, a
   * reason an organizer typed — those are the whole of what belongs here.
   */
  metadata?: Record<string, unknown>;
  now: Date;
};

/** Returns the new row's id, for the one caller that shows a row back (§524); the rest ignore it. */
export async function recordAuditEvent<T extends Record<string, unknown>>(
  db: Database<T>,
  input: RecordAuditInput,
): Promise<string> {
  const [row] = await db
    .insert(auditLogs)
    .values({
      actorStaffUserId: input.actorStaffUserId,
      participantId: input.participantId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadataJson: input.metadata ?? {},
      createdAt: input.now,
    })
    .returning({ id: auditLogs.id });
  return row.id;
}

/** One audit row of one action, by id, or nothing (§524): a result page reading its own report. */
export async function findAuditEvent<T extends Record<string, unknown>>(
  db: Database<T>,
  id: string,
  action: AuditAction,
): Promise<AuditLog | undefined> {
  const [row] = await db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.id, id), eq(auditLogs.action, action)))
    .limit(1);
  return row;
}

/**
 * Erasure reaches the trail too (§322): the one update this table ever takes.
 *
 * The trail is insert-only because it is evidence — and a record of *what was done* stays
 * evidence without saying *to whom*. Before this, erasing a person left their participant id on
 * every row about the registration until the participant row itself went (and never, when they
 * had another registration), and a name correction kept the old and the new name in its
 * metadata for three years: the one copy of the name the erasure was asked to remove.
 *
 * So, for one registration: every row loses its `participant_id`, a name correction loses its
 * `from` and `to`, and every earlier row loses its `reason` — a cancellation's, a withdrawal's:
 * free text somebody typed about this person while they were still somebody, and the helper
 * under the field asking not to name them is a request, not a guarantee. What stays is who
 * acted, what they did and when — the deletion's own row keeps its status, its reason and its
 * bib number (§311), written under that same helper at the moment of erasing, and the one
 * sentence that says why the rest is gone. Called by `eraseRegistration` inside the transaction
 * that deletes the row, so the scrub and the delete land together or not at all.
 */
export async function scrubRegistrationFromAudit<T extends Record<string, unknown>>(
  db: Database<T>,
  registrationId: string,
): Promise<void> {
  await scrubRegistrationsFromAudit(db, [registrationId]);
}

/**
 * The same scrub for a set of registrations the retention sweep is about to delete (§324): a
 * lapsed registration's rename kept both names for three years after the row itself had gone,
 * which is the leftover the manual erase was written to remove. The set is ids or a subquery of
 * them, run before the delete it describes and in its transaction.
 */
export async function scrubRegistrationsFromAudit<T extends Record<string, unknown>>(
  db: Database<T>,
  registrationIds: readonly string[] | SQLWrapper,
): Promise<void> {
  if (Array.isArray(registrationIds) && registrationIds.length === 0) return;
  const aboutThisRegistration = and(
    eq(auditLogs.entityType, "registration"),
    inArray(auditLogs.entityId, registrationIds as string[] | SQLWrapper),
  );
  await db
    .update(auditLogs)
    .set({ metadataJson: sql`(${auditLogs.metadataJson} - 'from' - 'to')` })
    // A rename's two names, and a corrected answer's two values (§645): the person's data, gone with the row.
    .where(and(aboutThisRegistration, inArray(auditLogs.action, ["registration.name_corrected", "registration.answer_corrected"])));
  await db
    .update(auditLogs)
    .set({ metadataJson: sql`(${auditLogs.metadataJson} - 'reason')` })
    .where(and(aboutThisRegistration, ne(auditLogs.action, "registration.deleted_by_staff")));
  await db.update(auditLogs).set({ participantId: null }).where(aboutThisRegistration);
}

/**
 * A corrected answer's two values (§645, «Modifică datele»), gone when the answer itself goes: the
 * emergency contact seven days after the race, the socials when the person withdraws them or the
 * minors' sweep clears them (§322, §323). The row keeps which field was corrected, by whom and when;
 * only rows that still hold a value are touched, so a later pass writes nothing. Run in the
 * transaction that clears the columns, so the trail never outlives the data it described.
 */
export async function scrubCorrectedAnswerValues<T extends Record<string, unknown>>(
  db: Database<T>,
  registrationIds: readonly string[] | SQLWrapper,
  fields: readonly string[],
): Promise<void> {
  if (Array.isArray(registrationIds) && registrationIds.length === 0) return;
  if (fields.length === 0) return;
  await db
    .update(auditLogs)
    .set({ metadataJson: sql`(${auditLogs.metadataJson} - 'from' - 'to')` })
    .where(
      and(
        eq(auditLogs.action, "registration.answer_corrected"),
        eq(auditLogs.entityType, "registration"),
        inArray(auditLogs.entityId, registrationIds as string[] | SQLWrapper),
        inArray(sql<string>`${auditLogs.metadataJson} ->> 'field'`, [...fields]),
        sql`((${auditLogs.metadataJson} -> 'from') is not null or (${auditLogs.metadataJson} -> 'to') is not null)`,
      ),
    );
}

/**
 * The person, when the erasure took their last registration (§322). A row about the person
 * rather than one registration — `participant.data_exported`, the one kind today — carries
 * their participant id twice: `participant_id`, which the foreign key nulls when the
 * participant row goes, and `entity_id`, which no key reaches and would otherwise keep the
 * deleted person's uuid for three years. Both go, in the transaction that deletes the
 * participant; the row still says that a file was made, by whom and when, and of how much.
 */
export async function scrubParticipantFromAudit<T extends Record<string, unknown>>(
  db: Database<T>,
  participantId: string,
): Promise<void> {
  await db
    .update(auditLogs)
    .set({ participantId: null, entityId: null })
    .where(and(eq(auditLogs.entityType, "participant"), eq(auditLogs.entityId, participantId)));
}

export type AuditEntry = Pick<AuditLog, "action" | "metadataJson" | "createdAt" | "actorStaffUserId"> & {
  /**
   * Null in two cases the timeline must tell apart: the staff account was removed
   * (`actorStaffUserId` set, no row to join), or there never was one — the participant acted
   * from their own link (`actorStaffUserId` null).
   */
  actorName: string | null;
};

/** One file for sponsors that held a registration (§570): when, who downloaded it, whom it was given to. */
export type PartnerShare = { createdAt: Date; actorName: string | null; recipient: string | null };

/**
 * Every list for sponsors a registration was in, newest first (§570, review finding): the export's
 * audit row keeps the ids of the registrations in the file and the recipient the download named, so
 * a withdrawal or an access request can be answered — which partner received this person's data,
 * and when — after the club's own copy is deleted (the notice's art. 15 and 19 promise).
 */
export async function listPartnerShares<T extends Record<string, unknown>>(db: Database<T>, registrationId: string): Promise<PartnerShare[]> {
  const rows = await db
    .select({ createdAt: auditLogs.createdAt, actorName: staffUsers.displayName, metadataJson: auditLogs.metadataJson })
    .from(auditLogs)
    .leftJoin(staffUsers, eq(staffUsers.id, auditLogs.actorStaffUserId))
    .where(
      and(
        eq(auditLogs.action, "registrations.sponsor_list_exported"),
        sql`(${auditLogs.metadataJson} -> 'registrationIds') @> jsonb_build_array(${registrationId}::text)`,
      ),
    )
    .orderBy(desc(auditLogs.createdAt));
  return rows.map((row) => {
    const recipient = (row.metadataJson as { recipient?: unknown } | null)?.recipient;
    return { createdAt: row.createdAt, actorName: row.actorName, recipient: typeof recipient === "string" ? recipient : null };
  });
}

/**
 * Everything that happened to one entity, newest first, with the actor named where there is one —
 * and, for a registration, the supplementary place «Trimite-i oferta» or «Dă-i un loc acum» added to
 * the event for it (`event.capacity_raised_for_offer`, `event.capacity_raised_for_place_now`, §642): a
 * row about the event that names the registration in its metadata, so the registration's page says who
 * added the place and from how many to how many.
 *
 * Both halves name the indexed key (`audit_logs_entity_idx`, entity type and id): the registration's
 * own rows, and its event's rows narrowed to the two actions and the registration in the metadata. A
 * test on the metadata alone could use no index and would read the whole table on every page view, a
 * cost on the database's month (§327); with the event's id the planner ORs two index scans, and another
 * event's raises are never read.
 */
export async function listAuditTrail<T extends Record<string, unknown>>(
  db: Database<T>,
  entityType: "registration",
  entityId: string,
  /** The registration's event: the entity of the raise rows that name it (§642). */
  eventId: string,
): Promise<AuditEntry[]> {
  return db
    .select({
      action: auditLogs.action,
      metadataJson: auditLogs.metadataJson,
      createdAt: auditLogs.createdAt,
      actorStaffUserId: auditLogs.actorStaffUserId,
      actorName: staffUsers.displayName,
    })
    .from(auditLogs)
    .leftJoin(staffUsers, eq(staffUsers.id, auditLogs.actorStaffUserId))
    .where(
      or(
        and(eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, entityId)),
        and(
          eq(auditLogs.entityType, "event"),
          eq(auditLogs.entityId, eventId),
          inArray(auditLogs.action, ["event.capacity_raised_for_offer", "event.capacity_raised_for_place_now"]),
          sql`(${auditLogs.metadataJson} ->> 'registrationId') = ${entityId}`,
        ),
      ),
    )
    .orderBy(desc(auditLogs.createdAt));
}
