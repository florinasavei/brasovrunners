import { type ComponentProps, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventVolunteerDocuments } from "@/db/schema/event-volunteer-documents";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { canManageVolunteers, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { decodeFlash, FLASH_COOKIE } from "@/shared/feedback/notice";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { SAMPLE_FILES } from "../../helpers/signed-contract-files";

/**
 * «Contract semnat» on the organizers' screens (§998, amending §758; the owner, 2026-11-19: «trebuie pentru fiecare voluntar să
 * pot atașa „contract semnat”»), BR-REQ-050-02 and BR-REQ-060-01, read from a real database:
 *
 * - the «Voluntari» list draws the chip «Contract semnat» on each row whose signed agreement is attached, and the strip
 *   «Contracte semnate: N din M» over «Înscris» and «Confirmat» — a pill to exactly those people —, the filter «Contract semnat»
 *   (with / without), and, with one event in scope, «Încarcă contractele semnate»;
 * - the volunteer's page draws the card: with none, the file box and «Încarcă»; with one, its name, length, when and by whom,
 *   «Descarcă» (the authenticated route), «Înlocuiește» and «Șterge» behind the house's question;
 * - «Șterge» asks the capability itself and comes back to the person's page with the toast; every other role gets the refusal;
 * - «Toate datele unei persoane» lists the copy's facts beside the offer, never its bytes;
 * - every role that may not work the volunteers gets a 404 for both pages. Both languages.
 */
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  actor: undefined as unknown,
  locale: "ro" as "ro" | "en",
  redirected: [] as string[],
  cookies: [] as Array<[string, string]>,
  asked: [] as unknown[],
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async (arg: string | { locale?: "ro" | "en"; namespace: string }) => {
    const namespace = typeof arg === "string" ? arg : arg.namespace;
    const locale = typeof arg === "string" ? state.locale : (arg.locale ?? state.locale);
    const catalogue = (locale === "ro" ? ro : en) as unknown as Record<string, Record<string, unknown>>;
    return createTranslator({ locale, messages: catalogue[namespace] as never });
  },
  getLocale: async () => state.locale,
  setRequestLocale: () => undefined,
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (url: string) => {
    state.redirected.push(url);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: (name: string, value: string) => void state.cookies.push([name, value]), delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/i18n/navigation", () => {
  type Href = string | { pathname: string; params?: Record<string, string>; query?: Record<string, string> };
  const hrefOf = (locale: string, href: Href) => {
    if (typeof href === "string") return `/${locale}${href}`;
    let path = href.pathname;
    for (const [key, value] of Object.entries(href.params ?? {})) path = path.replace(`[${key}]`, value);
    const query = href.query ? `?${new URLSearchParams(href.query).toString()}` : "";
    return `/${locale}${path}${query}`;
  };
  return {
    getPathname: ({ locale, href }: { locale: string; href: Href }) => hrefOf(locale, href),
    Link: ({ href, children, ...rest }: { href: Href; children?: ReactNode } & Record<string, unknown>) => createElement("a", { href: hrefOf(state.locale, href), ...rest }, children),
  };
});
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => {
    if (!state.actor) throw new DomainError("UNAUTHENTICATED", "no staff session");
    return state.actor;
  },
  requireStaffCapability: async (capability: (subject: unknown) => boolean) => {
    state.asked.push(capability);
    if (!state.actor) throw new DomainError("UNAUTHENTICATED", "no staff session");
    if (!capability(state.actor)) throw new DomainError("FORBIDDEN", "no");
    return state.actor;
  },
}));

