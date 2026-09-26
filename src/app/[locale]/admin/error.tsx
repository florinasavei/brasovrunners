"use client";

/**
 * The backoffice's error boundary (§NNN). Next requires an `error` file to be a Client Component,
 * so this one line is; the component lives outside the admin route tree
 * (`resilience/ui/AdminErrorPage.tsx`) and takes no data — only the error's digest and `reset`,
 * which is why `tests/privacy/admin-client-boundary.test.ts` names this file as its one exception.
 */
export { default } from "@/modules/resilience/ui/AdminErrorPage";
