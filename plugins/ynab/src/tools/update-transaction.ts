import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getPlanId, syncBudget, syncWrite } from '../ynab-api.js';
import type { RawPayee, RawTransaction } from './schemas.js';
import { mapTransaction, transactionSchema } from './schemas.js';

interface BudgetData {
  be_transactions?: RawTransaction[];
  be_payees?: RawPayee[];
}

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

    const clearedMap: Record<string, string> = { cleared: 'Cleared', uncleared: 'Uncleared', reconciled: 'Reconciled' };
    const flagMap: Record<string, string> = {
      red: 'Red',
      orange: 'Orange',
      yellow: 'Yellow',
      green: 'Green',
      blue: 'Blue',
      purple: 'Purple',
    };

    const budget = await syncBudget<BudgetData>(planId);
    const serverKnowledge = budget.current_server_knowledge ?? 0;
    const existing = budget.changed_entities?.be_transactions?.find(
      t => t.id === params.transaction_id && !t.is_tombstone,
    );
    if (!existing) {
      throw ToolError.notFound(`Transaction not found: ${params.transaction_id}`);
    }

    const changedEntities: Record<string, unknown> = {};

    // Resolve payee: look up existing payee by name, or create a new one
    let payeeId = params.payee_id ?? existing.entities_payee_id ?? null;
    if (params.payee_name && !params.payee_id) {
      const existingPayees = budget.changed_entities?.be_payees ?? [];
      const match = existingPayees.find(
        p => !p.is_tombstone && p.name?.toLowerCase() === params.payee_name!.toLowerCase(),
      );
      if (match?.id) {
        payeeId = match.id;
      } else {
        payeeId = crypto.randomUUID();
        changedEntities.be_payees = [
          {
            id: payeeId,
            is_tombstone: false,
            entities_account_id: null,
            enabled: true,
            auto_fill_subcategory_id: null,
            auto_fill_memo: null,
            auto_fill_amount: 0,
            auto_fill_subcategory_enabled: true,
            auto_fill_memo_enabled: false,
            auto_fill_amount_enabled: false,
            rename_on_import_enabled: true,
            name: params.payee_name,
            internal_name: null,
          },
        ];
      }
    }

    changedEntities.be_transaction_groups = [
      {
        id: params.transaction_id,
        be_transaction: {
          id: params.transaction_id,
          is_tombstone: false,
          entities_account_id: params.account_id,
          entities_payee_id: payeeId,
          entities_subcategory_id: params.category_id ?? existing.entities_subcategory_id ?? null,
          entities_scheduled_transaction_id: null,
          date: params.date ?? existing.date ?? '',
          date_entered_from_schedule: null,
          amount: params.amount !== undefined ? Math.round(params.amount * 1000) : (existing.amount ?? 0),
          cash_amount: 0,
          credit_amount: 0,
          credit_amount_adjusted: 0,
          subcategory_credit_amount_preceding: 0,
          memo: params.memo ?? existing.memo ?? null,
          cleared:
            params.cleared !== undefined
              ? (clearedMap[params.cleared] ?? 'Uncleared')
              : (existing.cleared ?? 'Uncleared'),
          accepted: params.approved ?? existing.accepted ?? true,
          check_number: null,
          flag: params.flag_color ? (flagMap[params.flag_color] ?? null) : (existing.flag ?? null),
          transfer_account_id: existing.transfer_account_id ?? null,
          transfer_transaction_id: null,
          transfer_subtransaction_id: null,
          matched_transaction_id: null,
          ynab_id: existing.ynab_id ?? null,
          imported_payee: existing.imported_payee ?? null,
          imported_date: null,
          original_imported_payee: existing.original_imported_payee ?? null,
          provider_cleansed_payee: null,
          source: existing.source ?? null,
          debt_transaction_type: null,
        },
        be_subtransactions: null,
      },
    ];

    const result = await syncWrite(planId, changedEntities, serverKnowledge);

    const saved = (result as unknown as SaveResponse).changed_entities?.be_transactions?.find(
      t => t.id === params.transaction_id,
    );
    if (!saved) {
      throw ToolError.internal('Transaction was updated but no data was returned');
    }

    return { transaction: mapTransaction(saved) };
  },
});