const { default: AdminVolunteersPage } = await import("@/app/[locale]/admin/volunteers/(list)/page");
const { default: AdminVolunteerPage } = await import("@/app/[locale]/admin/volunteers/[id]/page");
const contractActions = await import("@/app/[locale]/admin/volunteers/[id]/contract-actions");
const { default: AdminTable } = await import("@/modules/staff-identity/ui/AdminTable");
const { default: ChipLink } = await import("@/shared/ui/ChipLink");
const { default: StatusChip } = await import("@/shared/ui/StatusChip");
const { default: SignedContractUpload } = await import("@/modules/volunteers/ui/SignedContractUpload");
const { default: SignedContractCard } = await import("@/modules/volunteers/ui/SignedContractCard");
const { attachSignedContract } = await import("@/modules/volunteers/signed-contract");
const { exportPersonData, viewPersonData } = await import("@/modules/registrations/person-data");

type Props = Record<string, unknown> & { children?: ReactNode };
type Column = { key: string; render: (row: unknown) => ReactNode };

function elements(node: ReactNode, acc: ReactElement<Props>[] = []): ReactElement<Props>[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child as ReactNode, acc);
    return acc;
  }
  if (!isValidElement<Props>(node)) return acc;
  acc.push(node);
  elements(node.props.children, acc);
  return acc;
}
const byTestId = (tree: ReactNode, id: string) => elements(tree).filter((element) => element.props["data-testid"] === id || element.props.testId === id);
const fieldOf = (nodes: ReactElement<Props>[], name: string) => nodes.find((element) => element.type === "input" && element.props.name === name)?.props.value;

const NOW = new Date("2026-11-19T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let raceId: string;
let runId: string;
const people = { ana: "", dan: "", eva: "", ion: "", mara: "" };

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

async function volunteer(eventId: string, name: string, stateOf: "REGISTERED" | "CONFIRMED" | "CANCELLED" = "CONFIRMED"): Promise<string> {
  const email = `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.test`;
  const [row] = await db
    .insert(eventVolunteers)
    .values({ eventId, name, email, canonicalEmail: email, canonicalizationVersion: 1, phone: "+40700000001", source: "PUBLIC", state: stateOf, createdAt: NOW, updatedAt: NOW })
    .returning({ id: eventVolunteers.id });
  return row.id;
}

beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
  state.redirected.length = 0;
  state.cookies.length = 0;
  state.asked.length = 0;
  for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"] as const) {
    [staff[role]] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: `Coleg ${role}`, role }).returning();
  }
  state.actor = staff.MODERATOR;
  const [race, run] = await db
    .insert(events)
    .values([
      { type: "RACE", startsAt: new Date("2099-11-21T08:00:00.000Z"), featured: true, acceptsVolunteers: true, editorialStatus: "PUBLISHED", publishedAt: NOW },
      { type: "RACE", startsAt: new Date("2099-12-05T08:00:00.000Z"), acceptsVolunteers: true },
    ])
    .returning({ id: events.id });
  raceId = race.id;
  runId = run.id;
  await db.insert(eventTranslations).values([
    { eventId: raceId, locale: "ro", slug: `crosul-${raceId.slice(0, 8)}`, title: "Crosul" },
    { eventId: raceId, locale: "en", slug: `cross-${raceId.slice(0, 8)}`, title: "The cross" },
    { eventId: runId, locale: "ro", slug: `altul-${runId.slice(0, 8)}`, title: "Alt cros" },
    { eventId: runId, locale: "en", slug: `other-${runId.slice(0, 8)}`, title: "Another cross" },
  ]);
  // Ana's signed agreement is attached; Dan's and Ion's are not; Eva cancelled with hers attached; Mara is the other event's, with hers.
  people.ana = await volunteer(raceId, "Ana Pop");
  people.dan = await volunteer(raceId, "Dan Ene", "REGISTERED");
  people.eva = await volunteer(raceId, "Eva Stan", "CANCELLED");
  people.ion = await volunteer(raceId, "Ion Lupu");
  people.mara = await volunteer(runId, "Mara Dinu");
  for (const id of [people.ana, people.eva]) await attachSignedContract(db, staff.ADMIN!, { eventId: raceId, volunteerId: id, fileName: "Contract-voluntariat-semnat.pdf", bytes: SAMPLE_FILES.pdf() }, NOW);
  await attachSignedContract(db, staff.ADMIN!, { eventId: runId, volunteerId: people.mara, fileName: "Contract-voluntariat-Mara-Dinu.docx", bytes: SAMPLE_FILES.docx() }, NOW);
});

