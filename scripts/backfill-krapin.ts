// scripts/backfill-krapin.ts
//
// One-time migration: GUARDRAIL 4 audit patch — Customer KRA PIN encryption.
//
// `prisma db push` renames Customer.kraPin (plaintext, @unique) to kraPinEnc +
// kraPinHash (AES-256-GCM ciphertext + HMAC-SHA256 index). The rename drops the
// column contents, so this script restores the PIN values — captured from the
// live database BEFORE the push (see worklog Task 23) — in encrypted form.
//
// Run AFTER `prisma db push && prisma generate`:
//   bun scripts/backfill-krapin.ts
//
// Idempotent: rows that already carry a kraPinHash are skipped, so re-running
// can never double-encrypt or overwrite a PIN set through the API.
import { PrismaClient } from "@prisma/client";
import { encryptKraPin } from "../src/lib/crypto";

const db = new PrismaClient();

// Captured from the pre-migration database (SELECT name, kraPin FROM Customer).
const KNOWN_PINS: ReadonlyArray<{ name: string; pin: string | null }> = [
  { name: "Kamau Construction Ltd", pin: "P051988776Q" },
  { name: "Njeri Developers", pin: "P051345678Y" },
  { name: "Blue Valley Contractors", pin: null },
  { name: "Ochieng Building Works", pin: "A009876543Z" },
  { name: "Walk-in Retail", pin: null },
  { name: "Tumaini Housing Project", pin: "P051654321M" },
  { name: "Test Hardware Ltd", pin: "A012345678Z" },
  { name: "Zawadi Metal Works", pin: "P012345678Z" },
];

async function main(): Promise<void> {
  const customers = await db.customer.findMany({ select: { id: true, name: true, kraPinHash: true } });
  let restored = 0;
  let skipped = 0;
  let untouched = 0;

  for (const c of customers) {
    const known = KNOWN_PINS.find((k) => k.name === c.name);
    if (!known) {
      // Customer created after the migration — its PIN (if any) was written
      // encrypted by the patched API paths; nothing to do.
      untouched += 1;
      continue;
    }
    if (c.kraPinHash) {
      skipped += 1; // already migrated / re-run
      continue;
    }
    if (!known.pin) {
      untouched += 1; // known row, never had a PIN
      continue;
    }
    const sealed = encryptKraPin(known.pin);
    if (!sealed) continue;
    await db.customer.update({
      where: { id: c.id },
      data: { kraPinEnc: sealed.enc, kraPinHash: sealed.hash },
    });
    restored += 1;
    console.log(`✔ encrypted KRA PIN for "${c.name}"`);
  }

  console.log(
    `backfill complete — restored: ${restored}, already-done: ${skipped}, no-PIN: ${untouched}`
  );
}

main()
  .catch((err) => {
    console.error("backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
