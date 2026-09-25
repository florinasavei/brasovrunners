import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { expect, type Locator, type Page, type Route, test } from "@playwright/test";
import { confirmDialog } from "../support/confirm";
import { ensureRegistrationIsOpen, FEATURED, fillDateField, fillTimeField, hydrated, signIn } from "../support/featured-event";
import { languagePanel, languageTab, openEditorBox } from "../support/fold";

/**
 * How long a press of each heavy form's primary button blocks the page — its Interaction to Next
 * Paint (§371). The owner, 2026-09-24, from the Vercel toolbar: "Event handlers on this element
 * blocked UI updates for 352ms", on a contained primary button of the backoffice.
 *
 * **Opt-in, and never an assertion that can flake**: `PERF_INP=1` runs it, anything else skips
 * it, so `yarn test:e2e` and CI never meet a timing. Run against a production build, the one the
 * owner's browser met:
 *
 *   yarn build && yarn start --port 4829           (APP_BASE_URL=http://localhost:4829)
 *   PERF_INP=1 E2E_PORT=4829 yarn playwright test tests/e2e/perf --project=mobile --workers=1
 *
 * The number is the browser's own (the Event Timing API, `type: "event"`): the longest entry of
 * the press's interaction — pointerdown, pointerup, click and the form's submit behind it — from
 * the finger to the next frame, which is exactly what INP counts. The CPU is slowed 4× over the
 * Chrome DevTools protocol (a mid-range phone, `PERF_CPU` to change it) for the press alone, and
 * each press is repeated `PERF_RUNS` times (3). Long animation frames overlapping the press are
 * kept beside it, with their scripts, so a regression says where it went — and so are the CSS
 * rules the press inserted, which must be none (§371, `instrument`).
 *
 * **Nothing is written by a press.** The Server Action's POST is held unanswered while the frame
 * after the press is measured — the pending "Se salvează…" is what that frame paints — and then
 * abandoned, so no event, registration, wording or legal draft is created. A press the browser
 * refuses (a required box empty) posts nothing anyway. The one write is the registration test's
 * setup: the featured event is opened for registration as every registration spec opens it.
 *
 * The table is printed and written to `test-results/inp-<project>.jsonl` (`PERF_OUT` for a path).
 * Good INP is under 200 ms (web.dev); the summary line says which presses are over.
 *
 * To see where a slow press goes, three switches, each costing time of its own (so a number
 * measured with one on is not a number to report): `PERF_TRACE=<dir>` writes a Chrome trace of
 * each press, with CPU samples, for the Performance panel; `PERF_PROFILE=<dir>` a V8 CPU profile;
 * `PERF_REACT=1` lists, per React commit, the top of each re-rendered subtree and how many
 * components rendered.
 */

const RUN = process.env.PERF_INP === "1";
const CPU_RATE = Number(process.env.PERF_CPU ?? 4);
const RUNS = Number(process.env.PERF_RUNS ?? 3);
const GOOD_MS = 200;

test.skip(!RUN, "timing measurement: PERF_INP=1 runs it (never in CI)");
// Throttled pages are slow to fill; the budget is for the whole scenario, all its runs. A step
// that cannot find its box fails in half a minute rather than in ten.
test.setTimeout(600_000);
test.use({ actionTimeout: 30_000 });

type EventRow = { name: string; duration: number; interactionId: number; startTime: number; processingStart: number; processingEnd: number; target: string };
type ScriptRow = { invoker: string; sourceURL: string; sourceFunctionName: string; duration: number; forcedStyleAndLayoutDuration: number };
type FrameRow = { startTime: number; duration: number; blockingDuration: number; renderStart: number; styleAndLayoutStart: number; scripts: ScriptRow[] };
type RuleRow = { at: number; rule: string };
/** One React commit: where each re-rendered subtree starts, and how many components it rendered. */
type CommitRow = { at: number; rendered: number; roots: string[] };
type Probe = { events: EventRow[]; frames: FrameRow[]; rules: RuleRow[]; commits: CommitRow[] };
type Measured = { inp: number; entries: EventRow[]; frames: FrameRow[]; rules: RuleRow[]; commits: CommitRow[] };

