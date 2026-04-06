import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getPlanId, syncWrite } from '../ynab-api.js';
import type { RawTransaction } from './schemas.js';
import { mapTransaction, transactionSchema } from './schemas.js';

interface SaveResponse {
  changed_entities?: {
    be_transactions?: RawTransaction[];
  };
}

export const updateTransaction = defineTool({
  name: 'update_transaction',
  displayName: 'Update Transaction',
  description:
    'Update an existing transaction in the active YNAB plan. Only specified fields are changed; omitted fields remain unchanged. Amount is in currency units (negative for expenses, positive for income).',
  summary: 'Update a transaction',
  icon: 'pencil',
  group: 'Transactions',
  input: z.object({
    transaction_id: z.string().min(1).describe('Transaction ID to update'),
    account_id: z.string().min(1).describe('Account ID the transaction belongs to'),
    date: z.string().optional().describe('New transaction date in YYYY-MM-DD format'),
    amount: z.number().optional().describe('New amount in currency units (negative for expenses, positive for income)'),
    payee_name: z.string().optional().describe('New payee name'),
    payee_id: z.string().optional().describe('New payee ID'),
    category_id: z.string().optional().describe('New category ID'),
    memo: z.string().optional().describe('New transaction memo'),
    cleared: z.enum(['cleared', 'uncleared', 'reconciled']).optional().describe('New cleared status'),
    approved: z.boolean().optional().describe('New approval status'),
    flag_color: z.enum(['red', 'orange', 'yellow', 'green', 'blue', 'purple']).optional().describe('New flag color'),
  }),
  output: z.object({
    transaction: transactionSchema,
  }),
  handle: async params => {
    const planId = getPlanId();

    const transaction: Record<string, unknown> = {
      id: params.transaction_id,
      entities_account_id: params.account_id,
    };

    if (params.date !== undefined) transaction.date = params.date;
    if (params.amount !== undefined) transaction.amount = Math.round(params.amount * 1000);
    if (params.payee_name !== undefined) transaction.payee_name = params.payee_name;
    if (params.payee_id !== undefined) transaction.entities_payee_id = params.payee_id;
    if (params.category_id !== undefined) transaction.entities_subcategory_id = params.category_id;
    if (params.memo !== undefined) transaction.memo = params.memo;
    if (params.cleared !== undefined) transaction.cleared = params.cleared;
    if (params.approved !== undefined) transaction.accepted = params.approved;
    if (params.flag_color !== undefined) transaction.flag = params.flag_color;

    const result = await syncWrite(planId, {
      be_transactions: [transaction],
    });

    const saved = (result as unknown as SaveResponse).changed_entities?.be_transactions?.[0];
    if (!saved) {
      throw ToolError.internal('Transaction was updated but no data was returned');
    }

    return { transaction: mapTransaction(saved) };
  },
});
