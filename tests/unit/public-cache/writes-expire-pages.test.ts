import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import type { PublicContent } from "@/modules/public-cache/cache";

/**
 * §549 (amending §333) — every backoffice write behind a public page expires it through
 * `revalidatePublicContent`.
 *
 * Since the public pages are static (ISR), a write that forgets the call no longer leaves only a
 * stale data row for a day: it leaves the page itself on Vercel's CDN, as it was, for up to a day.
 * Nothing but this call expires it — the pages are filed under the rows' `public:<kind>` tags —
 * so this pins, per write verb, the kind it expires, and fails on a write nobody classified.
 *
 * Source-level, like `static-public-routes.test.ts`: the TypeScript parser reads every exported
 * function of the modules below, follows the calls it makes into its own file and into the other
 * modules' exports, and records whether the function writes (a `.insert(`, `.update(`, `.delete(`
 * or `.execute(` anywhere it reaches, a hash's `.update(` aside) and which kinds it expires.
 * Comments are not code to the parser, so a sentence that names the call is not the call.
 *
 * **The `places` kind** (the free places, the public start list) is expired by the registrations and
 * the jobs, not by the backoffice's content verbs, so it is pinned the other way round (§553, the
 * review of §549): every verb of `src/modules/registrations`, `src/modules/jobs` and the deadline
 * rebase that moves a place or changes the list is named in `PLACES_WRITES` and must reach
 * `revalidatePublicContent("places")`. Those modules are not held to "classify every write" as the
 * content modules are: they also write tokens, outbox rows, audit rows, rate-limit buckets and
 * holds that no public page reads — hundreds of verbs a table of "nothing public" would only pad —
 * and every change of a registration's state goes through the one statement that expires the kind
 * (`repository.ts#transitionRegistration`), which is pinned first.
 */
const ROOT = path.resolve(__dirname, "../../..");

/** Every non-UI module under these directories is walked: a write added here must be classified below. */
const WALKED_DIRECTORIES = [
  "src/modules/content",
  "src/modules/legal-documents",
  "src/modules/contact",
  "src/modules/appearance",
  "src/modules/deadlines",
] as const;

/** The server actions whose verbs are not services of their own: the events list's bulk bar. */
const ACTIONS_FILE = "src/app/[locale]/admin/actions.ts";

type Expected = readonly PublicContent[] | { readonly nothingPublic: string };

const DRAFT = { nothingPublic: "creates a draft, which is on no public page until a publish (which expires)" } as const;

const MEMBERS_ZONE_ONLY = { nothingPublic: "a discount code is read only in the members' zone, per request behind the account; no public page or public read carries one" } as const;

/**
 * Every exported write, `file#name` → the kinds it must expire, or why it changes nothing a public
 * page reads. The kinds a page reads: `events` (the listing, the calendar, an event page, the
 * feeds, the pictures), `pages` (a standing page, the navigation, «Echipa», the FAQ, «Membri»),
 * `gallery`, `legal` (the terms, the privacy notice), `settings` (the tint, the text size, the
 * contact recipients and address, «Termene»).
 */
