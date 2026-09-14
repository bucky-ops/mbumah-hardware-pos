import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas for /api/inventory/adjust (strict request validation).
//
// NOTE ON IDS: Prisma ids in this project are cuid()s (@default(cuid())) —
// NOT UUIDs. They are therefore validated as opaque strings (length bounds
// only). A z.uuid()/regex format check would reject perfectly valid cuids
// such as "cmczh6xqf0000uxqvh8n2k3p" and would couple this schema to an
// implementation detail; an unknown id is handled authoritatively by the
// database (P2025 → 404 via the shared error mapper).
// ─────────────────────────────────────────────────────────────────────────────

const productId = z
  .string()
  .min(1, "productId is required")
  .max(64, "productId is too long");

export const adjustSchema = z
  .object({
    productId,
    // Direction is carried by `type`; quantity is the requested magnitude and
    // must never be zero (a no-op adjustment would pollute the stock ledger).
    quantity: z
      .number()
      .int({ message: "quantity must be a whole number" })
      .refine((v) => v !== 0, "quantity must be non-zero"),
    type: z.enum(["INCREMENT", "DECREMENT"]),
    // Required (3–255 chars) when type = DECREMENT — every non-sale stock-out
    // must be explainable for the audit trail. Optional for INCREMENT.
    reason: z
      .string()
      .min(3, "reason must be at least 3 characters")
      .max(255, "reason must be at most 255 characters")
      .optional(),
    // Purchase cost of incoming stock → moving-average-cost recalculation.
    // Only meaningful for INCREMENT (enforced in superRefine below).
    unitCost: z.number().min(0, "unitCost must be non-negative").optional(),
    reference: z.string().max(100, "reference must be at most 100 characters").optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "DECREMENT") {
      const reason = v.reason?.trim() ?? "";
      if (reason.length < 3) {
        ctx.addIssue({
          code: "custom",
          path: ["reason"],
          message: "reason (3–255 characters) is required for DECREMENT adjustments",
        });
      }
      if (v.unitCost !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["unitCost"],
          message: "unitCost applies to INCREMENT adjustments only",
        });
      }
    }
    if (v.type === "INCREMENT" && v.unitCost === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["unitCost"],
        message: "unitCost is required for INCREMENT adjustments",
      });
    }
  });

export type AdjustInput = z.infer<typeof adjustSchema>;
