import { z } from "zod";

// src/lib/validations/stocktake.ts
//
// Zod schemas for the stocktake (count-sheet) endpoints:
//   POST   /api/v1/stocktake            → createStocktakeSchema
//   PATCH  /api/v1/stocktake/[id]       → patchStocktakeSchema (save counts / cancel)
//   POST   /api/v1/stocktake/[id]/close → closeStocktakeSchema
//
// NOTE ON IDS: Prisma ids in this project are cuid()s — NOT UUIDs. They are
// validated as opaque strings (length bounds only); an unknown id is handled
// authoritatively by the database (P2025 → 404 via the shared error mapper).
//
// QTY DISCIPLINE: counted quantities arrive as NUMBERS from the count-sheet UI
// but may be fractional (KG/M/FT/LTR units). They are bounded to [0, 1,000,000]
// and clamped/rounded server-side with Decimal.js (3dp, ROUND_HALF_UP) before
// touching the database. Negative counts are always rejected — a count of
// "nothing on the shelf" is 0, not −2.

/** Non-negative quantity, finite, bounded. Numbers only from the wire. */
const countedQty = z
  .number({ message: "countedQty must be a number" })
  .min(0, "countedQty must be ≥ 0")
  .max(1_000_000, "countedQty is implausibly large")
  .finite();

export const createStocktakeSchema = z
  .object({
    // Optional for OWNER (may snapshot any branch); non-OWNER sessions are
    // BOLA-fenced to their own branch server-side regardless of this value.
    branchId: z.string().min(1).max(64).optional(),
    // Optional scope: snapshot only one category. null/undefined = whole branch.
    category: z.string().min(1).max(80).nullable().optional(),
    note: z.string().min(3).max(255).optional(),
  })
  .strict();

/** One counted line. itemId is the StocktakeItem id, NOT the product id. */
export const countedLineSchema = z.object({
  itemId: z.string().min(1, "itemId is required").max(64),
  countedQty,
  note: z.string().max(255).optional(),
});

export const patchStocktakeSchema = z
  .object({
    action: z.enum(["SAVE_COUNTS", "CANCEL"]).default("SAVE_COUNTS"),
    // Required for SAVE_COUNTS (may be an empty array — saving zero rows is a
    // no-op, not an error, so a blank sheet can still update its timestamp);
    // ignored for CANCEL.
    items: z.array(countedLineSchema).max(2000).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.action === "SAVE_COUNTS") {
      const ids = new Set<string>();
      for (const [i, line] of v.items.entries()) {
        if (ids.has(line.itemId)) {
          ctx.addIssue({
            code: "custom",
            path: ["items", i, "itemId"],
            message: `duplicate itemId ${line.itemId} in the batch`,
          });
        }
        ids.add(line.itemId);
      }
    }
  });

export const closeStocktakeSchema = z.object({}).strict();

export type CreateStocktakeInput = z.infer<typeof createStocktakeSchema>;
export type PatchStocktakeInput = z.infer<typeof patchStocktakeSchema>;
export type CountedLineInput = z.infer<typeof countedLineSchema>;
