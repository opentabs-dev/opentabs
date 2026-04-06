import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getPlanId, syncBudget, syncWrite } from '../ynab-api.js';
import type { RawPayee, RawTransaction } from './schemas.js';
import { mapTransaction, transactionSchema } from './schemas.js';

interface BudgetData {
  be_payees?: RawPayee[];
}

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
    const changedEntities: Record<string, unknown> = {};

    // Resolve payee: look up existing payee by name, or create a new one
    let payeeId = params.payee_id ?? null;
    if (!payeeId && params.payee_name) {
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
        id: txId,
        be_transaction: {
          id: txId,
          is_tombstone: false,
          entities_account_id: params.account_id,
          entities_payee_id: payeeId,
          entities_subcategory_id: params.category_id ?? null,
          entities_scheduled_transaction_id: null,
          date: params.date,
          date_entered_from_schedule: null,
          amount: milliunits,
          cash_amount: 0,
          credit_amount: 0,
          credit_amount_adjusted: 0,
          subcategory_credit_amount_preceding: 0,
          memo: params.memo ?? null,
          cleared: clearedMap[params.cleared ?? 'uncleared'] ?? 'Uncleared',
          accepted: params.approved ?? true,
          check_number: null,
          flag: params.flag_color ? flagMap[params.flag_color] ?? null : null,
          transfer_account_id: null,
          transfer_transaction_id: null,
          transfer_subtransaction_id: null,
          matched_transaction_id: null,
          ynab_id: null,
          imported_payee: null,
          imported_date: null,
          original_imported_payee: null,
          provider_cleansed_payee: null,
          source: null,
          debt_transaction_type: null,
        },
        be_subtransactions: null,
      },
    ];

    const result = await syncWrite(planId, changedEntities, serverKnowledge);

    const saved = (result as unknown as SyncResponse).changed_entities?.be_transactions?.find(t => t.id === txId);
    if (!saved) {
      throw ToolError.internal('Transaction was created but no data was returned');
    }

    return { transaction: mapTransaction(saved) };
  },
});
