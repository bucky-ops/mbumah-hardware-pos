// Weighted Average Cost (WAC) unit tests.
//
// `calculateWeightedAverageCost` is a pure function — no DB, no I/O — so these
// tests are fast (microsecond-level) and hermetic. They cover the IAS 2
// invariants plus the edge cases that have bitten real-world WAC
// implementations:
//
//   1. Standard blend: existing 100 @ 10 + incoming 50 @ 13 → 150 @ 11.00
//   2. First-ever reception (zero current stock) → WAC = incoming unit cost
//   3. Zero incoming quantity → WAC unchanged (no division by zero)
//   4. Issuance (negative incoming) → WAC unchanged, quantity reduces
//   5. Issuance that would drive stock negative → throws
//   6. Issuing from an empty shelf → throws
//   7. Floating-point precision: 1/3-style divisions round to 4 DP cleanly
//   8. Guardrails: negative currentStock / currentWac / incomingUnitCost throw
//   9. Multiple successive receptions converge to the textbook WAC
//  10. totalValue invariant: newStock × newWac ≈ sum of constituent values
import { describe, it, expect } from 'vitest';
import { calculateWeightedAverageCost } from '@/lib/account-helper';

describe('calculateWeightedAverageCost — IAS 2 inventory valuation', () => {
  // ─────────────────────────────────────────────────────────────────────
  // 1. Standard blend — the textbook case.
  // ─────────────────────────────────────────────────────────────────────
  it('blends the existing WAC with the incoming unit cost weighted by quantity', () => {
    // Existing: 100 units @ Ksh 10 = Ksh 1,000
    // Incoming:  50 units @ Ksh 13 = Ksh   650
    // Blended:  150 units            = Ksh 1,650 → Ksh 11.00 / unit
    const result = calculateWeightedAverageCost({
      currentStock: 100,
      currentWac: 10,
      incomingStock: 50,
      incomingUnitCost: 13,
    });

    expect(result.newStock).toBe(150);
    expect(result.newWac).toBe(11);
    expect(result.totalValue).toBe(1650);
  });

  // ─────────────────────────────────────────────────────────────────────
  // 2. First-ever reception — zero current stock → WAC = incoming cost.
  // ─────────────────────────────────────────────────────────────────────
  it('adopts the incoming unit cost as the WAC when the shelf is empty (first reception)', () => {
    const result = calculateWeightedAverageCost({
      currentStock: 0,
      currentWac: 0,
      incomingStock: 200,
      incomingUnitCost: 7.5,
    });

    expect(result.newStock).toBe(200);
    expect(result.newWac).toBe(7.5);
    expect(result.totalValue).toBe(1500);
  });

  // ─────────────────────────────────────────────────────────────────────
  // 3. Zero incoming quantity — WAC unchanged, no division by zero.
  // ─────────────────────────────────────────────────────────────────────
  it('leaves the WAC unchanged when the incoming quantity is zero (no movement)', () => {
    const result = calculateWeightedAverageCost({
      currentStock: 80,
      currentWac: 12.5,
      incomingStock: 0,
      incomingUnitCost: 99, // should be ignored
    });

    expect(result.newStock).toBe(80);
    expect(result.newWac).toBe(12.5);
    expect(result.totalValue).toBe(1000); // 80 × 12.5
  });

  // ─────────────────────────────────────────────────────────────────────
  // 4. Issuance (negative incoming) — WAC unchanged, quantity reduces.
  // ─────────────────────────────────────────────────────────────────────
  it('keeps the WAC constant when stock is issued (negative incoming) and reduces quantity', () => {
    const result = calculateWeightedAverageCost({
      currentStock: 100,
      currentWac: 10,
      incomingStock: -30,
      incomingUnitCost: 0, // ignored for issuances
    });

    expect(result.newStock).toBe(70);
    expect(result.newWac).toBe(10);
    expect(result.totalValue).toBe(700);
  });

  // ─────────────────────────────────────────────────────────────────────
  // 5. Issuance that would drive stock negative → throws.
  // ─────────────────────────────────────────────────────────────────────
  it('throws when an issuance would drive on-hand stock below zero', () => {
    expect(() =>
      calculateWeightedAverageCost({
        currentStock: 10,
        currentWac: 5,
        incomingStock: -25, // would leave -15
        incomingUnitCost: 0,
      }),
    ).toThrow(/negative/i);
  });

  // ─────────────────────────────────────────────────────────────────────
  // 6. Issuing from an empty shelf → throws.
  // ─────────────────────────────────────────────────────────────────────
  it('throws when trying to issue stock from a product with zero on-hand', () => {
    expect(() =>
      calculateWeightedAverageCost({
        currentStock: 0,
        currentWac: 0,
        incomingStock: -5,
        incomingUnitCost: 0,
      }),
    ).toThrow(/0 on-hand|cannot issue/i);
  });

  // ─────────────────────────────────────────────────────────────────────
  // 7. Floating-point precision — 4 DP rounding prevents drift.
  // ─────────────────────────────────────────────────────────────────────
  it('rounds the blended WAC to 4 decimal places to prevent binary-float drift', () => {
    // 100 @ 10.001 + 3 @ 3.3333 = 1000.1 + 9.9999 = 1010.0999 over 103
    // → 9.806795... rounds to 9.8068 at 4 DP.
    const result = calculateWeightedAverageCost({
      currentStock: 100,
      currentWac: 10.001,
      incomingStock: 3,
      incomingUnitCost: 3.3333,
    });

    expect(result.newStock).toBe(103);
    // 4 DP — no trailing float noise.
    expect(result.newWac).toBe(9.8068);
    // totalValue = sum of constituent values, rounded to 4 DP.
    expect(result.totalValue).toBe(1010.0999);
  });

  it('handles non-terminating decimal divisions without accumulating float error', () => {
    // 3 units @ 1.00 + 3 units @ 2.00 = 9.00 / 6 = 1.5 exactly.
    // But 7 units @ 1.00 + 7 units @ 2.00 = 21.00 / 14 = 1.5 exactly too.
    // Use a genuinely non-terminating case: 1 @ 1 + 2 @ 2 = 5/3 = 1.6667
    const result = calculateWeightedAverageCost({
      currentStock: 1,
      currentWac: 1,
      incomingStock: 2,
      incomingUnitCost: 2,
    });

    expect(result.newStock).toBe(3);
    expect(result.newWac).toBe(1.6667); // 1.66666... rounded to 4 DP
    expect(result.totalValue).toBe(5);
  });

  // ─────────────────────────────────────────────────────────────────────
  // 8. Guardrails — negative inputs throw.
  // ─────────────────────────────────────────────────────────────────────
  it('throws when currentStock is negative (prior stockout corruption)', () => {
    expect(() =>
      calculateWeightedAverageCost({
        currentStock: -5,
        currentWac: 10,
        incomingStock: 20,
        incomingUnitCost: 8,
      }),
    ).toThrow(/currentStock/);
  });

  it('throws when currentWac is negative (data corruption)', () => {
    expect(() =>
      calculateWeightedAverageCost({
        currentStock: 50,
        currentWac: -3,
        incomingStock: 10,
        incomingUnitCost: 5,
      }),
    ).toThrow(/currentWac/);
  });

  it('throws when incomingUnitCost is negative (impossible purchase)', () => {
    expect(() =>
      calculateWeightedAverageCost({
        currentStock: 50,
        currentWac: 5,
        incomingStock: 10,
        incomingUnitCost: -2,
      }),
    ).toThrow(/incomingUnitCost/);
  });

  // ─────────────────────────────────────────────────────────────────────
  // 9. Successive receptions converge to the textbook WAC.
  // ─────────────────────────────────────────────────────────────────────
  it('converges correctly across multiple successive receptions', () => {
    // Reception 1: 100 @ 10
    let state = calculateWeightedAverageCost({
      currentStock: 0,
      currentWac: 0,
      incomingStock: 100,
      incomingUnitCost: 10,
    });
    expect(state.newStock).toBe(100);
    expect(state.newWac).toBe(10);

    // Reception 2: +50 @ 13 → 150 @ 11
    state = calculateWeightedAverageCost({
      currentStock: state.newStock,
      currentWac: state.newWac,
      incomingStock: 50,
      incomingUnitCost: 13,
    });
    expect(state.newStock).toBe(150);
    expect(state.newWac).toBe(11);

    // Reception 3: +150 @ 14 → 300 @ ((150×11) + (150×14)) / 300 = 12.5
    state = calculateWeightedAverageCost({
      currentStock: state.newStock,
      currentWac: state.newWac,
      incomingStock: 150,
      incomingUnitCost: 14,
    });
    expect(state.newStock).toBe(300);
    expect(state.newWac).toBe(12.5);
    expect(state.totalValue).toBe(3750);
  });

  // ─────────────────────────────────────────────────────────────────────
  // 10. totalValue invariant — newStock × newWac ≈ constituent sum.
  // ─────────────────────────────────────────────────────────────────────
  it('preserves the total value invariant (totalValue ≈ Σ constituent values)', () => {
    const currentStock = 250;
    const currentWac = 17.3456;
    const incomingStock = 175;
    const incomingUnitCost = 21.789;

    const result = calculateWeightedAverageCost({
      currentStock,
      currentWac,
      incomingStock,
      incomingUnitCost,
    });

    const expectedTotalValue =
      currentStock * currentWac + incomingStock * incomingUnitCost;

    // totalValue reported by the helper must match the raw sum (4 DP).
    expect(result.totalValue).toBeCloseTo(expectedTotalValue, 4);

    // newStock × newWac reconstructs the same total — but because newWac is
    // rounded to 4 DP, the reconstruction can drift by up to
    // newStock × 0.00005 (here: 425 × 0.00005 ≈ 0.02). We allow a 5-cent
    // tolerance which comfortably absorbs the 4-DP rounding ceiling while
    // still catching genuine logic errors.
    expect(Math.abs(result.newStock * result.newWac - expectedTotalValue)).toBeLessThan(0.05);
  });

  // ─────────────────────────────────────────────────────────────────────
  // 11. Issuance at scale — issuing ALL stock leaves WAC at the old value
  //     but totalValue = 0 (no leftover inventory to value).
  // ─────────────────────────────────────────────────────────────────────
  it('handles a full stock-out issuance (issue 100% of on-hand) leaving totalValue at 0', () => {
    const result = calculateWeightedAverageCost({
      currentStock: 500,
      currentWac: 8.25,
      incomingStock: -500,
      incomingUnitCost: 0,
    });

    expect(result.newStock).toBe(0);
    expect(result.newWac).toBe(8.25); // WAC preserved for the next reception reference
    expect(result.totalValue).toBe(0);
  });
});
