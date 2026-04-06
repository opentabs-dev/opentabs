import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { syncBudget, getPlanId } from '../ynab-api.js';
import type { RawAccount, RawCategory, RawPayee, RawSubtransaction, RawTransaction } from './schemas.js';
import { buildLookups, mapSubtransaction, mapTransaction, subtransactionSchema, transactionSchema } from './schemas.js';

interface BudgetData {
  be_transactions?: RawTransaction[];
  be_subtransactions?: RawSubtransaction[];
  be_payees?: RawPayee[];
  be_accounts?: RawAccount[];
  be_subcategories?: RawCategory[];
}

export const getTransaction = defineTool({
  name: 'get_transaction',
  displayName: 'Get Transaction',
  description:
    'Get details for a specific transaction by its ID. Returns full transaction data including any split subtransactions.',
  summary: 'Get transaction details by ID',
  icon: 'receipt',
  group: 'Transactions',
  input: z.object({
    transaction_id: z.string().min(1).describe('Transaction ID to retrieve'),
  }),
  output: z.object({
    transaction: transactionSchema,
    subtransactions: z.array(subtransactionSchema).describe('Split subtransactions (empty if not a split)'),
  }),
  handle: async params => {
    const planId = getPlanId();
    const result = await syncBudget<BudgetData>(planId);

    const entities = result.changed_entities;
    const raw = entities?.be_transactions ?? [];
    const tx = raw.find(t => t.id === params.transaction_id && !t.is_tombstone);

    if (!tx) {
      throw ToolError.notFound(`Transaction not found: ${params.transaction_id}`);
    }

    const lookups = buildLookups(entities ?? {});
    const allSubs = entities?.be_subtransactions ?? [];
    const subtransactions = allSubs
      .filter(s => s.entities_transaction_id === params.transaction_id && !s.is_tombstone)
      .map(s => mapSubtransaction(s, lookups));

    return {
      transaction: mapTransaction(tx, lookups),
      subtransactions,
    };
  },
});
