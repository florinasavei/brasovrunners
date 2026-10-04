import { lookup } from "node:dns/promises";
import { env } from "@/shared/config/env";
import { type NameProbeStatus, probedHost, probeStatusOf } from "./domain/name-probe";

/**
 * Does the site's public name — `APP_BASE_URL`'s host — still resolve (§NNN)?
 *
 * Asked by the maintenance job at the start of each real run (`registrations/outage-grace.ts`) and by the deep health check, and by
 * nothing else: never the shallow health (which wakes nothing and asks nobody, §577) and never a page
 * or an action a visitor waits on. One lookup through the system's resolver, given at most
 * `timeoutMs`; it never throws — a failure of any kind is an answer (`unknown`), and the caller goes on.
 */
/** `host` is the name asked, or null where nothing is asked (`skipped`). */
export type NameProbe = { status: NameProbeStatus; host: string | null; checkedAt: string };

export const NAME_PROBE_TIMEOUT_MS = 2_500;

export async function probePublicName(
  options: {
    baseUrl?: string;
    appEnv?: string;
    timeoutMs?: number;
    resolve?: (host: string) => Promise<unknown>;
    now?: Date;
  } = {},
): Promise<NameProbe> {
  const checkedAt = (options.now ?? new Date()).toISOString();
  const host = probedHost(options.baseUrl ?? env.APP_BASE_URL, options.appEnv ?? env.APP_ENV);
  if (!host) return { status: "skipped", host: null, checkedAt };
  const resolve = options.resolve ?? ((name: string) => lookup(name, { all: true }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answer = await Promise.race([
      resolve(host).then(
        (): NameProbeStatus => "resolves",
        (error: unknown): NameProbeStatus => probeStatusOf(error),
      ),
      new Promise<NameProbeStatus>((done) => {
        timer = setTimeout(() => done("unknown"), options.timeoutMs ?? NAME_PROBE_TIMEOUT_MS);
      }),
    ]);
    return { status: answer, host, checkedAt };
  } catch {
    return { status: "unknown", host, checkedAt };
  } finally {
    clearTimeout(timer);
  }
}