const WRITES: Record<string, Expected> = {
  // The events: the editor's save (the programme's rows, the difficulty and every other field),
  // the translations, every state change, the series, the deletes.
  "src/modules/content/events/service.ts#saveEventTranslation": ["events"],
  "src/modules/content/events/service.ts#transitionEvent": ["events"],
  "src/modules/content/events/service.ts#publishEvent": ["events"],
  "src/modules/content/events/service.ts#saveEventFields": ["events"],
  "src/modules/content/events/service.ts#saveEventAndTranslations": ["events"],
  // A draft, but a featured one takes the lead from the event that had it (§28).
  "src/modules/content/events/service.ts#createEvent": ["events"],
  "src/modules/content/events/service.ts#createEventAndPublish": ["events"],
  "src/modules/content/events/service.ts#duplicateEvent": { nothingPublic: "a fresh draft: publication and the featured flag are never copied" },
  "src/modules/content/events/service.ts#repeatEvent": ["events"],
  "src/modules/content/events/service.ts#materializeStandingRepeats": ["events"],
  "src/modules/content/events/service.ts#stopRepeat": ["events"],
  "src/modules/content/events/service.ts#setRepeatPublish": {
    nothingPublic: "stores the series' switch only; the dates it publishes are made by materializeSeries, which expires",
  },
  "src/modules/content/events/service.ts#deleteEvent": ["events"],
  "src/modules/content/events/service.ts#hardDeleteEvent": ["events"],

  // Standing pages, «Echipa», the FAQ, «Membri».
  "src/modules/content/pages/service.ts#createPage": DRAFT,
  "src/modules/content/pages/service.ts#savePage": ["pages"],
  "src/modules/content/pages/service.ts#transitionPage": ["pages"],
  "src/modules/content/pages/service.ts#deletePage": ["pages"],
  // «Ordinea meniului» (§571): the header and the footer on every public page read it from `settings`.
  "src/modules/content/menu/menu-order.ts#saveMenuOrder": ["settings"],
  "src/modules/content/team/service.ts#createTeamMember": ["pages"],
  "src/modules/content/team/service.ts#saveTeamMember": ["pages"],
  "src/modules/content/team/service.ts#setTeamMemberVisible": ["pages"],
  "src/modules/content/team/service.ts#moveTeamMember": ["pages"],
  "src/modules/content/team/service.ts#deleteTeamMember": ["pages"],
  "src/modules/content/team/page-settings.ts#saveTeamPageIntro": ["pages"],
  "src/modules/content/team/page-settings.ts#setTeamPagePublished": ["pages"],
  "src/modules/content/faq/service.ts#saveFaqPage": ["pages"],
  "src/modules/content/faq/page-settings.ts#setFaqPagePublished": ["pages"],
  "src/modules/content/members/page-settings.ts#saveMembersText": ["pages"],
  "src/modules/content/members/page-settings.ts#setMembersPagePublished": ["pages"],
  // The members' discount codes (§552): read only in the members' zone, behind the account and per request
  // (§524, §549's per-request list), never through the public cache — so no public page shows one.
  "src/modules/content/member-codes/service.ts#createDiscountCode": MEMBERS_ZONE_ONLY,
  "src/modules/content/member-codes/service.ts#saveDiscountCode": MEMBERS_ZONE_ONLY,
  "src/modules/content/member-codes/service.ts#setDiscountCodeHidden": MEMBERS_ZONE_ONLY,
  "src/modules/content/member-codes/service.ts#moveDiscountCode": MEMBERS_ZONE_ONLY,
  "src/modules/content/member-codes/service.ts#deleteDiscountCode": MEMBERS_ZONE_ONLY,

  // The gallery.
  "src/modules/content/gallery/service.ts#createAlbum": DRAFT,
  "src/modules/content/gallery/service.ts#saveAlbum": ["gallery"],
  "src/modules/content/gallery/service.ts#transitionAlbum": ["gallery"],
  "src/modules/content/gallery/service.ts#addPhoto": ["gallery"],
  "src/modules/content/gallery/service.ts#addStoredPhoto": ["gallery"],
  "src/modules/content/gallery/service.ts#deletePhoto": ["gallery"],
  // «Înlocuiește» (§NNN): the photo's new picture, through the media verb, expired as a delete is.
  "src/modules/content/gallery/service.ts#replacePhoto": ["gallery"],
  "src/modules/content/gallery/service.ts#setCover": ["gallery"],
  "src/modules/content/gallery/service.ts#deleteAlbum": ["gallery"],

  // The legal texts: a draft is on no public page; everything that changes what is in force expires.
  "src/modules/legal-documents/service.ts#createDraftVersion": DRAFT,
  "src/modules/legal-documents/service.ts#updateDraftVersion": DRAFT,
  "src/modules/legal-documents/service.ts#deleteDraftVersion": DRAFT,
  "src/modules/legal-documents/service.ts#regenerateFromTemplates": DRAFT,
  "src/modules/legal-documents/service.ts#approveVersion": ["legal"],
  "src/modules/legal-documents/service.ts#withdrawApprovedVersion": ["legal"],
  "src/modules/legal-documents/service.ts#deleteApprovedVersion": ["legal"],
  "src/modules/legal-documents/service.ts#deleteReliedOnVersion": ["legal"],
  "src/modules/legal-documents/service.ts#approvePlatformTemplates": ["legal"],
  "src/modules/legal-documents/service.ts#approveDrafts": ["legal"],
  "src/modules/legal-documents/service.ts#deleteVersionsInBatch": ["legal"],
  "src/modules/legal-documents/repository.ts#insertLegalDocumentVersion": {
    nothingPublic: "the repository's insert of a draft; the service verbs that approve it expire",
  },
  "src/modules/legal-documents/repository.ts#retireVersionNumber": {
    nothingPublic: "the repository's bookkeeping of a deleted version's number; the delete verbs expire",
  },
  // The Administrators' notice of a moved template (§639): its own settings row and the outbox, read by no page.
  "src/modules/legal-documents/templates-notice.ts#announceLegalTemplateChanges": {
    nothingPublic: "remembers when the job checked the templates and queues staff emails; no public page reads either",
  },

  // The settings a public page reads.
  "src/modules/contact/recipients.ts#updateContactRecipients": ["settings"],
  "src/modules/contact/shown-address.ts#updateShownContactAddress": ["settings"],
  // «Telefon public» (§565): the footer's «Contact» on every page.
  "src/modules/contact/public-phone.ts#updatePublicPhone": ["settings"],
  "src/modules/appearance/site-tint.ts#updateSiteTint": ["settings"],
  "src/modules/appearance/site-font-size.ts#updateSiteFontSize": ["settings"],
  "src/modules/deadlines/deadlines.ts#updateDeadlines": ["settings"],
};

