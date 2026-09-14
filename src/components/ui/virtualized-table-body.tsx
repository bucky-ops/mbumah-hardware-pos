'use client';

// ─────────────────────────────────────────────────────────────────────────────
// VirtualizedTableBody — windowed <tbody> for shadcn/ui <Table>
// ─────────────────────────────────────────────────────────────────────────────
//
// v2.6.0 PERF: the Inventory products table and the Transactions table can
// render 200+ rows; browsers choke on the full DOM (layout + paint). This
// generic wrapper uses @tanstack/react-virtual's useVirtualizer to render
// ONLY the rows in (or near) the viewport while keeping normal shadcn
// <TableRow>/<TableCell> markup — column alignment, zebra striping and row
// actions are pixel-identical to the plain map version.
//
// PATTERN (caller side):
//   const scrollRef = useRef<HTMLDivElement | null>(null);
//   ...
//   <div ref={scrollRef} className="max-h-[65vh] overflow-y-auto">
//     <Table>
//       <TableHeader className="sticky top-0 z-10 bg-background">…</TableHeader>
//       <VirtualizedTableBody
//         scrollRef={scrollRef}
//         rows={rows}
//         colSpan={11}
//         renderRow={(row, index, measureRef) => (
//           <TableRow key={row.id} ref={measureRef} data-index={index}>…</TableRow>
//         )}
//       />
//     </Table>
//   </div>
//
// NOTES:
//   • Dynamic row measurement — every rendered row gets
//     ref={virtualizer.measureElement} + data-index so heights are measured
//     after mount (rows may wrap on mobile).
//   • Spacers are real <tr> elements (leading = items[0].start, trailing =
//     remaining body height) so <table> layout math stays native.
//   • rows.length === 0 → renders NOTHING (keep the existing empty state in
//     a separate branch OUTSIDE the virtualizer).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useLayoutEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

export interface VirtualizedTableBodyProps<T> {
  /**
   * Ref to the element that actually SCROLLS (the bounded container wrapping
   * the whole <Table>, e.g. `max-h-[65vh] overflow-y-auto`).
   */
  scrollRef: React.RefObject<HTMLElement | null>;
  /** All rows currently visible (already filtered/sorted by the caller). */
  rows: T[];
  /**
   * Render one row. MUST return a shadcn <TableRow> (or raw <tr>) that:
   *   • spreads `measureRef` onto the row element (`ref={measureRef}`), and
   *   • carries `data-index={index}` so the virtualizer can re-measure it.
   */
  renderRow: (
    row: T,
    index: number,
    measureRef: (el: HTMLTableRowElement | null) => void,
  ) => React.ReactNode;
  /** Estimated row height in px (refined by measureElement). Default 52. */
  estimateSize?: number;
  /** Rows rendered above/below the viewport. Default 8. */
  overscan?: number;
  /**
   * colSpan for the spacer cells — pass the table's total column count so
   * the invisible spacer rows cannot distort auto column widths.
   */
  colSpan?: number;
  /** aria-label for the tbody landmark. */
  'aria-label'?: string;
}

export function VirtualizedTableBody<T>({
  scrollRef,
  rows,
  renderRow,
  estimateSize = 52,
  overscan = 8,
  colSpan = 1,
  'aria-label': ariaLabel,
}: VirtualizedTableBodyProps<T>) {
  const rowCount = rows.length;

  // shadcn <Table> wraps the <table> in its own `div[data-slot=table-container]`
  // (overflow-x-auto). The virtualizer must add that vertical distance between
  // the scroll element and the first row as `scrollMargin`, otherwise rows
  // render offset by the header height (classic TanStack table-in-page issue).
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const scrollEl = scrollRef.current;
    let node: HTMLElement | null = tbodyRef.current;
    if (!scrollEl || !node) return;
    let margin = 0;
    let hops = 0;
    while (node && node !== scrollEl && hops < 10) {
      margin += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
      hops += 1;
    }
    setScrollMargin(margin);
    // Recompute when the row count changes (filters toggle the header chip
    // block above the table, which shifts the offset chain).
  }, [rowCount, scrollRef]);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateSize,
    overscan,
    scrollMargin,
    // Rows keyed by their position in the (already keyed) caller array.
    getItemKey: (index) => index,
  });

  // Empty tables render nothing — the caller keeps its existing empty state
  // (a normal <TableRow> with a colSpan cell) OUTSIDE the virtualizer.
  if (rowCount === 0) return null;

  const items = virtualizer.getVirtualItems();
  const first = items[0];
  const last = items[items.length - 1];
  const paddingTop = first?.start ?? 0;
  const paddingBottom = Math.max(0, virtualizer.getTotalSize() - (last.start + last.size));

  const measureRef = (el: HTMLTableRowElement | null) => {
    if (el) virtualizer.measureElement(el);
  };

  return (
    <tbody ref={tbodyRef} role="rowgroup" aria-label={ariaLabel}>
      {paddingTop > 0 && (
        <tr style={{ height: paddingTop }} aria-hidden="true">
          <td colSpan={colSpan} className="p-0 border-0" />
        </tr>
      )}
      {items.map((virtualRow) =>
        renderRow(rows[virtualRow.index], virtualRow.index, measureRef),
      )}
      {paddingBottom > 0 && (
        <tr style={{ height: paddingBottom }} aria-hidden="true">
          <td colSpan={colSpan} className="p-0 border-0" />
        </tr>
      )}
    </tbody>
  );
}
