import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * `DECISIONS.md` §384 — every irreversible or outward-facing staff action asks first.
 *
 * The rule: an action of class (a) — publish, take off the site, archive, cancel an event, tell
 * the participants, resend, cancel / erase / rename a registration, give a place, set a number,
 * approve or withdraw a legal version, add or remove a colleague, delete an album or a picture,
 * drain the outbox, change a plan, a limit, an interval, the club's deadlines, the contact
 * recipients, the club's copies, an email's wording back to the platform's — is
 * posted through a form that asks: an `ActionForm` with `confirm`, or, where one form carries
 * several verbs, a `ConfirmSubmitButton` (which draws the same `ConfirmDialog`). A plain `<form>`
 * counts only when a `ConfirmSubmitButton` is among its children. A form whose question has
 * `when` conditions asks only for the press that matches them — the event save when it tells
 * the participants or cancels, the create only for "Creează și publică" — and counts as asking.
 *
 * Every other Server Action of the backoffice is in `NOT_CONFIRMED`, each with its reason, and
 * the last test insists every exported action is in one list or the other: a new verb has to be
 * classified before it ships, rather than asking nothing by default.
 *
 * Source-level, like `server-element-props.test.ts`: every `.tsx` under `src/` is parsed, every
 * JSX attribute `action={…}` / `formAction={…}` whose expression names one of the actions — by
 * its own name, or by the prop a page hands it down under — is found, and its element judged.
 * Each action has to be found at least once, so a verb that quietly moved to a bare form fails
 * here rather than on the owner's phone. The server never relies on any of it (BR-REQ-060-01).
 */
const ROOT = path.resolve(__dirname, "../../..");

function actionFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return actionFiles(full);
    return entry === "actions.ts" ? [full] : [];
  });
}

/**
 * A card's own verbs live beside its page in `<card>-actions.ts` (the «Voluntari» card's `volunteer-actions.ts`), which the
 * sweep of `actions.ts` files does not read. A verb of such a file may be classified below all the same — the ones that ask
 * always were (`requestVolunteerAgreementAction`) — and one listed in `NOT_CONFIRMED` is held to still being exported there.
 */
function cardActionFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return cardActionFiles(full);
    return /-actions\.ts$/.test(entry) ? [full] : [];
  });
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx$/.test(entry) ? [full] : [];
  });
}

