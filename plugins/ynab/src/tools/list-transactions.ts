import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { syncBudget, getPlanId } from '../ynab-api.js';
import type { RawTransaction } from './schemas.js';
import { mapTransaction, transactionSchema } from './schemas.js';

interface BudgetData {
  be_transactions?: RawTransaction[];
}

export const listTransactions = defineTool({
  name: 'list_transactions',
  displayName: 'List Transactions',
  description:
    'List transactions in the active YNAB plan. Returns all transactions sorted by date (newest first). Optionally filter by account ID. Results include amount, payee, category, cleared status, and memo.',
  summary: 'List budget transactions',
  icon: 'receipt',
  group: 'Transactions',
  input: z.object({
    account_id: z.string().optional().describe('Filter by account ID. Omit to list all transactions.'),
    since_date: z
      .string()
      .optional()
      .describe('Only return transactions on or after this date (YYYY-MM-DD). Omit for all transactions.'),
    until_date: z
      .string()
      .optional()
      .describe('Only return transactions on or before this date (YYYY-MM-DD). Combine with since_date for a date range.'),
  }),
  output: z.object({
    transactions: z.array(transactionSchema).describe('List of transactions'),
  }),
  handle: async params => {
    const planId = getPlanId();
    const result = await syncBudget<BudgetData>(planId);

    const raw = result.changed_entities?.be_transactions ?? [];

    let transactions = raw.filter(t => !t.is_tombstone).map(mapTransaction);

    if (params.account_id) {
      transactions = transactions.filter(t => t.account_id === params.account_id);
    }

    if (params.since_date) {
      const sinceDate = params.since_date;
      transactions = transactions.filter(t => t.date >= sinceDate);
    }

    if (params.until_date) {
      const untilDate = params.until_date;
      transactions = transactions.filter(t => t.date <= untilDate);
    }

    // Sort by date descending
    transactions.sort((a, b) => b.date.localeCompare(a.date));

    return { transactions };
  },
});
