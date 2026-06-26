'use client';

/**
 * AccountsList — chart of accounts with group balances + trial balance summary.
 *
 * Extracted from `financial-tab.tsx` to slim down the orchestrator. Renders
 * the chart of accounts grouped by type (ASSET, LIABILITY, EQUITY, REVENUE,
 * EXPENSE) with expandable groups and a trial balance summary footer.
 */

import React from 'react';
import { Landmark, Scale, ChevronDown, ChevronRight } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

import { formatKES, type AccountItem, type JournalEntryItem } from '@/lib/api';

import {
  accountTypeColors,
  accountTypeLabels,
  accountTypeOrder,
} from './shared';

export interface AccountsListProps {
  accounts: AccountItem[];
  journals: JournalEntryItem[];
  /** Accounts grouped by type (e.g. { ASSET: [...], REVENUE: [...] }) */
  groupedAccounts: Record<string, AccountItem[]>;
  /** Set of expanded group types */
  expandedAccountGroups: Set<string>;
  onToggleGroup: (type: string) => void;
  /** Trial balance summary — if totalDebits or totalCredits > 0 the summary renders */
  trialBalance: {
    totalDebits: number;
    totalCredits: number;
    isBalanced: boolean;
  };
}

export function AccountsList({
  accounts,
  journals,
  groupedAccounts,
  expandedAccountGroups,
  onToggleGroup,
  trialBalance,
}: AccountsListProps) {
  return (
    <Card className="backdrop-blur-sm bg-card/80 border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Landmark className="h-4 w-4" /> Chart of Accounts
          </CardTitle>
          <Badge variant="outline" className="text-xs">{accounts.length} accounts</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {accounts.length === 0 ? (
          <div className="text-center py-8">
            <Landmark className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-30" />
            <p className="text-sm text-muted-foreground">No accounts configured</p>
            <p className="text-xs text-muted-foreground mt-1">Accounts will appear after initial setup</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
            {accountTypeOrder.map((type) => {
              const group = groupedAccounts[type];
              if (!group || group.length === 0) return null;
              const colors = accountTypeColors[type] || accountTypeColors.ASSET;
              const isExpanded = expandedAccountGroups.has(type);

              // Calculate group total balance
              const groupBalance = group.reduce((s, a) => {
                const accountDebit = journals.reduce((ds, je) => ds + (je.lines?.filter(l => l.accountId === a.id).reduce((ls, l) => ls + l.debit, 0) || 0), 0);
                const accountCredit = journals.reduce((cs, je) => cs + (je.lines?.filter(l => l.accountId === a.id).reduce((ls, l) => ls + l.credit, 0) || 0), 0);
                return s + (type === 'ASSET' || type === 'EXPENSE' ? accountDebit - accountCredit : accountCredit - accountDebit);
              }, 0);

              return (
                <div key={type} className={`rounded-lg border border-l-4 ${colors.border} overflow-hidden`}>
                  <button
                    type="button"
                    onClick={() => onToggleGroup(type)}
                    className={`flex items-center gap-2 px-3 py-2.5 w-full text-left ${colors.headerBg} hover:opacity-90 transition-opacity`}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <span className="text-sm">{colors.icon}</span>
                    <span className={`text-xs font-bold uppercase tracking-wider ${colors.text}`}>
                      {accountTypeLabels[type] || type}
                    </span>
                    <Badge variant="outline" className={`text-[10px] ml-1 ${colors.bg} ${colors.text} border-0`}>
                      {group.length}
                    </Badge>
                    <span className="ml-auto text-xs font-medium">
                      {groupBalance >= 0 ? '' : '('}{formatKES(Math.abs(groupBalance))}{groupBalance < 0 ? ')' : ''}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="divide-y">
                      {group.map((account) => {
                        // Calculate running balance for this account
                        const accountDebit = journals.reduce((ds, je) => ds + (je.lines?.filter(l => l.accountId === account.id).reduce((ls, l) => ls + l.debit, 0) || 0), 0);
                        const accountCredit = journals.reduce((cs, je) => cs + (je.lines?.filter(l => l.accountId === account.id).reduce((ls, l) => ls + l.credit, 0) || 0), 0);
                        const isDebitAccount = type === 'ASSET' || type === 'EXPENSE';
                        const runningBalance = isDebitAccount ? accountDebit - accountCredit : accountCredit - accountDebit;

                        return (
                          <div key={account.id} className="flex items-center gap-2 px-3 py-2 pl-8 hover:bg-muted/20 transition-colors">
                            <span className="text-xs font-mono text-muted-foreground w-12">{account.code}</span>
                            <span className="text-sm flex-1">{account.name}</span>
                            {account.subType && (
                              <Badge variant="outline" className="text-[9px]">{account.subType}</Badge>
                            )}
                            <div className="flex items-center gap-3 text-xs">
                              {accountDebit > 0 && (
                                <span className="text-blue-600 dark:text-blue-400 font-mono" title="Debit">
                                  Dr: {formatKES(accountDebit)}
                                </span>
                              )}
                              {accountCredit > 0 && (
                                <span className="text-green-600 dark:text-green-400 font-mono" title="Credit">
                                  Cr: {formatKES(accountCredit)}
                                </span>
                              )}
                              <span className={`font-bold font-mono min-w-[80px] text-right ${
                                runningBalance >= 0
                                  ? (type === 'ASSET' || type === 'EXPENSE') ? 'text-foreground' : 'text-foreground'
                                  : 'text-red-600'
                              }`}>
                                {formatKES(Math.abs(runningBalance))}
                                {runningBalance < 0 && ' Cr'}
                              </span>
                            </div>
                            <Badge
                              variant={account.isActive ? 'secondary' : 'outline'}
                              className={`text-[9px] ${account.isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : ''}`}
                            >
                              {account.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                          </div>
                        );
                      })}
                      <div className={`flex items-center gap-2 px-3 py-2 ${colors.headerBg}`}>
                        <span className="text-xs font-bold uppercase tracking-wider pl-8" style={{ flex: 1 }}>
                          Total {accountTypeLabels[type]}: {group.length} account{group.length !== 1 ? 's' : ''}
                        </span>
                        <span className="text-xs font-bold font-mono">
                          {formatKES(Math.abs(groupBalance))}
                          {groupBalance < 0 ? ' Cr' : ''}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Trial Balance Summary */}
        {(trialBalance.totalDebits > 0 || trialBalance.totalCredits > 0) && (
          <div className="mt-4 p-3 rounded-lg border bg-gradient-to-r from-muted/30 to-muted/10">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Scale className="h-3.5 w-3.5" /> Trial Balance Summary
              </p>
              <Badge className={`text-[9px] ${trialBalance.isBalanced ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                {trialBalance.isBalanced ? '✓ Balanced' : '✗ Unbalanced'}
              </Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <div className="text-center flex-1">
                <p className="text-[10px] text-muted-foreground uppercase">Total Debits</p>
                <p className="font-bold text-blue-600 dark:text-blue-400 font-mono">{formatKES(trialBalance.totalDebits)}</p>
              </div>
              <div className="text-center px-4">
                <span className="text-muted-foreground">=</span>
              </div>
              <div className="text-center flex-1">
                <p className="text-[10px] text-muted-foreground uppercase">Total Credits</p>
                <p className="font-bold text-green-600 dark:text-green-400 font-mono">{formatKES(trialBalance.totalCredits)}</p>
              </div>
            </div>
            {!trialBalance.isBalanced && (
              <p className="text-[10px] text-red-500 mt-1 text-center">
                Difference: {formatKES(Math.abs(trialBalance.totalDebits - trialBalance.totalCredits))}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default AccountsList;