/** The events list's bulk bar (§527): each goes through a service verb above, and must reach its call. */
const BULK_ACTIONS: Record<string, readonly PublicContent[]> = {
  bulkArchiveEventsAction: ["events"],
  bulkPublishEventsAction: ["events"],
  bulkDeleteEventsAction: ["events"],
};

/**
 * The registrations' writes behind a public page (§553): the free places and the start list. Each
 * must reach `revalidatePublicContent("places")` — itself, through `transitionRegistration`, or
 * through a sweep that tells the cache once.
 */
const PLACES_DIRECTORIES = ["src/modules/registrations", "src/modules/jobs"] as const;
const PLACES_FILES = ["src/modules/notifications/deadline-rebase.ts"] as const;
const PLACES_WRITES = [
  // The one statement every change of state goes through.
  "src/modules/registrations/repository.ts#transitionRegistration",
  // The allocator: the form, the email link, the declaration, the waiting list, the participant's own cancel.
  "src/modules/registrations/service.ts#submitRegistration",
  "src/modules/registrations/service.ts#confirmEmail",
  "src/modules/registrations/service.ts#signDeclaration",
  "src/modules/registrations/service.ts#fillAvailableSpots",
  "src/modules/registrations/service.ts#unregister",
  "src/modules/registrations/service.ts#confirmByStaff",
  "src/modules/registrations/service.ts#promoteFromWaitlistByStaff",
  "src/modules/registrations/token-actions.ts#consumeAndConfirmEmail",
  "src/modules/registrations/token-actions.ts#consumeAndSignDeclaration",
  "src/modules/registrations/token-actions.ts#consumeAndSignFamilyDeclaration",
  "src/modules/registrations/token-actions.ts#consumeAndCancel",
  "src/modules/registrations/token-actions.ts#withdrawFromFamilyWizard",
  "src/modules/registrations/my-registrations.ts#consumeAndCancelFromMyRegistrations",
  // A family's places: the held sitting, one more person on the address.
  "src/modules/registrations/family-confirm.ts#confirmFamilyEntry",
  "src/modules/registrations/family-sitting-confirm.ts#confirmFamilySitting",
  "src/modules/registrations/repository.ts#writeFamilyReservation",
  "src/modules/registrations/repository.ts#writeFamilyPlaceHold",
  "src/modules/registrations/repository.ts#releaseFamilyPlaceHolds",
  // The staff's verbs: enter, confirm on paper, give a place, cancel, erase.
  "src/modules/registrations/admin-service.ts#createRegistrationByStaff",
  "src/modules/registrations/admin-service.ts#confirmRegistrationByStaff",
  "src/modules/registrations/admin-service.ts#promoteRegistrationByStaff",
  "src/modules/registrations/admin-service.ts#cancelRegistrationByStaff",
  "src/modules/registrations/admin-service.ts#bulkCancelRegistrationsByStaff",
  "src/modules/registrations/admin-service.ts#deleteRegistrationByStaff",
  "src/modules/registrations/admin-service.ts#bulkDeleteRegistrationsByStaff",
  "src/modules/registrations/admin-service.ts#eraseAllRegistrationsOfEvent",
  // The start list's own facts: the tick to appear on it, the socials beside a name.
  "src/modules/registrations/list-consent.ts#setListConsent",
  "src/modules/registrations/list-consent.ts#setListConsentFromManageLink",
  "src/modules/registrations/list-consent.ts#setListConsentFromMyRegistrations",
  "src/modules/registrations/admin-service.ts#withdrawOptionalData",
  "src/modules/registrations/consent-withdrawal.ts#clearOptionalData",
  // Test registrations queue like real ones (`AGENTS.md` §12.6).
  "src/modules/registrations/test-registrations.ts#addTestRegistrations",
  "src/modules/registrations/test-registrations.ts#removeTestRegistrations",
  // The jobs: the lapsed holds, links and offers, the closed waiting list, the retention sweep, a rebased deadline.
  "src/modules/registrations/maintenance.ts#runRegistrationMaintenance",
  "src/modules/registrations/repository.ts#expireStaleHolds",
  "src/modules/registrations/repository.ts#expireStalePendingEmailConfirmations",
  "src/modules/registrations/repository.ts#closeWaitlistForStartedEvent",
  "src/modules/jobs/retention.ts#pruneExpiredRows",
  "src/modules/notifications/deadline-rebase.ts#applyDeadlineRebase",
] as const;

