'use client';

/**
 * useTableFilters — combined search + sort + pagination state for table views.
 *
 * Wraps `usePagination` and adds a debounced search string plus a single-column
 * sort state. The hook returns the filter state plus a `applyToList` helper
 * that filters + sorts the source array in-place — so callers can simply do:
 *
 *   const filters = useTableFilters({ totalItems: rows.length });
 *   const visible = filters.applyToList(rows, {
 *     search: (r) => r.name,
 *     sortValue: (r) => r.createdAt,
 *   });
 */

import { useCallback, useMemo, useState } from 'react';
import { useDebounce } from './use-debounce';
import { usePagination } from './use-pagination';

export type SortDirection = 'asc' | 'desc';

export interface UseTableFiltersOptions {
  initialSearch?: string;
  initialPageSize?: number;
  initialSortKey?: string;
  initialSortDir?: SortDirection;
  /** Debounce delay in ms for the search string */
  searchDebounceMs?: number;
  /** Total number of items — forwarded to usePagination */
  totalItems: number;
}

export interface ApplyToListOptions<T> {
  /** Predicate / string extractor used to test the search query against each row */
  search?: (row: T) => string | string[];
  /** Value extractor used for sorting; if omitted the list is not sorted */
  sortValue?: (row: T) => string | number;
  /** Optional custom comparator; overrides sortValue if provided */
  compare?: (a: T, b: T) => number;
}

export interface UseTableFiltersResult<T = unknown> {
  // search
  searchInput: string;
  setSearchInput: (value: string) => void;
  search: string;
  // sort
  sortKey: string | undefined;
  sortDir: SortDirection;
  setSort: (key: string, direction?: SortDirection) => void;
  toggleSort: (key: string) => void;
  // pagination (delegated)
  page: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  canNextPage: boolean;
  canPrevPage: boolean;
  reset: () => void;
  /** Apply the current search + sort to a source array and return the filtered result */
  applyToList: (rows: T[], options?: ApplyToListOptions<T>) => T[];
  /** The visible slice of `rows` after applying filters + pagination */
  paginate: (rows: T[]) => T[];
}

export function useTableFilters<T = unknown>({
  initialSearch = '',
  initialPageSize = 10,
  initialSortKey,
  initialSortDir = 'asc',
  searchDebounceMs = 300,
  totalItems,
}: UseTableFiltersOptions): UseTableFiltersResult<T> {
  const [searchInput, setSearchInput] = useState(initialSearch);
  const search = useDebounce(searchInput, searchDebounceMs);

  const [sortKey, setSortKey] = useState<string | undefined>(initialSortKey);
  const [sortDir, setSortDir] = useState<SortDirection>(initialSortDir);

  const setSort = useCallback((key: string, direction?: SortDirection) => {
    setSortKey(key);
    if (direction) setSortDir(direction);
  }, []);

  const toggleSort = useCallback((key: string) => {
    setSortKey((prevKey) => {
      if (prevKey !== key) {
        setSortDir('asc');
        return key;
      }
      setSortDir((prevDir) => (prevDir === 'asc' ? 'desc' : 'asc'));
      return key;
    });
  }, []);

  const applyToList = useCallback(
    (rows: T[], options?: ApplyToListOptions<T>): T[] => {
      let result = rows;
      if (search && options?.search) {
        const q = search.toLowerCase();
        result = result.filter((row) => {
          const value = options.search!(row);
          const arr = Array.isArray(value) ? value : [value];
          return arr.some((v) => v?.toLowerCase?.().includes(q));
        });
      }
      if (options?.compare) {
        result = [...result].sort(options.compare);
      } else if (options?.sortValue && sortKey) {
        const dir = sortDir === 'asc' ? 1 : -1;
        result = [...result].sort((a, b) => {
          const av = options.sortValue!(a);
          const bv = options.sortValue!(b);
          if (typeof av === 'number' && typeof bv === 'number') {
            return (av - bv) * dir;
          }
          return String(av).localeCompare(String(bv)) * dir;
        });
      }
      return result;
    },
    [search, sortKey, sortDir],
  );

  // The pagination hook needs the post-filter count to compute totalPages
  // correctly; callers must update `totalItems` when the filter shrinks the
  // list. For convenience we expose `paginate` here so consumers can chain.
  const pagination = usePagination({ totalItems, initialPageSize });

  const paginate = useCallback(
    (rows: T[]): T[] => rows.slice(pagination.startIndex, pagination.endIndex),
    [pagination.startIndex, pagination.endIndex],
  );

  const reset = useCallback(() => {
    setSearchInput('');
    pagination.reset();
  }, [pagination]);

  return useMemo(
    () => ({
      searchInput,
      setSearchInput,
      search,
      sortKey,
      sortDir,
      setSort,
      toggleSort,
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalPages: pagination.totalPages,
      totalItems: pagination.totalItems,
      setPage: pagination.setPage,
      setPageSize: pagination.setPageSize,
      nextPage: pagination.nextPage,
      prevPage: pagination.prevPage,
      canNextPage: pagination.canNextPage,
      canPrevPage: pagination.canPrevPage,
      reset,
      applyToList,
      paginate,
    }),
    [searchInput, search, sortKey, sortDir, setSort, toggleSort, pagination, reset, applyToList, paginate],
  );
}

export default useTableFilters;
