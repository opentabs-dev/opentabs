import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { syncBudget, getPlanId } from '../ynab-api.js';
import type { RawSubtransaction, RawTransaction } from './schemas.js';
import { mapSubtransaction, mapTransaction, subtransactionSchema, transactionSchema } from './schemas.js';

interface BudgetData {
  be_transactions?: RawTransaction[];
  be_subtransactions?: RawSubtransaction[];
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

    const allSubs = entities?.be_subtransactions ?? [];
    const subtransactions = allSubs
      .filter(s => s.entities_transaction_id === params.transaction_id && !s.is_tombstone)
      .map(mapSubtransaction);

    return {
      transaction: mapTransaction(tx),
      subtransactions,
    };
  },
});