async function html(page: ReactNode): Promise<string> {
  const intl = { locale: state.locale, timeZone: "Europe/Bucharest", messages: state.locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, page), { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}
const listTree = async (query: Record<string, string> = {}, locale: "ro" | "en" = "ro") => {
  state.locale = locale;
  return AdminVolunteersPage({ params: Promise.resolve({ locale }), searchParams: Promise.resolve(query) });
};
const personTree = async (id: string, locale: "ro" | "en" = "ro") => {
  state.locale = locale;
  return AdminVolunteerPage({ params: Promise.resolve({ locale, id }), searchParams: Promise.resolve({}) });
};
function tableOf(tree: ReactNode) {
  const table = elements(tree).find((element) => element.type === AdminTable)!;
  const columns = table.props.columns as Column[];
  const rows = table.props.rows as Array<{ id: string; name: string }>;
  const cell = (key: string, id: string) => columns.find((column) => column.key === key)!.render(rows.find((row) => row.id === id));
  return { rows, cell, names: rows.map((row) => row.name).sort() };
}
const pillsOf = (tree: ReactNode) =>
  elements(tree)
    .filter((element) => element.type === ChipLink)
    .map((element) => ({ label: element.props.label as string, href: element.props.href as string, active: element.props.active === true }));
const pillOf = (tree: ReactNode, label: string) => pillsOf(tree).find((pill) => pill.label === label);
/** The person's page with its «Contract semnat» card drawn: the card is an async Server Component, so its own tree is asked for. */
async function cardOf(id: string, locale: "ro" | "en" = "ro") {
  const tree = await personTree(id, locale);
  const card = elements(tree).find((element) => element.type === SignedContractCard)!;
  return { tree, card: await SignedContractCard(card.props as unknown as Parameters<typeof SignedContractCard>[0]) };
}
const chipsIn = (node: ReactNode) => elements(node).filter((element) => element.type === StatusChip && element.props.testId === "volunteer-contract-chip");

describe("§998 the «Voluntari» list: the chip, the count, the filter", () => {
  it("draws «Contract semnat» on the rows whose signed agreement is attached, and on no other, in both languages", async () => {
    const { cell } = tableOf(await listTree({ eventId: raceId }));
    expect(chipsIn(cell("state", people.ana))).toHaveLength(1);
    expect(chipsIn(cell("state", people.ana))[0].props).toMatchObject({ glyph: "signedContract", label: "Contract semnat" });
    expect(chipsIn(cell("state", people.eva))).toHaveLength(1);
    for (const id of [people.dan, people.ion]) expect(chipsIn(cell("state", id))).toEqual([]);
    const english = tableOf(await listTree({ eventId: raceId }, "en"));
    expect(chipsIn(english.cell("state", people.ana))[0].props.label).toBe("Signed agreement");
  });

  it("says «Contracte semnate: N din M» over «Înscris» and «Confirmat» — a cancelled person owes none — a pill to exactly those people", async () => {
    const tree = await listTree({ eventId: raceId });
    const pill = pillOf(tree, "Contracte semnate: 1 din 3");
    expect(pill).toBeDefined();
    const href = new URL(pill!.href, "https://example.test");
    expect([href.pathname, href.searchParams.get("contract"), href.searchParams.get("eventId")]).toEqual(["/ro/admin/volunteers", "yes", raceId]);
    expect(pill!.active).toBe(false);
    expect(tableOf(await listTree({ eventId: raceId, contract: "yes" })).names).toEqual(["Ana Pop"]);
    expect(tableOf(await listTree({ eventId: raceId, contract: "no" })).names).toEqual(["Dan Ene", "Ion Lupu"]);
    const filtered = await listTree({ eventId: raceId, contract: "yes" });
    expect(pillOf(filtered, "Contracte semnate: 1 din 3")!.active).toBe(true);
    expect(new URL(pillOf(filtered, "Contracte semnate: 1 din 3")!.href, "https://example.test").searchParams.get("contract")).toBeNull();
    // Across every event, the other event's copy counts too; a nought is said.
    expect(pillOf(await listTree({ eventId: "all" }), "Contracte semnate: 2 din 4")).toBeDefined();
    await db.delete(eventVolunteerDocuments);
    expect(pillOf(await listTree({ eventId: raceId }), "Contracte semnate: 0 din 3")).toBeDefined();
    expect(pillsOf(await listTree({ eventId: raceId }, "en")).map((one) => one.label)).toContain("Signed agreements: 0 of 3");
  });

  it("filters through the address and the filters' form: «yes», «no», combined with the others, and anything else is no filter", async () => {
    expect(tableOf(await listTree({ eventId: raceId, contract: "no", state: "CONFIRMED" })).names).toEqual(["Ion Lupu"]);
    for (const junk of ["1", "true", "da", ""]) expect(tableOf(await listTree({ eventId: raceId, contract: junk })).names, junk).toEqual(["Ana Pop", "Dan Ene", "Eva Stan", "Ion Lupu"]);
    const [select] = byTestId(await listTree({ eventId: raceId, contract: "no" }), "volunteers-filter-contract");
    expect(select.props).toMatchObject({ name: "contract", defaultValue: "no", label: "Contract semnat" });
    const options = elements(select.props.children).filter((element) => element.props.value !== undefined).map((element) => [element.props.value, element.props.children]);
    expect(options).toEqual([
      ["", "Toți, cu sau fără contract semnat"],
      ["yes", "Cu contract semnat"],
      ["no", "Fără contract semnat"],
    ]);
  });
});

describe("§998 «Încarcă contractele semnate» on the list", () => {
  it("stands with one event in scope: a form posting to the event's route, sending each matched file to its volunteer's own route", async () => {
    const tree = await listTree({ eventId: raceId, sort: "name" });
    const [island] = elements(tree).filter((element) => element.type === SignedContractUpload);
    expect(island.props).toMatchObject({
      mode: "many",
      action: `/api/admin/events/${raceId}/volunteers/signed-contracts`,
      uploadTemplate: `/api/admin/events/${raceId}/volunteers/{volunteer}/signed-contract`,
      locale: "ro",
      maxBytes: 10 * 1024 * 1024,
      partBytes: 4 * 1024 * 1024,
      testId: "volunteers-contracts-upload",
    });
    const back = new URL(String(island.props.returnTo), "https://example.test");
    expect([back.pathname, back.searchParams.get("eventId"), back.searchParams.get("sort")]).toEqual(["/ro/admin/volunteers", raceId, "name"]);
    const labels = island.props.labels as { submit: string; chooseFirst: string; reasons: Record<string, string> };
    expect(labels.submit).toBe("Încarcă contractele semnate");
    expect(labels.reasons.tooLarge).toBe("fișierul are peste 10 MB");
    // Pressed with nothing chosen, the island says what the plain form comes back with: the files, in the plural.
    expect(labels.chooseFirst).toBe(ro.Admin.errors.VOLUNTEER_CONTRACTS_NONE_CHOSEN);
    // Only strings and numbers cross to the island.
    for (const [key, value] of Object.entries(island.props)) expect(["string", "number", "object"], key).toContain(typeof value);
  });

  it("is not drawn across every event: a name is matched among one event's people", async () => {
    expect(elements(await listTree({ eventId: "all" })).filter((element) => element.type === SignedContractUpload)).toEqual([]);
  });

  it("renders as a plain multipart form that works with scripts off, in both languages", async () => {
    state.locale = "ro";
    const page = await html(await listTree({ eventId: raceId }));
    const form = /<form[^>]*data-testid="volunteers-contracts-upload"[\s\S]*?<\/form>/.exec(page)?.[0] ?? "";
    expect(form).toContain(`action="/api/admin/events/${raceId}/volunteers/signed-contracts"`);
    // HTML's attribute names know no case; React writes these two as it names them.
    expect(form).toMatch(/method="post"/i);
    expect(form).toMatch(/enctype="multipart\/form-data"/i);
    expect(form).toMatch(/<input[^>]*type="file"[^>]*multiple[^>]*name="files"/);
    expect(form).toMatch(/type="submit"/);
    expect(page).toContain(ro.Admin.volunteers.contract.bulkIntro);
    const english = await html(await listTree({ eventId: raceId }, "en"));
    expect(english).toContain(en.Admin.volunteers.contract.bulkTitle);
  });
});

describe("§998 the volunteer's card «Contract semnat»", () => {
  it("with one attached: its name, length, when and by whom, «Descarcă» to the authenticated route, «Șterge» behind the question, «Înlocuiește»", async () => {
    const { card: tree } = await cardOf(people.ana);
    const [file] = byTestId(tree, "volunteer-contract-file");
    expect(file.props.children).toBe("Contract-voluntariat-semnat.pdf");
    const page = await html(tree);
    expect(page).toContain("Atașat");
    expect(page).toContain("de Coleg ADMIN");
    const [download] = byTestId(tree, "volunteer-contract-download");
    expect(download.props).toMatchObject({ href: `/api/admin/events/${raceId}/volunteers/${people.ana}/signed-contract`, icon: "download", "aria-label": "Descarcă contractul semnat: Ana Pop" });
    const [remove] = byTestId(tree, "volunteer-contract-delete-form");
    expect(remove.props.action).toBe(contractActions.deleteSignedContractAction);
    expect(remove.props.confirm).toMatchObject({ title: "Ștergi contractul semnat?", destructive: true });
    const inside = elements(remove);
    expect([fieldOf(inside, "volunteerId"), fieldOf(inside, "eventId"), fieldOf(inside, "returnTo")]).toEqual([people.ana, raceId, `/ro/admin/volunteers/${people.ana}`]);
    const [island] = elements(tree).filter((element) => element.type === SignedContractUpload);
    expect(island.props).toMatchObject({ mode: "one", action: `/api/admin/events/${raceId}/volunteers/${people.ana}/signed-contract`, testId: "volunteer-contract-upload" });
    expect((island.props.labels as { submit: string }).submit).toBe("Înlocuiește");
  });

  it("with none: says so, and offers the file box and «Încarcă» — a plain multipart form to the volunteer's route", async () => {
    const { tree: whole, card: tree } = await cardOf(people.ion);
    expect(byTestId(tree, "volunteer-contract-none")).toHaveLength(1);
    expect(byTestId(tree, "volunteer-contract-download")).toEqual([]);
    const [island] = elements(tree).filter((element) => element.type === SignedContractUpload);
    expect((island.props.labels as { submit: string }).submit).toBe("Încarcă");
    expect((island.props.labels as { chooseFirst: string }).chooseFirst).toBe(ro.Admin.volunteers.contract.chooseFirst);
    const page = await html(whole);
    const form = /<form[^>]*data-testid="volunteer-contract-upload"[\s\S]*?<\/form>/.exec(page)?.[0] ?? "";
    expect(form).toContain(`action="/api/admin/events/${raceId}/volunteers/${people.ion}/signed-contract"`);
    expect(form).toMatch(/enctype="multipart\/form-data"/i);
    expect(form).toMatch(/<input[^>]*type="file"[^>]*name="file"/);
    expect(page).toContain('id="contract-semnat"');
    const english = await html(await personTree(people.ion, "en"));
    expect(english).toContain(en.Admin.volunteers.contract.none);
    expect(english).toContain(">Upload<");
  });

  it("is a 404 — both pages — for a role that may not work the volunteers", async () => {
    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      state.actor = staff[role];
      await expect(listTree({ eventId: raceId }), role).rejects.toThrow("NOT_FOUND");
      await expect(personTree(people.ana), role).rejects.toThrow("NOT_FOUND");
    }
  });
});

