import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getPlanId, syncWrite } from '../ynab-api.js';
import type { RawTransaction } from './schemas.js';
import { mapTransaction, transactionSchema } from './schemas.js';

interface SyncResponse {
  changed_entities?: {
    be_transactions?: RawTransaction[];
  };
}

export const createTransaction = defineTool({
  name: 'create_transaction',
  displayName: 'Create Transaction',
  description:
    'Create a new transaction in the active YNAB plan. Amount is in currency units (e.g. -42.50 for a $42.50 expense, 1500 for $1500 income). Negative amounts are outflows (expenses), positive amounts are inflows (income).',
  summary: 'Create a new transaction',
  icon: 'plus',
  group: 'Transactions',
  input: z.object({
    account_id: z.string().min(1).describe('Account ID to create the transaction in'),
    date: z.string().min(1).describe('Transaction date in YYYY-MM-DD format'),
    amount: z
      .number()
      .describe(
        'Amount in currency units (negative for expenses, positive for income). E.g. -42.50 for a $42.50 expense.',
      ),
    payee_name: z.string().optional().describe('Payee name (creates new payee if not found)'),
    payee_id: z.string().optional().describe('Existing payee ID (takes precedence over payee_name)'),
    category_id: z.string().optional().describe('Category ID to assign'),
    memo: z.string().optional().describe('Transaction memo'),
    cleared: z.enum(['cleared', 'uncleared', 'reconciled']).optional().describe('Cleared status (default uncleared)'),
    approved: z.boolean().optional().describe('Whether the transaction is approved (default true)'),
    flag_color: z.enum(['red', 'orange', 'yellow', 'green', 'blue', 'purple']).optional().describe('Flag color'),
  }),
  output: z.object({
    transaction: transactionSchema,
  }),
  handle: async params => {
    const planId = getPlanId();
    const milliunits = Math.round(params.amount * 1000);
    const txId = crypto.randomUUID();

    const transaction: Record<string, unknown> = {
      id: txId,
      entities_account_id: params.account_id,
      date: params.date,
      amount: milliunits,
      cleared: params.cleared ?? 'uncleared',
      accepted: params.approved ?? true,
      memo: params.memo ?? null,
      flag: params.flag_color ?? null,
      entities_payee_id: params.payee_id ?? null,
      payee_name: params.payee_name ?? null,
      entities_subcategory_id: params.category_id ?? null,
      is_tombstone: false,
    };

    const result = await syncWrite(planId, {
      be_transactions: [transaction],
    });

    const saved = (result as unknown as SyncResponse).changed_entities?.be_transactions?.[0];
    if (!saved) {
      throw ToolError.internal('Transaction was created but no data was returned');
    }

    return { transaction: mapTransaction(saved) };
  },
});
