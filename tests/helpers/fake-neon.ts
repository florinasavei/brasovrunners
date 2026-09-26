/**
 * A Neon API that lives in memory, for the limits card's tests (§335).
 *
 * Nothing in the test suite may call Neon's real API — CI has no key, and a write against the
 * club's projects from a test would be a brake pulled by accident. This answers the four requests
 * `readNeonLimits` and `writeNeonLimits` make, holds the state a PATCH changes, and records every
 * call so a test can assert the exact request shape. `respond` lets a test answer one request
 * differently — a 403 on the write, a 423 on the first try — before the fake's own handling.
 */

export type FakeNeonState = {
  project: Record<string, unknown> & {
    default_endpoint_settings?: Record<string, unknown>;
    settings?: Record<string, unknown> & { quota?: Record<string, unknown> };
  };
  endpoints: Array<Record<string, unknown> & { id: string }>;
  /**
   * The operations log (§NNN), newest first, or absent for a Neon that refuses to show it — the
   * default, so the tests of the brakes read the project row's own counter as they always did.
   */
  operations?: Array<{ action: string; status: string; created_at: string; updated_at?: string }>;
  /**
   * The consumption endpoint's answer, or absent for the project-scoped key the club holds, which
   * Neon refuses outside its project ("not allowed to perform actions outside the project this
   * key is scoped to", 2026-09-26).
   */
  consumption?: unknown;
};

export type FakeNeonCall = {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
  signal: AbortSignal | null;
};

export const FAKE_PROJECT_ID = "quiet-lake-12345678";

/**
 * The shape of production on the evening of 2026-09-23, once its ceiling was lowered and before
 * its 100 CU-hour quota was set (`SETUP.md` §40): one compute at 0.25–1 CU, defaults the same,
 * no quota unless the test asks for one.
 */
export function productionLikeState(overrides: { usedCuHours?: number; quotaCuHours?: number | null; maxCu?: number } = {}): FakeNeonState {
  const maxCu = overrides.maxCu ?? 1;
  return {
    project: {
      id: FAKE_PROJECT_ID,
      compute_time_seconds: Math.round((overrides.usedCuHours ?? 12.34) * 3600),
      active_time_seconds: 40 * 3600,
      consumption_period_start: "2026-09-22T00:00:00Z",
      consumption_period_end: "2026-10-01T00:00:00Z",
      owner: { subscription_type: "launch_v3" },
      default_endpoint_settings: { autoscaling_limit_min_cu: 0.25, autoscaling_limit_max_cu: maxCu, suspend_timeout_seconds: 0 },
      settings: {
        allowed_ips: { ips: [], protected_branches_only: false },
        ...(overrides.quotaCuHours ? { quota: { compute_time_seconds: Math.round(overrides.quotaCuHours * 3600) } } : {}),
      },
    },
    endpoints: [
      { id: "ep-rw-main", type: "read_write", autoscaling_limit_min_cu: 0.25, autoscaling_limit_max_cu: maxCu, current_state: "idle" },
      { id: "ep-ro-replica", type: "read_only", autoscaling_limit_min_cu: 0.25, autoscaling_limit_max_cu: 0.25, current_state: "idle" },
    ],
  };
}

export function fakeNeon(
  state: FakeNeonState,
  respond?: (call: FakeNeonCall, attempt: number) => Response | undefined,
): { fetch: typeof fetch; calls: FakeNeonCall[]; state: FakeNeonState } {
  const calls: FakeNeonCall[] = [];
  const attempts = new Map<string, number>();
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: FakeNeonCall = {
      method: init?.method ?? "GET",
      path: url.pathname.replace(/^\/api\/v2/, ""),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
      signal: init?.signal ?? null,
    };
    calls.push(call);
    const key = `${call.method} ${call.path}`;
    const attempt = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, attempt);
    const override = respond?.(call, attempt);
    if (override) return override;

    const project = `/projects/${FAKE_PROJECT_ID}`;
    if (call.method === "GET" && call.path === project) return json({ project: state.project });
    if (call.method === "GET" && call.path === `${project}/endpoints`) return json({ endpoints: state.endpoints });
    if (call.method === "GET" && call.path === `${project}/operations`) {
      if (!state.operations) return json({ message: "not found" }, 404);
      const limit = Number(url.searchParams.get("limit") ?? 10);
      const from = Number(url.searchParams.get("cursor") ?? 0);
      const page = state.operations.slice(from, from + limit);
      return json({ operations: page, pagination: { cursor: String(from + page.length) } });
    }
    if (call.method === "GET" && call.path === "/consumption_history/v2/projects") {
      if (state.consumption === undefined) return json({ message: "not allowed to perform actions outside the project this key is scoped to" }, 404);
      return json(state.consumption);
    }
    if (call.method === "PATCH" && call.path === project) {
      const patch = (call.body as { project?: Record<string, unknown> }).project ?? {};
      if (patch.default_endpoint_settings) {
        state.project.default_endpoint_settings = { ...state.project.default_endpoint_settings, ...(patch.default_endpoint_settings as object) };
      }
      if (patch.settings) state.project.settings = { ...state.project.settings, ...(patch.settings as object) };
      return json({ project: state.project, operations: [] });
    }
    const endpointPath = call.path.match(/^\/projects\/[^/]+\/endpoints\/([^/]+)$/);
    if (call.method === "PATCH" && endpointPath) {
      const endpoint = state.endpoints.find((candidate) => candidate.id === decodeURIComponent(endpointPath[1]));
      if (!endpoint) return json({ message: "endpoint not found" }, 404);
      Object.assign(endpoint, (call.body as { endpoint?: object }).endpoint ?? {});
      return json({ endpoint, operations: [{ id: "op-1", action: "apply_config", status: "running" }] });
    }
    return json({ message: "not found" }, 404);
  }) as typeof fetch;

  return { fetch: fetchImpl, calls, state };
}

export const NEON_ENV = { NEON_API_KEY: "test-neon-key", NEON_PROJECT_ID: FAKE_PROJECT_ID } as const;

/** A wait that does not wait, recording what it was asked to wait. */
export function instantSleep(): { sleep: (ms: number) => Promise<void>; waited: number[] } {
  const waited: number[] = [];
  return { sleep: async (ms: number) => void waited.push(ms), waited };
}