/** Every test's page, instrumented: the timings always, React's commits with `PERF_REACT=1`. */
async function prepare(page: Page) {
  await page.addInitScript(instrument);
  if (process.env.PERF_REACT === "1") await page.addInitScript(watchCommits);
}

/**
 * `PERF_REACT=1`: which components a press re-rendered, read from React's own commits through
 * the hook its developer tools use (production React reports to it too). Each commit lists the
 * top of every re-rendered subtree, named by the first element it draws, and how many components
 * rendered in all — "the whole form re-rendered" is one line instead of a guess.
 */
function watchCommits() {
  type Fiber = {
    tag: number;
    flags: number;
    alternate: Fiber | null;
    child: Fiber | null;
    sibling: Fiber | null;
    stateNode: unknown;
    type: unknown;
  };
  const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]);
  const PERFORMED_WORK = 1;
  const describe = (fiber: Fiber): string => {
    for (let node: Fiber | null = fiber; node; node = node.child) {
      if (node.tag === 5 && node.stateNode instanceof Element) {
        const element = node.stateNode;
        const name = element.getAttribute("name") ?? element.getAttribute("data-testid") ?? element.id;
        const text = (element.textContent ?? "").trim().slice(0, 30);
        return `${element.tagName.toLowerCase()}${name ? `[${name}]` : ""}.${String(element.className).split(" ")[0]} "${text}"`;
      }
    }
    return "(no element)";
  };
  let previous = new WeakSet<Fiber>();
  (window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    isDisabled: false,
    supportsFiber: true,
    renderers: new Map(),
    inject: () => 1,
    onScheduleFiberRoot: () => undefined,
    onCommitFiberUnmount: () => undefined,
    onPostCommitFiberRoot: () => undefined,
    onCommitFiberRoot: (_id: number, root: { current: Fiber }) => {
      const probe = (window as unknown as { __inp?: Probe }).__inp;
      if (!probe) return;
      let rendered = 0;
      const roots: string[] = [];
      const seen = new WeakSet<Fiber>();
      const walk = (fiber: Fiber | null, insideRendered: boolean) => {
        for (let node = fiber; node; node = node.sibling) {
          seen.add(node);
          // A subtree React skipped keeps the very fiber objects of the last commit, with their old
          // flags; one it rendered is the other copy. So "performed work, and new since last time".
          const didRender =
            COMPONENT_TAGS.has(node.tag) && node.alternate !== null && (node.flags & PERFORMED_WORK) === PERFORMED_WORK && !previous.has(node);
          if (didRender) rendered += 1;
          if (didRender && !insideRendered) roots.push(describe(node));
          walk(node.child, insideRendered || didRender);
        }
      };
      walk(root.current.child, false);
      previous = seen;
      if (rendered > 0) probe.commits.push({ at: performance.now(), rendered, roots: roots.slice(0, 12) });
    },
  };
}

/**
 * Installed before any page script: every event entry and every long animation frame, kept on
 * `window` — and every CSS rule the page inserts after it has loaded (§371). MUI's styles sit in
 * cascade layers here (`enableCssLayer`, `modularCssLayers`), and Chromium answers a rule inserted
 * into a layered sheet by rebuilding the layer map and its font cache: every element's style and
 * every text's layout, a whole-page recalculation. A press that renders a style the page has not
 * yet drawn pays that inside its interaction, so the spec names what was inserted.
 */
