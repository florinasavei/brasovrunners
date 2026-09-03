import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

// Next.js 16 renamed middleware.ts to proxy.ts; the runtime is Node.js only.
// Redirects `/` and unprefixed paths to the default locale and negotiates `ro` / `en`.
export default createMiddleware(routing);

export const config = {
  // Everything except API routes, Next internals, Vercel internals, and files with an extension.
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
