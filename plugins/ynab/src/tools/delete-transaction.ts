import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getPlanId, syncBudget, syncWrite } from '../ynab-api.js';
import type { BudgetEntities } from './schemas.js';

export const deleteTransaction = defineTool({
  name: 'delete_transaction',
  displayName: 'Delete Transaction',
  description:
    'Delete a transaction from the active YNAB plan. This marks the transaction as deleted (soft delete). Transfer transactions cannot be deleted through this tool — delete them directly in YNAB.',
  summary: 'Delete a transaction',
  icon: 'trash-2',
  group: 'Transactions',
  input: z.object({
    transaction_id: z.string().min(1).describe('Transaction ID to delete'),
    account_id: z.string().min(1).describe('Account ID the transaction belongs to'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the operation succeeded'),
  }),
  handle: async params => {
    const planId = getPlanId();

    const budget = await syncBudget<BudgetEntities>(planId);
    const serverKnowledge = budget.current_server_knowledge ?? 0;
    const existing = budget.changed_entities?.be_transactions?.find(
      t => t.id === params.transaction_id && !t.is_tombstone,
    );
    if (!existing) {
      throw ToolError.notFound(`Transaction not found: ${params.transaction_id}`);
    }

    if (existing.transfer_account_id) {
      throw ToolError.validation('Cannot delete transfer transactions — delete them in YNAB directly.');
    }

    await syncWrite(
      planId,
      {
        be_transaction_groups: [
          {
            id: params.transaction_id,
            be_transaction: {
              ...existing,
              is_tombstone: true,
            },
            be_subtransactions: null,
          },
        ],
      },
      serverKnowledge,
    );

    return { success: true };
  },
});