/** The (a) actions, each with the names a page may post it under besides its own. */
export const CONFIRMED_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  // Events.
  transitionEventAction: [],
  bulkPublishEventsAction: ["publish", "publish.action"],
  bulkArchiveEventsAction: ["archive"],
  bulkDeleteEventsAction: ["remove"],
  // The list's "Publică automat de acum" and the editor's switch, which asks only when turned on.
  setRepeatPublishAction: ["autoPublish.action", "actions.setRepeatPublish"],
  stopRepeatAction: ["actions.stopRepeat"],
  repeatEventAction: [],
  duplicateEventAction: [],
  deleteEventAction: [],
  removeTestRegistrationsAction: [],
  withdrawInterestAction: [],
  // The answers «Vin!» and the remembered browsers of one address erased (§811, art. 17): the person page's own button asks first.
  eraseRsvpsAction: [],
  // The club's invitations to volunteer sent to one address erased (§820, art. 17): the person page's own button asks first.
  eraseVolunteerInvitationsAction: [],
  // «Lista internă de așteptare» lines of one address erased (§876, art. 17): the person page's own button asks first.
  eraseReserveEntriesAction: [],
  // A person's invitations to an event withdrawn through «Retrage» and erased (§876, art. 17): the person page's own button asks first.
  eraseEventInvitationsAction: [],
  // A group run's self-declaration erased (§393), from its fold: handed to the panel as `eraseAction`.
  eraseGroupRunDeclarationAction: ["eraseAction"],
  eraseGroupRunDeclarationsAction: ["batchEraseAction"],
  // «Păstrează: reclamație / litigiu în curs» (§556), from the shared hold form: a group run's and a registration's.
  groupRunDeclarationHoldAction: ["groupRunAction"],
  declarationHoldAction: ["registrationAction"],
  assignBibNumbersAction: ["assignAction"],
  // The desk's spares reserved by a print (§444): handed to the bib card's forms as `sparesAction`.
  reserveSpareBibsAction: ["sparesAction"],
  // A name deleted from the race's elite list (§895), from its line: handed to the bib card's forms as `eliteDeleteAction`, asked naming it.
  deleteEliteEntryAction: ["eliteDeleteAction"],
  sendEventThanksAction: [],
  sendParticipantMessageAction: [],
  // The newsletter (§445): the send asks per topic, naming how many receive it; removing an
  // address at someone's request asks too, and cannot be undone.
  sendNewsletterAction: [],
  withdrawNewsletterAddressAction: [],
  // «Dezabonează» on a row of the «Abonați» list (§550): asks, naming the address.
  unsubscribeSubscriberAction: [],
  // Asks only when the press faces outward: the notice ticked, the status set to cancelled.
  saveEventAndTranslationsAction: [],
  // Asks only for the publish submitter (`then=publish`); the plain create is a draft nobody sees.
  createEventAction: [],
  // The older pictures' phone sizes (§430): rewrites the address in every text a picture sits in.
  giveOlderPicturesLadderAction: [],
  // Registrations.
  confirmRegistrationNowAction: [],
  promoteRegistrationAction: [],
  // «Trimite-i oferta» (§615): an email to the runner, asked first on the queue's rows and the registration's page.
  offerPlaceAction: ["offerAction"],
  // «Dă-i un loc acum» (§637): a place and the declaration email, asked first on the registration's page.
  givePlaceNowAction: [],
  // «În afara locurilor» (§643): moves a place, and seats a waiting runner with an email — asked first, saying which.
  setOutsideCapacityAction: [],
  setBibNumberAction: [],
  // The desk's eye (§1017): the person's spoken wish to appear by name, or no longer — asked first on the row, naming the person and the email.
  recordListWishAtDeskAction: [],
  createRegistrationAction: [],
  // «Adaugă pe lista de așteptare» (§872): an entry that emails the person, asked first on the queue panel and the registrations list.
  addToWaitlistAction: ["waitlistAddAction"],
  // «Mută pe lista oficială» / «Oferă-i un loc acum» (§888): an entry that emails the person, asked first on each internal-list line, the relay tick in the dialog.
  moveReserveEntryAction: ["moveAction"],
  // «Transformă în voluntar» (§948): cancels the registration and emails the person twice — asked first on the registration's page, handed to the panel as `toVolunteerAction`.
  turnRunnerIntoVolunteerAction: ["toVolunteerAction"],
  // «Transformă în alergător» (§948): an entry that emails the person and cancels the volunteer — asked first on the volunteer's page, handed to the panel as `toRunnerAction`.
  turnVolunteerIntoRunnerAction: ["toRunnerAction"],
  // «Mută pe lista de elită» (§903): the line gone and its note with it, asked first on each internal-list line, naming the person; handed to the panel as `eliteMoveAction`.
  moveReserveEntryToEliteAction: ["eliteMoveAction"],
  // «Modifică datele» (§645): asks, naming the person and the fields the press changes.
  editRegistrationAnswersAction: [],
  // «Schimbă adresa»: asks first — the old links stop working, both addresses are told, the consent to offers withdrawn.
  changeRegistrationAddressAction: [],
  // «Nu e membru» / «E membru» from the list's ⋮ and the sweep «Scoate bifa la cele {n}» (§645): each names whom it changes.
  setClubMemberDeclaredAction: [],
  // «Înscrieri publice deschise» beside «Locuri» (§906): shuts or opens the site's door, asked first either way.
  setPublicRegistrationOpenAction: ["publicDoorAction"],
  clearMemberTicksAction: [],
  cancelRegistrationAction: [],
  cancelRegistrationFromRowAction: [],
  withdrawConsentAction: [],
  deleteRegistrationAction: [],
  bulkCancelRegistrationsAction: [],
  bulkDeleteRegistrationsAction: [],
  // «Șterge» on a row of «Liste date sponsorilor» (§948): the register hands it down as `removal.action`.
  deleteSponsorListRecordAction: ["removal.action"],
  resendRegistrationEmailAction: [],
  resendFamilyEmailAction: [],
  // «Retrimite declarația tuturor care nu au semnat» (§606): asks, counting who is emailed and who is skipped.
  resendDeclarationToAllAction: [],
  sendOutboxNowAction: [],
  sendOutboxNowFromEmailsAction: [],
  // «Reîncearcă emailurile eșuate» (§622): the week's failed emails back in the queue, after the count.
  retryFailedEmailsFromEmailsAction: [],
  // Volunteers (the design «telling the owner about every email a staff press sends», slice 3): the presses that email a
  // volunteer or a parent once each, asked first, naming the person, the address and the email. The role buttons and the
  // person's form say theirs in a line beside the button instead (`emailing-presses.test.ts`, `BESIDE`).
  requestVolunteerAgreementAction: [],
  requestVolunteerGuardianAction: [],
  sendVolunteerInvitationsAction: [],
  // Asks only for the reopening that emails — a cancelled person who holds roles and has an address; the other state
  // presses email nobody and post as before, a `ConfirmSubmitButton` drawn only for that case.
  setVolunteerStateAction: [],
  // «Șterge poza» under a picture of «Poze și hărți» on «Planul voluntarilor» (§952, §978): that picture taken off the plan,
  // asked first — only uploading it again brings it back.
  removePlanPictureAction: [],
  // «Șterge linkul» under a link of «Poze și hărți» (§978): that link taken off the plan, asked first, naming it.
  removePlanLinkAction: [],
  // «Trimite fiecăruia punctul lui» on «Planul voluntarilor» (§956): one email to every placed volunteer, asked first —
  // the question counts who is written to, who already knows their point, who has no address and who has no point.
  sendVolunteerPointsAction: [],
  // «Șterge punctul» on a point of the plan's own (§961): the point goes and its people stand at no point again — asked
  // first, with the point's name and how many people stand there.
  removePlanPointAction: [],
  // «Șterge» on a thing of «Lucruri de adus» (§979): the thing and its tick leave the list — asked first, naming the thing.
  removeRaceDayItemAction: [],
  // «Șterge înscrierea» on a row of «Ziua cursei» → «Tombolă» (§984): a person's raffle sign-up taken off — asked first, naming the person.
  raffleDeleteEntryAction: [],
  // «Scoate de la tombolă» / «Pune înapoi la tombolă» on the desk's raffle line (§1020, `checkin/raffle-actions.ts`): every desk role,
  // asked first naming the person and the number; handed to the line as `exclusionAction`.
  raffleDeskExclusionAction: ["props.exclusionAction"],
  // «Confirmă pentru tombolă» on a row of «Ziua cursei» → «Tombolă» and on a volunteer's page (§1028, `tombola/actions.ts`): the
  // organizers', asked first naming the person — a minor's parent's agreement ticked in the question; handed to the form as `confirmAction`.
  raffleConfirmVolunteerAction: ["props.confirmAction"],
  // Legal.
  approvePlatformTemplatesAction: [],
  // Every text at once (§532): drafts from the templates, and the drafts approved, each naming its texts.
  regenerateLegalTemplatesAction: [],
  approveLegalDraftsAction: [],
  approveLegalVersionAction: [],
  deleteLegalVersionAction: [],
  withdrawLegalVersionAction: [],
  // Gallery and pages.
  transitionAlbumAction: [],
  deletePhotoAction: [],
  deleteAlbumAction: [],
  deletePictureAction: [],
  transitionPageAction: [],
  // «Ordinea meniului» (§571): every visitor's menu and footer change from the next page view.
  saveMenuOrderAction: [],
  deletePageAction: [],
  // «Echipa» (§459): a card put on the site or taken off it, and a card deleted.
  setTeamMemberVisibleAction: [],
  deleteTeamMemberAction: [],
  setTeamPagePublishedAction: [],
  // «Casetele paginii» of «Echipa» (§691): on and off the site, and deleting, ask like a card's.
  setTeamBoxVisibleAction: [],
  deleteTeamBoxAction: [],
  // «Coduri de reducere» (§552): every write the members see — a code added, written, hidden or shown, deleted.
  createDiscountCodeAction: [],
  saveDiscountCodeAction: [],
  setDiscountCodeHiddenAction: [],
  deleteDiscountCodeAction: [],
  // The member levels (§811): a level deleted for good, and a member's level changed (what the member sees in the zone).
  deleteMemberTierAction: [],
  setMemberTierAction: [],
  // «Magazin» (§683): every write the members see — a product added, written, deleted or archived; the
  // payment words and the orders' address; an order marked paid (which emails the member), handed over or cancelled.
  createShopProductAction: [],
  saveShopProductAction: [],
  deleteShopProductAction: [],
  saveShopSettingsAction: [],
  moveShopOrderAction: [],
  // A picture taken off a product's strip (§697): members see the strip, so it asks; the add, the move and the recrop do not (below).
  removeShopPictureAction: [],
  // An order the club places in a member's name (§690): it takes stock and may email the member.
  placeOrderForMemberAction: [],
  // «Întrebări frecvente» (§525): the page's one save, which asks when a card is put on the site,
  // taken off or deleted (and nothing else), and the page's own publish switch.
  saveFaqPageAction: [],
  setFaqPagePublishedAction: [],
  // «Unelte» (§926): the page's own switch, and its tools' «Pe site» — each asks before a tool goes on or off the page.
  setToolsPagePublishedAction: [],
  saveShownToolsAction: [],
  // «Beneficiile membrilor» on the site or off it (§524).
  setMembersPagePublishedAction: [],
  // The team.
  inviteStaffAction: [],
  // «Adaugă mai mulți membri» (§524): several accounts and invitations in one press.
  inviteMembersAction: [],
  changeStaffRoleAction: [],
  // «Gestionează magazinul» ticked or unticked on a colleague's row (§687).
  setStaffPermissionAction: [],
  resendStaffInviteAction: [],
  sendStaffPasswordResetAction: [],
  setStaffAccountActiveAction: [],
  revokeStaffAction: [],
  // Settings that face outward.
  updateEmailPlanAction: [],
  // Mailgun or the club's Gmail, per group (§443): every email from now on takes the new road.
  updateEmailTransportAction: [],
  updateContactRecipientsAction: [],
  // What the site shows and every email's Reply-To (§442).
  updateShownContactAddressAction: [],
  // «Telefon public» (§565): the number every page's footer shows from the next page view.
  updatePublicPhoneAction: [],
  updateClubIdentityAction: [],
  // «Spune-ne ceva» (§676): which anonymous forms the contact page offers, and who receives each.
  updateFeedbackFormsAction: [],
  // The public pages' background tint (§488): every visitor sees the new colour from the next page view.
  updateSiteTintAction: [],
  // The public pages' text size (§530): every visitor reads at the new size from the next page view.
  updateSiteFontSizeAction: [],
  // «Tema v2» (§708): every visitor sees the chosen look from the next page view.
  updateSiteLookAction: [],
  // «Pagina principală» (§714): the site's address opens the home page or the listing, for every visitor, from the next visit.
  updateHomePageAction: [],
  removeStripPictureAction: [],
  // Who receives the signed declarations and the confirmations, with personal data in them.
  updateClubNoticesAction: [],
  // «Răspunsurile din calendar merg la» (§672): every invitation from now on asks, and the answers go there.
  updateCalendarRsvpAction: [],
  // «Cui îi trimitem întrebarea „Vii?»» (§823): from the save on, the addresses of a new audience are used — the people who answered «Vin!» before.
  updateRsvpAskAudienceAction: [],
  // Asks for "Revino la textul implicit" (`reset=1`) only; saving the wording is an editorial save.
  updateEmailCopyAction: [],
  updateNeonPlanAction: [],
  // The Vercel plan and its seats (§610): every cost on «Costuri» is priced from it.
  updateVercelPlanAction: [],
  updateBotCheckAction: [],
  updateJobCadenceAction: [],
  // The month's budget thresholds (§447): how early the platform throttles itself.
  updateBudgetThresholdsAction: [],
  updateNeonLimitsAction: [],
  // "Termene" (§377): every hold, offer and link given from now on takes the new numbers.
  updateDeadlinesAction: [],
  // "Maxim de înscrieri pe o adresă" (§389): a limit every public submission meets from now on.
  updateAddressCapAction: [],
  // «Când pleacă emailurile» (§513): every message the platform sends from now on leaves by it.
  updateDeliveryTimingAction: [],
  // The same setting as the queue panel's switch (§529): off, the queue leaves now.
  updateDeliveryTimingFromEmailsAction: [],
  // A line of the club's checklist deleted (§438): gone for the whole team, with no undo.
  deleteClubTodoAction: [],
  // «Tradu din română»'s daily character budget (§464): what the club may spend from now on.
  updateTranslationBudgetAction: [],
  // A race's results (§808): a result deleted is gone from the ranking, and the Administrator's tick makes the ranking public or takes it off the site.
  deleteEventResultAction: [],
  setResultsPublishedAction: [],
  // «Toate numele în clasament» (§NNN): names on the site every runner who did not agree — asked both ways.
  setResultsAllNamesAction: [],
  // «Resetează clasamentul» (§997): every result of the race and the gun given, wiped before the start — nothing to undo it with.
  resetEventResultsAction: [],
  // «Folosește» under a line's «Timpi la sosire» (§1012): a recorded time made the runner's, every place ranked again — asked first, as «Șterge».
  chooseRecordedTimeAction: [],
};