describe("§998 deleteSignedContractAction — «Șterge»", () => {
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries({ uiLocale: "ro", eventId: raceId, volunteerId: people.ana, returnTo: `/ro/admin/volunteers/${people.ana}`, ...fields })) data.set(key, value);
    return data;
  };
  async function press(fields: Record<string, string> = {}) {
    state.redirected.length = 0;
    state.cookies.length = 0;
    await expect(contractActions.deleteSignedContractAction(null, form(fields))).rejects.toThrow("NEXT_REDIRECT");
    return { to: state.redirected[0], toast: decodeFlash(state.cookies.find(([name]) => name === FLASH_COOKIE)?.[1]) };
  }

  it("deletes the copy and comes back to the person's page with the toast; a second press says there was none", async () => {
    expect(await press()).toEqual({ to: `/ro/admin/volunteers/${people.ana}`, toast: { kind: "success", key: "volunteerContractDeleted" } });
    expect(state.asked.at(-1)).toBe(canManageVolunteers);
    expect((await db.select().from(eventVolunteerDocuments)).map((row) => row.volunteerId).sort()).toEqual([people.eva, people.mara].sort());
    expect(await press()).toEqual({ to: `/ro/admin/volunteers/${people.ana}`, toast: { kind: "info", key: "volunteerContractNone" } });
  });

  it("refuses every other role and an ended session with the code in the address, writing nothing; another event's person is NOT_FOUND", async () => {
    const before = (await db.select().from(auditLogs)).length;
    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      state.actor = staff[role];
      expect((await press()).to, role).toBe(`/ro/admin/volunteers/${people.ana}?volunteerError=FORBIDDEN`);
    }
    state.actor = undefined;
    expect((await press()).to).toBe(`/ro/admin/volunteers/${people.ana}?volunteerError=UNAUTHENTICATED`);
    state.actor = staff.ADMIN;
    expect((await press({ volunteerId: people.mara })).to).toBe(`/ro/admin/volunteers/${people.ana}?volunteerError=NOT_FOUND`);
    expect(await db.select().from(eventVolunteerDocuments)).toHaveLength(3);
    expect(await db.select().from(auditLogs)).toHaveLength(before);
  });

  it("has its words in both catalogues", () => {
    for (const catalogue of [ro, en]) {
      const toasts = catalogue.Feedback.toast as Record<string, unknown>;
      for (const key of ["volunteerContractUploaded", "volunteerContractReplaced", "volunteerContractDeleted", "volunteerContractNone"]) expect(typeof toasts[key], key).toBe("string");
      for (const key of ["volunteerContractsAttached", "volunteerContractsAttachedSome"]) expect(Object.keys(toasts[key] as object).sort(), key).toEqual(["few", "one", "other"]);
    }
  });
});

describe("§998 «Toate datele unei persoane» lists the signed copy", () => {
  it("names the offer's copy — its name, format, length and moment — and never its bytes, on the screen and in the file", async () => {
    const data = await viewPersonData(db, staff.ADMIN!, "ana.pop@example.test", NOW);
    expect(data.volunteerOffers).toHaveLength(1);
    expect(data.volunteerOffers[0].signedContract).toEqual({ fileName: "Contract-voluntariat-semnat.pdf", format: "PDF", size: SAMPLE_FILES.pdf().length, uploadedAt: NOW });
    const none = await viewPersonData(db, staff.ADMIN!, "ion.lupu@example.test", NOW);
    expect(none.volunteerOffers[0].signedContract).toBeNull();
    const exported = await exportPersonData(db, staff.ADMIN!, "ana.pop@example.test", NOW);
    expect(JSON.stringify(exported)).not.toContain("%PDF");
    const [row] = await db.select().from(auditLogs).where((await import("drizzle-orm")).eq(auditLogs.action, "participant.data_exported"));
    expect(row.metadataJson).toMatchObject({ signedContracts: 1 });
  });
});
