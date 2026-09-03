#!/usr/bin/env node
/**
 * Start the development server on a predictable port, stepping up if it is taken.
 *
 * Why this exists: `next dev` only walks to the next free port when no port was specified.
 * Given an explicit `--port`, it fails with EADDRINUSE instead. We want both — the same URL
 * every day, and no collision when something else is already listening.
 *
 * It also exports APP_BASE_URL matching the port actually chosen. That variable is the single
 * source of every absolute URL the app emits (AGENTS.md §8, BR-REQ-101-02), so a hardcoded
 * value in .env.local would be wrong the moment the port stepped up.
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
function isFree(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    // Bind the same way Next does, so a port free on IPv4 but taken on IPv6 still counts
    // as taken rather than failing later.
    probe.listen(port, "::");
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
    // Wins over .env.local: Next's loader does not overwrite variables already in the
    // environment, so the chosen port and the base URL cannot disagree.
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