const WRITE_CALLS = new Set(["insert", "update", "delete", "execute"]);

type FunctionFacts = {
  file: string;
  name: string;
  exported: boolean;
  calls: Set<string>;
  kinds: Set<string>;
  writes: boolean;
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return entry === "ui" ? [] : sourceFiles(full);
    return /\.ts$/.test(entry) ? [path.relative(ROOT, full).split(path.sep).join("/")] : [];
  });
}

/** `createHash("sha256").update(…)` feeds a hash; it writes nothing. */
function isHashUpdate(callee: ts.PropertyAccessExpression): boolean {
  const receiver = callee.expression;
  return (
    callee.name.text === "update" &&
    ts.isCallExpression(receiver) &&
    ts.isIdentifier(receiver.expression) &&
    receiver.expression.text === "createHash"
  );
}

/** The facts of every top-level function (a declaration or a `const` arrow) of one file. */
function functionsOf(file: string, text = readFileSync(path.join(ROOT, file), "utf8")): FunctionFacts[] {
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const facts: FunctionFacts[] = [];
  // `import * as repo from "./repository"`: `repo.x(…)` is a call to that file's `x`, recorded as its key.
  const namespaces = new Map<string, string>();
  for (const statement of tree.statements) {
    const bindings = ts.isImportDeclaration(statement) ? statement.importClause?.namedBindings : undefined;
    if (!bindings || !ts.isNamespaceImport(bindings) || !ts.isStringLiteral((statement as ts.ImportDeclaration).moduleSpecifier)) continue;
    const specifier = ((statement as ts.ImportDeclaration).moduleSpecifier as ts.StringLiteral).text;
    const target = specifier.startsWith("@/") ? `src/${specifier.slice(2)}` : specifier.startsWith(".") ? path.posix.join(path.posix.dirname(file), specifier) : null;
    if (target) namespaces.set(bindings.name.text, `${target}.ts`);
  }

  const read = (body: ts.Node, into: FunctionFacts) => {
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (ts.isIdentifier(callee) && callee.text === "revalidatePublicContent") {
          const [kind] = node.arguments;
          into.kinds.add(kind && ts.isStringLiteral(kind) ? kind.text : "<not a literal>");
        } else if (ts.isIdentifier(callee)) {
          into.calls.add(callee.text);
        } else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && namespaces.has(callee.expression.text)) {
          into.calls.add(`${namespaces.get(callee.expression.text)}#${callee.name.text}`);
        } else if (ts.isPropertyAccessExpression(callee) && WRITE_CALLS.has(callee.name.text) && !isHashUpdate(callee)) {
          into.writes = true;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(body);
  };

  for (const statement of tree.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    const exported = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      const entry = { file, name: statement.name.text, exported, calls: new Set<string>(), kinds: new Set<string>(), writes: false };
      read(statement.body, entry);
      facts.push(entry);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer;
        if (!ts.isIdentifier(declaration.name) || !init || !(ts.isArrowFunction(init) || ts.isFunctionExpression(init))) continue;
        const entry = { file, name: declaration.name.text, exported, calls: new Set<string>(), kinds: new Set<string>(), writes: false };
        read(init, entry);
        facts.push(entry);
      }
    }
  }
  return facts;
}

/** The functions of a set of files, and what each reaches through the calls it makes among them. */
function walk(files: readonly string[]) {
  const functions = new Map(files.flatMap((file) => functionsOf(file)).map((facts) => [`${facts.file}#${facts.name}`, facts]));

  /** Exported names defined once across the walked files — a call to one resolves to it. */
  const exportedByName = new Map<string, string[]>();
  for (const [key, facts] of functions) {
    if (facts.exported) exportedByName.set(facts.name, [...(exportedByName.get(facts.name) ?? []), key]);
  }

  const resolveCall = (from: FunctionFacts, name: string): string | undefined => {
    if (name.includes("#")) return functions.has(name) ? name : undefined;
    const local = `${from.file}#${name}`;
    if (functions.has(local)) return local;
    const exported = exportedByName.get(name);
    return exported?.length === 1 ? exported[0] : undefined;
  };

  /** What a function reaches, through every call it makes into the walked files. */
  const reach = (key: string, seen = new Set<string>()): { kinds: Set<string>; writes: boolean } => {
    const facts = functions.get(key);
    if (!facts || seen.has(key)) return { kinds: new Set(), writes: false };
    seen.add(key);
    const kinds = new Set(facts.kinds);
    let writes = facts.writes;
    for (const call of facts.calls) {
      const target = resolveCall(facts, call);
      if (!target) continue;
      const reached = reach(target, seen);
      reached.kinds.forEach((kind) => kinds.add(kind));
      writes ||= reached.writes;
    }
    return { kinds, writes };
  };

  return { functions, reach };
}

