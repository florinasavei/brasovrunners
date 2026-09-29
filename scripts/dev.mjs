#!/usr/bin/env node
/**
 * Start the development server on a predictable port, stepping up if it is taken.
 *
 * `next dev --port` fails with EADDRINUSE instead of stepping up. APP_BASE_URL is exported to
 * match the port chosen (AGENTS.md §8, BR-REQ-101-02).
 *
 * Usage: yarn dev            start at the base port, or the next free one
 *        DEV_PORT=50000 yarn dev   start somewhere else
 */

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import process from "node:process";

// Deliberately far from 3000, 5173, 8000, 8080 so it does not collide with other projects.
const BASE_PORT = Number(process.env.DEV_PORT ?? 47821);
const ATTEMPTS = 20;

/** Resolves true when nothing is listening on the port. */
function isFree(port, host = "::") {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", (error) => {
      // A host without IPv6 (the Claude Code on the web container) refuses "::" for every
      // port; there Next binds IPv4 too, so probe that instead.
      if (error.code === "EAFNOSUPPORT" && host === "::") resolve(isFree(port, "0.0.0.0"));
      else resolve(false);
    });
    probe.once("listening", () => probe.close(() => resolve(true)));
    // Bind as Next does, so a port taken on IPv6 only counts as taken.
    probe.listen(port, host);
  });
}

async function findPort() {
  for (let port = BASE_PORT; port < BASE_PORT + ATTEMPTS; port += 1) {
    if (await isFree(port)) return port;
  }
  throw new Error(
    `No free port between ${BASE_PORT} and ${BASE_PORT + ATTEMPTS - 1}. ` +
      "Something is holding a wide range; check with `netstat -ano`.",
  );
}

const port = await findPort();
if (port !== BASE_PORT) {
  console.log(`port ${BASE_PORT} is in use — starting on ${port} instead`);
}

const child = spawn("next", ["dev", "--port", String(port)], {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    PORT: String(port),
    // Wins over .env.local: Next's loader does not overwrite the environment.
    APP_BASE_URL: `http://localhost:${port}`,
  },
});

// Forward Ctrl+C so the child shuts down rather than being orphaned.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