/**
 * The backoffice's Server Actions that ask nothing, each with why. A toast still says each one
 * worked; the server asserts every rule as before (BR-REQ-060-01).
 */
export const NOT_CONFIRMED: Readonly<Record<string, string>> = {
  // «Adaugă pe lista de elită» (§895), as the internal list's «Adaugă» (§854): a name written down to print on a bib.
  addEliteEntryAction: "writes one name onto the race's elite list, undone by its «Șterge» (which asks); it registers nobody, sends nothing and changes no count",
  previewEventDraftAction: "writes nothing and tells nobody: it draws the unsaved event's card and page (§579)",
  saveEventResultsAction: "an editorial save of a race's results, undone by saving the old times again; it tells nobody, and on a ranking already public it edits the page like a save of a published page — making it public and a row's delete ask",
  // «Categorii de vârstă» (§850): a setting of the race's results, undone by typing the old ages again; it tells nobody and re-ranks what the next save would re-rank anyway.
  setResultAgeBandsAction: "an editorial save of the race's age groups, undone by saving the old ages (or an empty box) again; it tells nobody, deletes nothing and only ranks the saved results again",
  // «Premii» (§850): a setting of the card alone, undone by saving the old values again; nothing of the results moves.
  setResultAwardsAction: "an editorial save of how many places the podium lists and whether the categories are listed, undone by saving the old values again; it tells nobody and moves no result",
  // «Cronometrare» (§986, in «Sosire»'s place, §850): a finish line cannot ask before every runner — many arrive at once; the stamped time is one line of the results, the volunteer's own «Anulează» for ten minutes, then corrected or deleted on «Clasament».
  recordFinishPressAction:
    "one finisher's time stamped at the line, the same editorial save as a line of «Salvează tot clasamentul» — undone by the press's own «Anulează» or on «Clasament»; it tells nobody and deletes nothing, a second press of the number only writes the trail",
  recordFinishFormAction: "the same press with scripts off: one finisher's time stamped at the line, undone by «Anulează» or on «Clasament»; it tells nobody and deletes nothing",
  undoFinishPressAction:
    "takes back the volunteer's own press of the last ten minutes, nobody having changed it — the press undone, the runner recorded again by pressing again; it tells nobody and touches nobody else's line",
  undoFinishFormAction: "the same undo with scripts off: the volunteer's own unchanged press of the last ten minutes; pressing the number again records the runner again",
  setRaceGunAction:
    "«Start» pressed at the gun — its moment is the tap, so it cannot wait on a question — moved by another press, and taken off only after one («Anulează startul», a ConfirmSubmitButton); fixed after the first finisher; it tells nobody and changes nothing public",
  // The server's clock «Cronometrare»'s island asks as the page wakes (§986): a read, no press.
  readFinishClockAction: "reads the server's clock for the page's stamps and writes nothing; nobody presses it, the page asks it as it wakes",
  // «Dă-i un număr» on «Cronometrare», in a numberless elite line's grey button's place (§990): the line's number, nothing printed.
  giveEliteNumberFormAction:
    "gives one elite line without a number the race's next free number, nobody else's, so its button is timed like the others; it tells nobody and prints nothing — the bib carries the label alone — and the line's «Număr» box on the elite card changes it",
  // «Ecusoane pentru voluntari» (§764): the club's own look of a printed strip, seen in the preview before the save.
  saveBadgeDesignAction: "an editorial save of the badges' look, undone by saving the old one; it tells nobody and prints nothing",
  saveBadgeRoleColoursAction: "an editorial save of the roles' band colours, undone by choosing again; it tells nobody",
  // An event as a JSON file (§751): the import page is its own step-by-step confirmation, in a client island that calls these.
  previewEventImportAction: "writes nothing: it reads the file and lists what it holds and the events it could go over",
  diffEventImportAction: "writes nothing and copies nothing: it shows every field that would change, the question the next press answers",
  importEventAsNewAction: "creates a draft nobody sees until its own publish, which asks; the page asks for the file and the choice first",
  importEventOverAction: "asks on its own page — the diff, a ticked confirmation, and on production the event's title typed with its registrations counted — which a dialog would only repeat",
  checkInAction: "emails nobody and is undone from the same row; a dialog per runner would double the desk's taps on race morning",
  createAlbumAction: "an editorial save: a draft album nobody sees until its own publish, which asks",
  saveAlbumAction: "an editorial save, like a page's; publishing and deleting ask",
  setCoverAction: "picks the album's cover, undone by picking another",
  createPageAction: "an editorial save: a draft page nobody sees until its own publish, which asks",
  savePageAction: "an editorial save, like the event's without a notice; publishing and deleting ask",
  createTeamMemberAction: "adds a hidden card nobody sees until an Administrator shows it, which asks",
  saveTeamMemberAction: "an editorial save of a card's words and photo, like a page's; showing and deleting ask",
  moveTeamMemberAction: "reorders the team's cards, undone by moving back",
  // «Casetele paginii» of «Echipa» (§691), the cards' own rules.
  createTeamBoxAction: "adds a hidden box nobody sees until an Administrator shows it, which asks",
  saveTeamBoxAction: "an editorial save of a box's title and text, like a card's; showing and deleting ask",
  moveTeamBoxAction: "reorders the page's boxes, undone by moving back",
  moveDiscountCodeAction: "reorders the members' discount codes (§552), undone by moving back",
  moveShopProductAction: "reorders the members' shop (§683), undone by moving back",
  // The product's pictures (§697): each its own small form on the product's page.
  addShopPictureAction: "adds a picture at the end of the product's strip, undone by «Scoate fotografia», which asks",
  moveShopPictureAction: "reorders a product's pictures, undone by moving back",
  addStripPictureAction: "adds a picture at the end of the home page's photo strip, undone by «Scoate», which asks",
  moveStripPictureAction: "reorders the home page's photo strip, undone by moving back",
  replaceShopPictureAction: "a new crop or another stored picture in the same place of the strip, undone by saving the previous one again",
  saveTeamPageIntroAction: "an editorial save of the page's introduction; publishing the page asks",
  saveMemberDefinitionAction: "an editorial save of one sentence (§789), like the members' pages' words beside it; nothing is sent or published by it",
  saveMembersTextAction: "an editorial save of the members' pages' words (§524), like a page's; publishing the page asks",
  saveMemberTiersAction: "an editorial save of every row of the levels' card at once (§811), like the volunteers' «Salvează toate rolurile» (§791); the delete beside it asks, and a level is a label that opens nothing",
  createLegalVersionAction: "a draft, never in force until approved, which asks",
  updateLegalVersionAction: "a draft, never in force until approved, which asks",
  markBibsPrintedAction: "a mark for the club's own pile of bibs, undone by the same button",
  setBibPrintedAction: "a mark for the club's own pile of bibs, undone by the same button",
  // «Marchează ca elită» / «Nu mai e elită» (§897): how one registration's bib prints, nothing else of it.
  setRegistrationEliteAction:
    "a mark on how one registration's bib prints, undone from the same menu; it tells nobody and changes no state, place, number or count",
  // «Marchează ca ambasador» / «Nu mai e ambasador» (§948): the club's own label on one registration, nothing else of it.
  setRegistrationAmbassadorAction:
    "the club's own label on one registration, undone from the same menu and from the «Ambasadori» panel; it tells nobody and changes no state, place, number, count or bib",
  // «Salvează nota» from a row of the list («Note interne» first on the registration's page, and a note from a row of the list).
  addRegistrationNoteFromListAction:
    "writes one internal note the organizers read, the words typed and sent by the dialog's own «Salvează nota»; it tells the person nothing, changes no state, place or count, and «Șterge» on the card asks",
  // «Apare în clasament» / «Apare pe site» (§910): an elite's two ticks, the TickButton pattern — each undone by the same tick.
  setEliteEntryTickAction:
    "one of an elite line's two ticks, undone by the same tick; it tells nobody and moves no place — putting a name on the site asks first, naming the person, since only their agreement allows it",
  setRegisteredEliteTickAction:
    "one of a marked registration's two ticks from the elite card, undone by the same tick; it tells nobody and only ever hides — ticked, the person's own ticks decide",
  setRegistrationEliteTickAction:
    "one of a marked registration's two ticks from the list's «⋮» or its page, undone by the same tick; it tells nobody and only ever hides — ticked, the person's own ticks decide",
  // «Eticheta pe BIB» (§975): what an elite bib prints where the number goes, typed in a box beside its «Salvează».
  setEliteBibLabelAction:
    "the label one elite line's bib prints, saved from its own box on the elite card; it tells nobody, moves no state, place or count, and the same box undoes it",
  setRegistrationEliteBibLabelAction:
    "the label a marked registration's bib prints, saved from the desk's «Elită și BIB»; it tells nobody, moves no state, place or count, and the same box undoes it",
  // «Număr» and «Dă număr elitelor fără număr (N)» on the elite card (§990): an elite line's number at the finish line, never printed.
  setEliteNumberAction:
    "the number one elite line holds at the finish line, typed in its own box on the elite card; it tells nobody, prints nothing — the bib carries the label alone — and the same box changes it again, refused once a result is stored on it",
  giveEliteNumbersAction:
    "gives the elite lines without a number the race's next free numbers, nobody else's; it tells nobody and prints nothing, and each line's «Număr» box changes its number",
  // «Are kit» on a row of the «Voluntari» list (§904): the organizers' own mark of who gets the volunteers' kit, a one-press tick.
  setVolunteerKitAction:
    "a mark on the club's packing for one volunteer, undone by the same tick; it tells nobody and changes no state, role or count but «Cu kit»",
  // The same tick on a row of the «Voluntari» list (§949).
  setVolunteerRaffleAction:
    "a mark on the club's own raffle list for one volunteer, undone by the same tick; it tells nobody and changes no state, role, number or count",
  // «Prezent» on a row of the «Voluntari» list and on the person's page (§983): the organizers' mark that a volunteer came on the day.
  setVolunteerPresentAction:
    "a mark of who came on the day for one volunteer, undone by the same tick; it tells nobody and changes no state, role, number or count but «Prezenți» and «Absenți»",
  // «Decizie pentru ziua cursei» on a row of the «Voluntari» list and on the person's page (§954): the organizers' one line about a volunteer on race day.
  setVolunteerDecisionAction:
    "one line of the organizers' own about one volunteer, replaced by writing another or cleared by saving the box empty; it emails nobody and moves no state, role, point, number or tick",
  // «Modifică nota» on a row of the «Voluntari» list (§964): the row's newest internal note, its new words typed in the row's dialog.
  editVolunteerNoteFromListAction:
    "changes the words of one of the organizers' own notes about a volunteer, undone by writing the old words again; it emails nobody, keeps no earlier words, and moves no state, role, point, number or tick — «Șterge», which takes the note, asks",
  // «Modifică» beside «Șterge» on the volunteer's page (§964), in the card's own `note-actions.ts`: the same change from the note's fold.
  editVolunteerNoteAction:
    "the same change of one organizers' note from its fold on the volunteer's page, undone by writing the old words again; it emails nobody and moves nothing else of the person",
  // «Participă la tombolă» on a row of the registrations list (§949): on the raffle's list or off it, a one-press tick.
  setRegistrationRaffleAction:
    "a mark on the club's own raffle list for one registration, undone by the same tick; it tells nobody and changes no state, place, number or count",
  // «Pune aici» / «Scoate» on «Planul voluntarilor» (§949), and «Pune» on a person's line of «Fără punct» (§978): where a
  // volunteer stands on the route, one press either way.
  placeVolunteerAction:
    "a line of the organizers' own plan for one volunteer, undone by «Scoate» or by another point; it tells nobody and changes no state, role, number or count",
  // «Cel mult câte roluri poate bifa o persoană» on the event's «Voluntari» card (§951): the public form's limit on the roles ticked, a box with its own «Salvează».
  setVolunteerChoicesMaxAction:
    "a setting of the event's public volunteers' form, undone by saving the old number or an empty box; it tells nobody, deletes nothing and changes nobody already listed — as the card's ticks beside it, which ask nothing either",
  // «Adaugă o poză» in «Poze și hărți» on «Planul voluntarilor» (§952, §978): sent by the upload's island once the chosen file is stored.
  addPlanPictureAction:
    "adds the picture just chosen and uploaded, last, to the organizers' own plan, undone by «Șterge poza» under it, which asks; it tells nobody, is on no public page and changes no other picture, point or person",
  // «Adaugă linkul» in «Poze și hărți» (§978): an address — a Google My Maps map — and its label go last among the plan's links.
  addPlanLinkAction:
    "adds a link, last, to the organizers' own plan, undone by «Șterge linkul» beside it, which asks; it tells nobody, is on no public page and changes no picture, point or person",
  // «Adaugă punctul» in «Punctele planului» on «Planul voluntarilor» (§961): a point of the plan's own, on the route or at the start–finish.
  addPlanPointAction:
    "adds a point — and its note for the volunteers, when given (§1011) — to the organizers' own plan, undone by «Șterge punctul», which asks; it tells nobody, is on no public page, and no person stands anywhere they did not",
  // «Salvează punctul» in a point's «Modifică punctul» (§961): a plan's own point changed, or the coordinates of one of the event's points.
  editPlanPointAction:
    "the organizers' own words for a place of their plan — its name, its kilometre, its kind, where it is, its note for the volunteers — replaced by saving them again; it tells nobody (a changed note waits for the next «Trimite fiecăruia punctul lui», which asks, §1011), is on no public page, and everybody stays at the point they stand at",
  // «Lucruri de adus» on «Ziua cursei» (§979): the organizers' own checklist of things to bring to the race.
  setRaceDayItemBroughtAction:
    "a tick on the organizers' own checklist, posting the state it wants and undone by the same tick; it tells nobody, is on no public page and changes no person",
  addRaceDayItemAction:
    "adds a thing to the organizers' own checklist, undone by «Șterge», which asks; it tells nobody and is on no public page",
  editRaceDayItemAction:
    "the organizers' own words for a thing to bring, replaced by saving them again; it tells nobody, is on no public page and keeps its tick",
  // «Înscrie la tombolă» on «Ziua cursei» → «Tombolă» and on a volunteer's page (§984): the organizers record a person's sign-up.
  raffleSignUpAction:
    "records one person's raffle sign-up, the acceptance of the rules ticked by its own box, undone by «Șterge înscrierea», which asks; it emails nobody, is on no public page and changes no state, place, number or count but the raffle's",
  // The same at the race-day desk, on the desk's view of a person (§984) — and, for a desk role that is not an organizer, on «Tombolă» (§1014).
  raffleDeskSignUpAction:
    "records one person's raffle sign-up at the desk, the acceptance of the rules ticked by its own box, undone on «Tombolă» by «Șterge înscrierea», which asks; it emails nobody and changes no state, place, number or count but the raffle's",
  // «Scoate» / «Pune înapoi» on a row of «Tombolă» (§984): the organizers' exclusion, through each kind's own tick.
  raffleExclusionAction:
    "the organizers' own mark of who is in the raffle for one person, posting the state it wants and undone by the same press; it tells nobody and changes no state, place, number or count but the raffle's",
  // «Prezent» on a line of the elite list, on «Tombolă» (§984): the organizers' mark that the line's person came.
  raffleElitePresentAction:
    "a mark of who came on the day for one line of the elite list, undone by the same tick; it tells nobody and changes nothing but the raffle's «Doar prezenții»",
  addTestRegistrationsAction: "test rows, counted nowhere and absent from production, removed by a verb that asks",
  hardDeleteEventAction: "guarded by the event's title, typed: the typing is the question",
  eraseRegistrationFromListAction: "guarded by the registered name, typed: the typing is the question",
  deleteApprovedLegalVersionAction: "guarded by a typed phrase: the typing is the question",
  deleteReliedOnLegalVersionAction:
    "two steps on its own screen: the consequences and a reason, then the version's number typed by hand — the typing is the question (§567)",
  deleteLegalVersionsAction:
    "guarded by a typed phrase (DELETE <n>) when an approved version is ticked, the typing is the question; drafts alone ask in the §384 dialog (§532)",
  previewParticipantMessageAction: "a preview; sends nothing",
  previewNewsletterAction: "the newsletter composer's preview (§445); sends nothing, stores nothing",
  lookUpPersonAction: "reads; changes nothing",
  signInAsDevIdentityAction: "the development sign-in: a session, not data",
  signOutAction: "a session, not data",
  // «Accept și intru» on /admin/acord (§1006): the colleague's own acceptance of the team's undertaking, not a verb on anybody else.
  acceptTeamAgreementAction:
    "the colleague's own acceptance of the team's undertaking, the question being the page itself — the text, the full name typed and «Am citit și accept angajamentul» ticked; it emails nobody, changes nobody else and only opens the backoffice to this account, and a second press stores nothing",
  probeSaveAction: "the network check's probe (§436): answers ok, changes nothing",
  addClubTodoAction: "a line on the club's own checklist (§438): emails nobody, removed by a delete that asks",
  editClubTodoAction: "an editorial save of a checklist line, like a page's; its delete asks",
  setClubTodoDoneAction: "a tick on the club's checklist, undone by the same box — a dialog per tick would double the taps",
  moveClubTodoAction: "reorders the checklist, undone by moving back",
  translateFieldAction:
    "fills English boxes in the browser and saves nothing; replacing a box that already has words asks in the button itself (§464)",
};

