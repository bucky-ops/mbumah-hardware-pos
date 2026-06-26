'use client';

/**
 * JournalEntriesTable — list of journal entries with expandable line items.
 *
 * Extracted from `financial-tab.tsx` to slim down the orchestrator. Renders
 * the journal entries table with status badges, an inline expandable row for
 * line items, and a per-row actions menu (currently just "Void Entry").
 */

import React from 'react';
import {
  ChevronDown, ChevronRight, FileText, FileCheck, Clock, Ban,
  MoreHorizontal, Download,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { formatKES, formatDate, type JournalEntryItem } from '@/lib/api';

import { accountTypeColors } from './shared';

export interface JournalEntriesTableProps {
  journals: JournalEntryItem[];
  isLoading: boolean;
  expandedJournals: Set<string>;
  onToggleExpand: (id: string) => void;
  journalTotalDebit: number;
  journalTotalCredit: number;
  /** Called with the CSV rows when the user clicks Export */
  onExport: () => void;
  /** Called when the user picks "Void Entry" from the row actions menu */
  onVoid: (entry: JournalEntryItem) => void;
}

export function JournalEntriesTable({
  journals,
  isLoading,
  expandedJournals,
  onToggleExpand,
  journalTotalDebit,
  journalTotalCredit,
  onExport,
  onVoid,
}: JournalEntriesTableProps) {
  return (
    <Card className="backdrop-blur-sm bg-card/80 border-border/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" /> Journal Entries
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">{journals.length} entries</Badge>
            {journalTotalDebit > 0 && (
              <div className="flex items-center gap-1 text-[10px]">
                <span className="text-blue-600 font-mono">Dr: {formatKES(journalTotalDebit)}</span>
                <span className="text-muted-foreground">|</span>
                <span className="text-green-600 font-mono">Cr: {formatKES(journalTotalCredit)}</span>
              </div>
            )}
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onExport}>
              <Download className="mr-1 h-3 w-3" /> Export
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : journals.length === 0 ? (
          <div className="py-12 text-center">
            <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-30" />
            <p className="text-sm text-muted-foreground">No journal entries</p>
            <p className="text-xs text-muted-foreground mt-1">Entries will appear when transactions are recorded</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[30px]" />
                  <TableHead>Entry #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {journals.map((je) => (
                  <React.Fragment key={je.id}>
                    <TableRow
                      className={`cursor-pointer hover:bg-muted/50 transition-colors ${je.isVoided ? 'opacity-50' : ''}`}
                      onClick={() => onToggleExpand(je.id)}
                    >
                      <TableCell>
                        {expandedJournals.has(je.id) ? (
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3 w-3 text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-xs bg-muted/50">
                          {je.entryNumber}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{formatDate(je.entryDate)}</TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate">{je.description}</TableCell>
                      <TableCell className="text-sm">{je.referenceType || '—'}</TableCell>
                      <TableCell className="text-right font-medium text-sm font-mono text-blue-600 dark:text-blue-400">
                        {formatKES(je.totalDebit)}
                      </TableCell>
                      <TableCell className="text-right font-medium text-sm font-mono text-green-600 dark:text-green-400">
                        {formatKES(je.totalCredit)}
                      </TableCell>
                      <TableCell>
                        {je.isVoided ? (
                          <Badge className="text-[10px] bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800 gap-1">
                            <Ban className="h-2.5 w-2.5" /> VOIDED
                          </Badge>
                        ) : je.isPosted ? (
                          <Badge className="text-[10px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800 gap-1">
                            <FileCheck className="h-2.5 w-2.5" /> Posted
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] gap-1">
                            <Clock className="h-2.5 w-2.5" /> Draft
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            {!je.isVoided && (
                              <DropdownMenuItem onClick={() => onVoid(je)} className="gap-2 cursor-pointer text-orange-600 focus:text-orange-600">
                                <Ban className="h-4 w-4" /> Void Entry
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                    {expandedJournals.has(je.id) && je.lines && je.lines.length > 0 && (
                      <TableRow>
                        <TableCell colSpan={9} className="bg-muted/20 p-0">
                          <div className="px-12 py-3 space-y-1 animate-in fade-in-0 slide-in-from-top-1 duration-200">
                            <p className="text-xs font-medium text-muted-foreground mb-2">Journal Entry Lines</p>
                            {je.lines.map((line) => (
                              <div key={line.id} className="flex items-center gap-3 text-xs py-1 px-2 rounded hover:bg-muted/30">
                                <span className="font-mono text-muted-foreground w-10">
                                  {line.account?.code || '—'}
                                </span>
                                <span className="flex-1">{line.account?.name || line.accountId}</span>
                                {line.account?.type && (
                                  <Badge
                                    variant="outline"
                                    className={`text-[9px] ${accountTypeColors[line.account.type]?.text || ''}`}
                                  >
                                    {line.account.type}
                                  </Badge>
                                )}
                                <span className="w-28 text-right font-mono text-blue-600 dark:text-blue-400">
                                  {line.debit > 0 ? formatKES(line.debit) : ''}
                                </span>
                                <span className="w-28 text-right font-mono text-green-600 dark:text-green-400">
                                  {line.credit > 0 ? formatKES(line.credit) : ''}
                                </span>
                              </div>
                            ))}
                            <div className="flex items-center gap-3 text-xs pt-2 border-t mt-2 px-2">
                              <span className="w-10" />
                              <span className="flex-1 font-bold text-muted-foreground">Total</span>
                              <span className="w-28 text-right font-mono font-bold text-blue-600 dark:text-blue-400">
                                {formatKES(je.totalDebit)}
                              </span>
                              <span className="w-28 text-right font-mono font-bold text-green-600 dark:text-green-400">
                                {formatKES(je.totalCredit)}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default JournalEntriesTable;
