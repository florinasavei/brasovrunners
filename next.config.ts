import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // Nothing host-specific belongs here. The app must run with `npm run build && npm start`
  // on any Node host honouring PORT (BR-REQ-101-01); Vercel is an adapter, not a dependency.
};

// Looks for src/i18n/request.ts by default.
const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