type Site = { file: string; line: number; expression: string; verdict: "asks" | "bare"; why: string };

function tagName(name: ts.JsxTagNameExpression): string {
  return name.getText();
}

function hasAttribute(element: ts.JsxOpeningLikeElement, name: string): boolean {
  return element.attributes.properties.some((property) => ts.isJsxAttribute(property) && property.name.getText() === name);
}

function attributeText(element: ts.JsxOpeningLikeElement, name: string): string | null {
  const found = element.attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.getText() === name);
  if (!found || !ts.isJsxAttribute(found) || !found.initializer) return null;
  return ts.isJsxExpression(found.initializer) && found.initializer.expression ? found.initializer.expression.getText() : found.initializer.getText();
}

/** Whether a `ConfirmSubmitButton` is drawn anywhere inside this element. */
function holdsConfirmButton(node: ts.Node): boolean {
  let found = false;
  const walk = (child: ts.Node) => {
    if (found) return;
    if ((ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) && tagName(child.tagName) === "ConfirmSubmitButton") found = true;
    else ts.forEachChild(child, walk);
  };
  ts.forEachChild(node, walk);
  return found;
}

function judge(element: ts.JsxOpeningLikeElement, attribute: string): { verdict: Site["verdict"]; why: string } {
  const tag = tagName(element.tagName);
  if (attribute === "formAction") {
    return tag === "ConfirmSubmitButton" ? { verdict: "asks", why: "ConfirmSubmitButton" } : { verdict: "bare", why: `formAction on <${tag}>` };
  }
  if (tag === "ActionForm") {
    return hasAttribute(element, "confirm") ? { verdict: "asks", why: "ActionForm confirm" } : { verdict: "bare", why: "ActionForm without confirm" };
  }
  const isForm = tag === "form" || (tag === "Box" && attributeText(element, "component") === '"form"');
  if (isForm) {
    const parent = element.parent;
    return ts.isJsxElement(parent) && holdsConfirmButton(parent)
      ? { verdict: "asks", why: "form with ConfirmSubmitButton" }
      : { verdict: "bare", why: `<${tag}> with no ConfirmSubmitButton` };
  }
  return { verdict: "bare", why: `posted from <${tag}>` };
}