function instrument() {
  const probe: Probe = { events: [], frames: [], rules: [], commits: [] };
  (window as unknown as { __inp: Probe }).__inp = probe;
  const insertRule = CSSStyleSheet.prototype.insertRule;
  CSSStyleSheet.prototype.insertRule = function patched(this: CSSStyleSheet, rule: string, index?: number) {
    probe.rules.push({ at: performance.now(), rule: rule.replace(/\s+/g, " ").slice(0, 160) });
    return insertRule.call(this, rule, index);
  };
  const describe = (node: Node | null) => {
    if (!(node instanceof Element)) return String(node);
    const text = (node.textContent ?? "").trim().slice(0, 40);
    return `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""} "${text}"`;
  };
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceEventTiming[]) {
        probe.events.push({
          name: entry.name,
          duration: entry.duration,
          interactionId: (entry as PerformanceEventTiming & { interactionId?: number }).interactionId ?? 0,
          startTime: entry.startTime,
          processingStart: entry.processingStart,
          processingEnd: entry.processingEnd,
          target: describe(entry.target),
        });
      }
    }).observe({ type: "event", durationThreshold: 16, buffered: true } as PerformanceObserverInit);
  } catch {
    // An engine without the Event Timing API measures nothing; the spec then says so.
  }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const frame = entry as PerformanceEntry & {
          blockingDuration: number;
          renderStart: number;
          styleAndLayoutStart: number;
          scripts: Array<{ invoker: string; sourceURL: string; sourceFunctionName: string; duration: number; forcedStyleAndLayoutDuration: number }>;
        };
        probe.frames.push({
          startTime: frame.startTime,
          duration: frame.duration,
          blockingDuration: frame.blockingDuration,
          renderStart: frame.renderStart,
          styleAndLayoutStart: frame.styleAndLayoutStart,
          scripts: frame.scripts.map((script) => ({
            invoker: script.invoker,
            sourceURL: script.sourceURL.replace(/^.*\/_next\//, "_next/"),
            sourceFunctionName: script.sourceFunctionName,
            duration: script.duration,
            forcedStyleAndLayoutDuration: script.forcedStyleAndLayoutDuration,
          })),
        });
      }
    }).observe({ type: "long-animation-frame", buffered: true });
  } catch {
    // Long animation frames are Chromium's; the INP number does not depend on them.
  }
}

/**
 * Hold every Server Action POST unanswered (see the file's comment): the press paints its pending
 * state against a request that never returns, and `abandon` drops what was held before the next
 * run loads the page again. Nothing is written.
 */
async function holdServerActions(page: Page): Promise<{ abandon: () => Promise<void>; held: () => number }> {
  const routes: Route[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"]) {
      routes.push(route);
      return;
    }
    await route.fallback();
  });
  return {
    held: () => routes.length,
    abandon: async () => {
      for (const route of routes.splice(0)) await route.abort().catch(() => undefined);
    },
  };
}

/**
 * Press `button` at `CPU_RATE`× and return the press's INP: the longest event entry that shares
 * the click's interaction. The throttle is on for the press and the frame after it only, so
 * filling the form stays quick; the page is given a moment at the throttled rate first, so what
 * the press meets is the page at rest.
 */
async function pressAndMeasure(page: Page, button: Locator): Promise<Measured> {
  await button.scrollIntoViewIfNeeded();
  return measure(page, "click", () => button.click({ noWaitAfter: true }));
}

/**
 * One keystroke into the box that has focus, measured like a press: typing is an interaction too,
 * and every listener the form hangs on `input` runs inside it (§371).
 */
async function keystrokeAndMeasure(page: Page, key: string): Promise<Measured> {
  return measure(page, "keydown", () => page.keyboard.press(key));
}

