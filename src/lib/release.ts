// Single source of truth for release identity (v2.18.2).
// The console footer, /api/health and /api/dashboard all read from here.

export const RELEASE = {
  version: "2.18.2",
  label: process.env.NODE_ENV === "production" ? "v2.18.2" : "v2.18.x-dev",
  commit: "e49f48ec8f1119d71cde324d4453f2cc8b927b0b",
  commitShort: "e49f48ec",
  commits: 282,
  releases: 55,
  tags: 58,
  channel: "stable",
  base: "v2.18.1",
} as const;

export const ORG = {
  name: "Mbumah Hardware",
  tagline: "YOUR BUILDING PARTNER IN JUJA",
  phone1: "0795 191 909",
  phone2: "0759 963 601",
  whatsapp: "0795 191 909",
  email: "mbumahhardware@gmail.com",
  rootDomain: "mbumah.co.ke",
  demoDomain: "mbumahhardware.co.ke",
} as const;

/** Branch codes allowed as subdomains / workspace paths (reserved: www, app, api, admin, static). */
export const RESERVED_SUBDOMAINS = new Set(["www", "app", "api", "admin", "static", "mail"]);