const WALKED = [...WALKED_DIRECTORIES.flatMap((directory) => sourceFiles(path.join(ROOT, directory))), ACTIONS_FILE];
const { functions: FUNCTIONS, reach } = walk(WALKED);


const sorted = (values: Iterable<string>) => [...values].sort();

describe("§549 — every write behind a public page expires it through revalidatePublicContent", () => {
  it("walks the files the table names", () => {
    const missing = Object.keys(WRITES).filter((key) => !FUNCTIONS.get(key)?.exported);
    expect(missing, "a verb in the table that is no longer an exported function — rename or remove it here").toEqual([]);
  });

  it("classifies every exported write of the walked modules", () => {
    const writers = [...FUNCTIONS].filter(([key, facts]) => facts.file !== ACTIONS_FILE && facts.exported && reach(key).writes).map(([key]) => key);
    const unclassified = writers.filter((key) => !(key in WRITES));
    expect(
      unclassified,
      "a new write in a module behind a public page: call revalidatePublicContent(<the kind the page reads>) after it commits, and name it in WRITES",
    ).toEqual([]);
  });

  it.each(Object.entries(WRITES))("%s expires what it changes", (key, expected) => {
    const reached = reach(key);
    expect(reached.writes, `${key} no longer writes; take it out of the table`).toBe(true);
    if ("nothingPublic" in expected) {
      expect(sorted(reached.kinds), `${key} now expires a kind; name it in the table instead of «${expected.nothingPublic}»`).toEqual([]);
    } else {
      expect(sorted(reached.kinds)).toEqual(sorted(expected));
    }
  });

  it.each(Object.entries(BULK_ACTIONS))("the bulk bar's %s reaches the call through its service verb", (name, expected) => {
    const key = `${ACTIONS_FILE}#${name}`;
    expect(FUNCTIONS.get(key)?.exported, `${name} is no longer an exported action`).toBe(true);
    expect(sorted(reach(key).kinds)).toEqual(sorted(expected));
  });

  describe("§553 the registrations' writes expire the free places and the start list", () => {
    const places = walk([...PLACES_DIRECTORIES.flatMap((directory) => sourceFiles(path.join(ROOT, directory))), ...PLACES_FILES]);

    it("walks the verbs the table names", () => {
      const missing = PLACES_WRITES.filter((key) => !places.functions.get(key)?.exported);
      expect(missing, "a verb in PLACES_WRITES that is no longer an exported function — rename or remove it here").toEqual([]);
    });

    it.each(PLACES_WRITES)("%s writes and expires `places`", (key) => {
      const reached = places.reach(key);
      expect(reached.writes, `${key} no longer writes; take it out of the table`).toBe(true);
      expect(sorted(reached.kinds), `${key} moves a place or the start list: it must reach revalidatePublicContent("places")`).toContain("places");
    });

    it("follows a call through a namespace import, as `service.ts` calls `repo.transitionRegistration`", () => {
      const [probe] = functionsOf("src/modules/registrations/probe.ts", 'import * as repo from "./repository";\nexport async function probe(db) { await repo.transitionRegistration(db, {}); }');
      expect([...(probe?.calls ?? [])]).toEqual(["src/modules/registrations/repository.ts#transitionRegistration"]);
    });
  });

  it("reads a write that forgets the call as one", () => {
    // The walk itself: a verb that writes and calls nothing is a writer with no kind, so the
    // table's check above would fail it — and a comment naming the call is not the call.
    const [probe, hash] = functionsOf(
      "probe.ts",
      'export async function probe(db) { /* revalidatePublicContent("events") */ await db.update(events).set({}); }\n' +
        'export function hash(text) { return createHash("sha256").update(text).digest("hex"); }',
    );
    expect(probe?.writes).toBe(true);
    expect(sorted(probe?.kinds ?? [])).toEqual([]);
    expect(hash?.writes).toBe(false);
  });
});
