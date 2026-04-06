import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { syncBudget, getPlanId } from '../ynab-api.js';
import type { BudgetEntities } from './schemas.js';
import { buildLookups, mapTransaction, transactionSchema } from './schemas.js';

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
    const result = await syncBudget<BudgetEntities>(planId);

    const entities = result.changed_entities;
    const raw = entities?.be_transactions ?? [];
    const lookups = buildLookups(entities ?? {});

    // Filter on raw data before mapping to avoid unnecessary work
    let filtered = raw.filter(t => !t.is_tombstone);

    if (params.account_id) {
      filtered = filtered.filter(t => t.entities_account_id === params.account_id);
    }

    if (params.since_date) {
      const sinceDate = params.since_date;
      filtered = filtered.filter(t => (t.date ?? '') >= sinceDate);
    }

    if (params.until_date) {
      const untilDate = params.until_date;
      filtered = filtered.filter(t => (t.date ?? '') <= untilDate);
    }

    const transactions = filtered
      .map(t => mapTransaction(t, lookups))
      .sort((a, b) => b.date.localeCompare(a.date));

    return { transactions };
  },
});