async function measure(page: Page, kind: "click" | "keydown", act: () => Promise<void>): Promise<Measured> {
  await page.evaluate(() => {
    const probe = (window as unknown as { __inp: Probe }).__inp;
    probe.events.length = 0;
    probe.frames.length = 0;
    probe.rules.length = 0;
    probe.commits.length = 0;
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_RATE });
  await page.waitForTimeout(400);
  // `PERF_TRACE=<dir>`: a Chrome trace of each measured interaction, for the Performance panel.
  const browser = page.context().browser();
  const tracing = process.env.PERF_TRACE && browser ? `${process.env.PERF_TRACE}/${test.info().project.name}-${kind}-${Date.now()}.json` : null;
  if (tracing && browser) {
    mkdirSync(process.env.PERF_TRACE as string, { recursive: true });
    await browser.startTracing(page, { path: tracing, categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.invalidationTracking", "blink.user_timing", "v8.execute", "disabled-by-default-v8.cpu_profiler"] });
  }
  // `PERF_PROFILE=<dir>`: a V8 CPU profile of each measured interaction (`.cpuprofile`, which the
  // Performance panel opens), sampled finely enough to see a 5 ms function at the throttled rate.
  const profiling = process.env.PERF_PROFILE ? `${process.env.PERF_PROFILE}/${test.info().project.name}-${kind}-${Date.now()}.cpuprofile` : null;
  if (profiling) {
    mkdirSync(process.env.PERF_PROFILE as string, { recursive: true });
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
    await cdp.send("Profiler.start");
  }
  const from = await page.evaluate(() => performance.now());
  await act();
  // The entries are delivered after the frame that ends the interaction; a press under 16 ms
  // produces none, which is the best answer there is.
  await page
    .waitForFunction(
      ([since, name]) => (window as unknown as { __inp: Probe }).__inp.events.some((entry) => entry.name === name && entry.startTime >= since),
      [from, kind] as const,
      { timeout: 5_000 },
    )
    .catch(() => undefined);
  await page.waitForTimeout(500);
  if (tracing && browser) await browser.stopTracing();
  if (profiling) {
    const { profile } = await cdp.send("Profiler.stop");
    writeFileSync(profiling, JSON.stringify(profile));
  }
  const probe = await page.evaluate((since) => {
    const { events, frames, rules, commits } = (window as unknown as { __inp: Probe }).__inp;
    return {
      events: events.filter((entry) => entry.startTime >= since - 50),
      frames: frames.filter((frame) => frame.startTime + frame.duration >= since),
      rules: rules.filter((row) => row.at >= since),
      commits: commits.filter((row) => row.at >= since),
    };
  }, from);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await cdp.detach();

  const first = probe.events.find((entry) => entry.name === kind && entry.interactionId > 0);
  const entries = first ? probe.events.filter((entry) => entry.interactionId === first.interactionId) : probe.events.filter((entry) => entry.interactionId > 0);
  const inp = entries.length === 0 ? 0 : Math.max(...entries.map((entry) => entry.duration));
  const end = entries.length === 0 ? from + 1_000 : Math.max(...entries.map((entry) => entry.startTime + entry.duration));
  return {
    inp,
    entries,
    frames: probe.frames.filter((frame) => frame.startTime <= end),
    rules: probe.rules.filter((row) => row.at <= end),
    commits: probe.commits.filter((row) => row.at <= end),
  };
}

/**
 * Run a press `RUNS` times, print its numbers and append them — one JSON line per scenario, the
 * worst run's entries and long frames with it — to `PERF_OUT`. Appended as each scenario ends, so
 * a later scenario that fails loses nothing already measured.
 */
async function record(scenario: string, attempt: () => Promise<Measured>) {
  const runs: Measured[] = [];
  for (let index = 0; index < RUNS; index += 1) runs.push(await attempt());
  const values = runs.map((run) => run.inp);
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const max = Math.max(...values);
  const worst = runs[values.indexOf(max)];
  const project = test.info().project.name;
  // How many CSS rules each run inserted inside its interaction: anything but 0 is a whole-page
  // recalculation paid inside the press (see `instrument`).
  const inserted = runs.map((run) => run.rules.length).join("/");
  console.log(
    `[inp] ${max >= GOOD_MS ? "OVER" : "ok  "} ${project} ${scenario}: ${values.map((value) => Math.round(value)).join(" / ")} ms (median ${Math.round(median)}, CPU ${CPU_RATE}×, rules inserted ${inserted})`,
  );
  const out = process.env.PERF_OUT ?? `test-results/inp-${project}.jsonl`;
  mkdirSync(dirname(out), { recursive: true });
  appendFileSync(out, `${JSON.stringify({ project, cpu: CPU_RATE, scenario, runs: values, median, max, worst })}\n`);
}

const field = (page: Page, name: string) => page.locator(`[name="${name}"]`);

/** A rich-text box of the event editor, its fold opened and typed into as a person does. Its tab must be on top. */
async function typeRichText(page: Page, name: string, text: string) {
  const fold = page.locator(`[data-rich-text-fold="${name}"]`);
  if ((await fold.getAttribute("open")) === null) await fold.locator(":scope > summary").click();
  await page.locator(`[data-rich-text="${name}"] [data-field]`).click();
  await page.keyboard.type(text);
}

/** The create page as the owner fills it: both titles and summaries, a description, the day, the place. */
async function fillCreatePage(page: Page, { englishTitle }: { englishTitle: boolean }) {
  const suffix = `perf-${Date.now().toString(36)}`;
  await page.goto("/ro/admin/events/new");
  await hydrated(page);
  await fillDateField(page, "Începutul evenimentului", "2027-09-26");
  await fillTimeField(page, "Ora", "09:00");
  await field(page, "event.locationName").fill("Parcul Tractorul");
  // The meeting point is asked once per language, side by side in the Locul box (§362).
  await field(page, "event.locationNameEn").fill("Parcul Tractorul");
  await field(page, "translations.ro.title").fill(`Ieșire pe traseu ${suffix}`);
  await typeRichText(page, "translations.ro.excerptBody", "O tură relaxată, fără presiune de timp.");
  await languageTab(page, "title", "en").click();
  if (englishTitle) await field(page, "translations.en.title").fill(`Trail outing ${suffix}`);
  await typeRichText(page, "translations.en.excerptBody", "A relaxed run with no time pressure.");
  await openEditorBox(page, "Descrierea evenimentului");
  await typeRichText(page, "translations.ro.body", "Ne împărțim pe grupuri de ritm, iar fiecare grup are ghizi.");
  // Back to the first language, where a person usually leaves it.
  await languageTab(page, "title", "ro").click();
}

test("the event create page: Creează evenimentul, Creează și publică, and a refused press", async ({ page }) => {
  await prepare(page);
  await signIn(page, "Dev Administrator");

  const hold = await holdServerActions(page);
  await record("create: Creează evenimentul (valid)", async () => {
    await fillCreatePage(page, { englishTitle: true });
    const measured = await pressAndMeasure(page, page.getByRole("button", { name: "Creează evenimentul" }));
    await expect(page.getByRole("button", { name: "Se salvează…" })).toBeVisible();
    await hold.abandon();
    return measured;
  });
  await record("create: Creează și publică (valid)", async () => {
    await fillCreatePage(page, { englishTitle: true });
    const measured = await pressAndMeasure(page, page.getByRole("button", { name: "Creează și publică" }));
    // The press opens the question (§384); the answer sends, and is held like the rest.
    await confirmDialog(page, "Creezi și publici evenimentul?");
    await hold.abandon();
    return measured;
  });
  await record("create: Creează evenimentul (EN title empty, refused)", async () => {
    await fillCreatePage(page, { englishTitle: false });
    const measured = await pressAndMeasure(page, page.getByRole("button", { name: "Creează evenimentul" }));
    // The browser refused and the English tab came forward: nothing was posted.
    await expect(languagePanel(page, "title", "en")).toBeVisible();
    expect(hold.held()).toBe(0);
    return measured;
  });
  await hold.abandon();
});

test("the event create page: a keystroke in the title and in the summary", async ({ page }) => {
  await prepare(page);
  await signIn(page, "Dev Administrator");
  await record("create: keystroke in the Romanian title", async () => {
    await fillCreatePage(page, { englishTitle: true });
    await field(page, "translations.ro.title").focus();
    await page.keyboard.press("End");
    return keystrokeAndMeasure(page, "a");
  });
  await record("create: keystroke in the Romanian summary", async () => {
    await fillCreatePage(page, { englishTitle: true });
    await page.locator('[data-rich-text="translations.ro.excerptBody"] [data-field]').click();
    await page.keyboard.press("End");
    return keystrokeAndMeasure(page, "a");
  });
});

test("the event editor: Salvează on the featured event", async ({ page }) => {
  await prepare(page);
  await signIn(page, "Dev Administrator");
  const hold = await holdServerActions(page);
  await record("editor: Salvează (featured event, boxes open)", async () => {
    await page.goto("/ro/admin");
    await page.getByRole("link", { name: FEATURED.title }).first().click();
    await expect(page).toHaveURL(/\/admin\/events\//);
    await hydrated(page);
    // What a person opens to change a date's words: the title and the description.
    await openEditorBox(page, "Titlu și rezumat");
    await field(page, "translations.ro.title").fill(`${FEATURED.title}`);
    await openEditorBox(page, "Descrierea evenimentului");
    await typeRichText(page, "translations.ro.body", " ");
    const acknowledge = field(page, "acknowledgeLiveEdit");
    if (await acknowledge.count()) await acknowledge.check();
    const save = page.getByTestId("event-save-form").getByRole("button", { name: "Salvează", exact: true });
    const measured = await pressAndMeasure(page, save);
    await hold.abandon();
    return measured;
  });
  await hold.abandon();
});

/** Everything the public form requires, minus `omit`. */
async function fillRegistration(page: Page, omit?: string) {
  const values: Record<string, string> = {
    firstName: "Ana",
    lastName: "Popescu",
    email: `perf-inp-${Date.now().toString(36)}@test.invalid`,
    birthDate: "1990-05-17",
    city: "Brașov",
    phone: "+40711111111",
    emergencyContactName: "Ion Popescu",
    emergencyContactPhone: "+40722222222",
  };
  for (const [name, value] of Object.entries(values)) {
    if (name === omit) continue;
    await field(page, name).fill(value);
  }
  await field(page, "emailConfirm").fill(values.email);
  for (const name of ["privacyAcknowledged", "rulesAcknowledged", "fitnessDeclared"]) {
    const box = field(page, name);
    if ((await box.count()) && (await box.isEditable())) await box.check();
  }
}

test("the public registration form: Trimite înscrierea, valid and refused", async ({ page }) => {
  await prepare(page);
  // The one write this file makes, before anything is held: the featured event takes
  // registrations on the site, as every registration spec sets it (a fresh seed does not).
  if (!process.env.PERF_EVENT_SLUG) {
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
  }
  const path = `/ro/evenimente/${process.env.PERF_EVENT_SLUG ?? FEATURED.slug}/inscriere`;
  const hold = await holdServerActions(page);
  await record("register: Trimite înscrierea (valid)", async () => {
    await page.goto(path);
    await hydrated(page);
    await fillRegistration(page);
    const measured = await pressAndMeasure(page, page.getByRole("button", { name: "Trimite înscrierea" }));
    await hold.abandon();
    return measured;
  });
  await record("register: Trimite înscrierea (first name empty, refused)", async () => {
    await page.goto(path);
    await hydrated(page);
    await fillRegistration(page, "firstName");
    const measured = await pressAndMeasure(page, page.getByRole("button", { name: "Trimite înscrierea" }));
    expect(hold.held()).toBe(0);
    return measured;
  });
  await hold.abandon();
});

/** Open every closed fold around `target`, outermost first, as a person would. */
async function openAround(target: Locator) {
  const around = target.locator("xpath=ancestor::details");
  const count = await around.count();
  for (let index = 0; index < count; index += 1) {
    const fold = around.nth(index);
    if ((await fold.getAttribute("open")) === null) await fold.locator(":scope > summary").press("Enter");
  }
}

test("the email wording editor: Salvează textul", async ({ page }) => {
  await prepare(page);
  await signIn(page, "Dev Administrator");
  const hold = await holdServerActions(page);
  await record("emails: Salvează textul", async () => {
    await page.goto("/ro/admin/emails");
    await hydrated(page);
    const editor = page.locator('[data-testid^="email-copy-"]').first();
    await openAround(editor);
    await editor.locator("[name=subject]").fill("Te-ai înscris — mulțumim");
    await editor.locator(".tiptap").first().click();
    await page.keyboard.type(" Ne vedem la start.");
    const measured = await pressAndMeasure(page, editor.getByRole("button", { name: "Salvează textul" }));
    await hold.abandon();
    return measured;
  });
  await hold.abandon();
});

test("the legal document editor: Salvează ciorna", async ({ page }) => {
  await prepare(page);
  await signIn(page, "Dev Superadministrator");
  const hold = await holdServerActions(page);
  await record("legal: Salvează ciorna (new version)", async () => {
    await page.goto("/ro/admin/legal/new");
    await hydrated(page);
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: /Termeni|Terms/ }).click();
    await field(page, "roTitle").fill("Termeni de probă");
    await page.locator(".tiptap").nth(0).click();
    await page.keyboard.type("## Secțiunea 1\n\nUn paragraf de probă.");
    await field(page, "enTitle").fill("Sample terms");
    await page.locator(".tiptap").nth(1).click();
    await page.keyboard.type("## Section 1\n\nA sample paragraph.");
    const measured = await pressAndMeasure(page, page.getByRole("button", { name: "Salvează ciorna" }));
    await hold.abandon();
    return measured;
  });
  await hold.abandon();
});
