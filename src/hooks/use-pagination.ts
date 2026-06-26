'use client';

/**
 * usePagination — pagination state management for client-side lists.
 *
 * Encapsulates the `page` + `pageSize` state pair plus helper calculations
 * (total pages, slice indices, page navigation) so list components don't
 * re-implement this boilerplate.
 */

import { useCallback, useMemo, useState } from 'react';

export interface UsePaginationOptions {
  initialPage?: number;
  initialPageSize?: number;
  /** Total number of items — required to compute totalPages and to clamp the page */
  totalItems: number;
}

export interface UsePaginationResult {
  page: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
  /** Inclusive start index for slicing the source array */
  startIndex: number;
  /** Exclusive end index for slicing the source array */
  endIndex: number;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  canNextPage: boolean;
  canPrevPage: boolean;
  /** Reset to the first page — useful when a filter changes */
  reset: () => void;
}

export function usePagination({
  initialPage = 1,
  initialPageSize = 10,
  totalItems,
}: UsePaginationOptions): UsePaginationResult {
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  // Clamp page if it goes out of bounds (e.g. after a filter shrinks the list)
  const safePage = Math.min(Math.max(1, page), totalPages);

  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);

  const setPageSafe = useCallback(
    (next: number) => {
      setPage(Math.min(Math.max(1, next), totalPages));
    },
    [totalPages],
  );

  const setPageSizeSafe = useCallback((size: number) => {
    setPageSize(size);
    setPage(1);
  }, []);

  const nextPage = useCallback(() => {
    setPage((p) => Math.min(p + 1, totalPages));
  }, [totalPages]);

  const prevPage = useCallback(() => {
    setPage((p) => Math.max(p - 1, 1));
  }, []);

  const reset = useCallback(() => {
    setPage(1);
  }, []);

  return useMemo(
    () => ({
      page: safePage,
      pageSize,
      totalPages,
      totalItems,
      startIndex,
      endIndex,
      setPage: setPageSafe,
      setPageSize: setPageSizeSafe,
      nextPage,
      prevPage,
      canNextPage: safePage < totalPages,
      canPrevPage: safePage > 1,
      reset,
    }),
    [safePage, pageSize, totalPages, totalItems, startIndex, endIndex, setPageSafe, setPageSizeSafe, nextPage, prevPage, reset],
  );
}

export default usePagination;
