#!/usr/bin/env node
// MBUMAH HARDWARE POS - Backfill Store.slug / subdomain / brandingColor (v2.16.0)
//
// Production-safe, idempotent backfill for databases created before the
// subdomain-workspaces release. Runs wherever the Prisma client is generated
// (vercel-build chain, ensure-schema self-heal, manual `npm run db:backfill-slugs`).
//
// Strategy:
//   1. Every store missing a slug gets one: slugify(name suffix) with a
//      deterministic map for the five seeded branches (their ids are stable
//      across environments, including production).
//   2. subdomain defaults to the slug (spec: "If subdomain is null, derive
//      it from slug").
//   3. code + brandingColor are set from the same deterministic map when
//      missing (client receipts use both).
//   4. On slug conflicts (shouldn't happen), the row is skipped with a loud
//      warning instead of crashing the deploy.
//
// The script NEVER updates rows that already carry values (idempotent) and
// NEVER deletes anything. Exit 0 on success, 1 on hard failure.

const DETERMINISTIC = {
  store_juja_main: { slug: 'juja-main', code: 'JUJ', brandingColor: '#B45309' },
  store_thika: { slug: 'thika', code: 'THI', brandingColor: '#047857' },
  store_ruiru: { slug: 'ruiru', code: 'RUI', brandingColor: '#9A3412' },
  store_nairobi_cbd: { slug: 'nairobi-cbd', code: 'NAI', brandingColor: '#B91C1C' },
  store_nakuru: { slug: 'nakuru', code: 'NAK', brandingColor: '#BE185D' },
};

const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function slugifyName(name) {
  const suffix = String(name || '').split('-').pop().trim();
  const base = (suffix || String(name || 'store'))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/^-+|-+$/g, '');
  return SUBDOMAIN_PATTERN.test(base) ? base : null;
}

async function main() {
  // Lazy import: the Prisma client is generated for the ACTIVE provider at
  // whatever stage runs this (sqlite locally, postgres on Vercel/Neon).
  let prisma;
  try {
    const mod = await import('@prisma/client');
    prisma = new mod.PrismaClient();
  } catch (err) {
    console.warn('[backfill-slugs] Prisma client unavailable, skipping backfill:', err?.message || err);
    process.exit(0); // soft-skip: never break a deploy that has no client yet
  }

  try {
    const stores = await prisma.store.findMany({
      select: { id: true, name: true, slug: true, subdomain: true, code: true, brandingColor: true },
    });

    let updated = 0;
    for (const store of stores) {
      const planned = DETERMINISTIC[store.id] || {};
      const data = {};

      if (!store.slug) {
        const slug = planned.slug || slugifyName(store.name);
        if (!slug) {
          console.warn(`[backfill-slugs] store ${store.id} (${store.name}): could not derive a slug, skipping`);
          continue;
        }
        data.slug = slug;
      }
      if (!store.subdomain && (data.slug || store.slug)) {
        data.subdomain = planned.slug || data.slug || store.slug;
      }
      if (!store.code && planned.code) data.code = planned.code;
      if (!store.brandingColor && planned.brandingColor) data.brandingColor = planned.brandingColor;

      if (Object.keys(data).length === 0) continue;

      try {
        await prisma.store.update({ where: { id: store.id }, data });
        updated++;
        console.log(`[backfill-slugs] ${store.id}: ${JSON.stringify(data)}`);
      } catch (err) {
        // Unique constraint conflict (P2002) or transient error: warn loudly,
        // continue with the remaining rows.
        console.warn(`[backfill-slugs] store ${store.id} update failed (${err?.code || 'ERR'}):`, err?.message || err);
      }
    }

    console.log(`[backfill-slugs] done. ${updated}/${stores.length} stores updated.`);
    process.exit(0);
  } catch (err) {
    // DB unreachable during a build (CI): soft-skip like sync-db-schema does.
    console.warn('[backfill-slugs] database unavailable, skipping backfill:', err?.message || err);
    process.exit(0);
  } finally {
    await prisma?.$disconnect?.().catch(() => {});
  }
}

main();