const SITES = new Map<string, Site[]>();
for (const name of Object.keys(CONFIRMED_ACTIONS)) SITES.set(name, []);
const byExpression = new Map<string, string>();
for (const [name, aliases] of Object.entries(CONFIRMED_ACTIONS)) {
  byExpression.set(name, name);
  for (const alias of aliases) byExpression.set(alias, name);
}

/** The backoffice: its routes and the modules that draw them. The public site keeps its own verbs. */
const isBackoffice = (relative: string) => relative.startsWith("src/app/[locale]/admin/") || relative.startsWith("src/modules/");

for (const file of sourceFiles(path.join(ROOT, "src"))) {
  const relative = path.relative(ROOT, file).split(path.sep).join("/");
  if (!isBackoffice(relative)) continue;
  const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const walk = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
      const attribute = node.name.getText();
      if (attribute === "action" || attribute === "formAction") {
        const expression = node.initializer.expression.getText();
        const action = byExpression.get(expression);
        const element = node.parent.parent;
        if (action && (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element))) {
          const { verdict, why } = judge(element, attribute);
          SITES.get(action)?.push({ file: relative, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, expression, verdict, why });
        }
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(source);
}

describe("§384 every irreversible or outward-facing staff action asks first", () => {
  it("is posted somewhere — a verb that moved to a bare form fails here, not on a phone", () => {
    const unseen = [...SITES].filter(([, sites]) => sites.length === 0).map(([name]) => name);
    expect(unseen, "actions never found behind action={…} or formAction={…}").toEqual([]);
  });

  it("asks at every site: an ActionForm with confirm, or a ConfirmSubmitButton where one form carries several verbs", () => {
    const bare = [...SITES].flatMap(([name, sites]) => sites.filter((site) => site.verdict === "bare").map((site) => `${name} at ${site.file}:${site.line} (${site.expression}) — ${site.why}`));
    expect(bare, "posted without a question").toEqual([]);
  });

  it("classifies every Server Action of the backoffice: it asks, or it is listed with why it does not", () => {
    const exported = actionFiles(path.join(ROOT, "src/app/[locale]/admin")).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/export async function (\w+Action)\b/g)].map((match) => match[1]),
    );
    expect(exported.length).toBeGreaterThan(60);
    const unclassified = exported.filter((name) => !(name in CONFIRMED_ACTIONS) && !(name in NOT_CONFIRMED));
    expect(unclassified, "a new action: add it to CONFIRMED_ACTIONS, or to NOT_CONFIRMED with its reason").toEqual([]);
    const both = Object.keys(NOT_CONFIRMED).filter((name) => name in CONFIRMED_ACTIONS);
    expect(both).toEqual([]);
    // A verb of a card's own file (`<card>-actions.ts`) may be listed too: it is stale once that file stops exporting it.
    const besideAPage = cardActionFiles(path.join(ROOT, "src/app/[locale]/admin")).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/export async function (\w+Action)\b/g)].map((match) => match[1]),
    );
    const stale =Object.keys(NOT_CONFIRMED).filter((name) => !exported.includes(name) && !besideAPage.includes(name));
    expect(stale, "listed in NOT_CONFIRMED but no longer exported").toEqual([]);
  });

  it("holds the «Voluntari» card's limit on the roles ticked (§951) to its classification: listed with its reason, and posted from a bare form of its own", () => {
    expect(NOT_CONFIRMED.setVolunteerChoicesMaxAction).toMatch(/undone by saving the old number or an empty box/);
    expect("setVolunteerChoicesMaxAction" in CONFIRMED_ACTIONS).toBe(false);
    const card = readFileSync(path.join(ROOT, "src/modules/volunteers/ui/VolunteersCard.tsx"), "utf8");
    expect(card.match(/action=\{setVolunteerChoicesMaxAction\}/g) ?? []).toHaveLength(1);
    expect(card).toMatch(/<Box component="form" action=\{setVolunteerChoicesMaxAction\}/);
  });

  it("never asks twice: a ConfirmSubmitButton sits in no ActionForm that has its own confirm", () => {
    const doubled: string[] = [];
    for (const file of sourceFiles(path.join(ROOT, "src"))) {
      const relative = path.relative(ROOT, file).split(path.sep).join("/");
      const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
      const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const walk = (node: ts.Node, inConfirmedForm: boolean) => {
        let inside = inConfirmedForm;
        if (ts.isJsxElement(node) && tagName(node.openingElement.tagName) === "ActionForm" && hasAttribute(node.openingElement, "confirm")) inside = true;
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && tagName(node.tagName) === "ConfirmSubmitButton" && inside) {
          doubled.push(`${relative}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        }
        ts.forEachChild(node, (child) => walk(child, inside));
      };
      walk(source, false);
    }
    expect(doubled).toEqual([]);
  });
});
