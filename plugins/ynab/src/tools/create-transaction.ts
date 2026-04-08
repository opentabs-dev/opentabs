import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getPlanId, syncBudget, syncWrite } from '../ynab-api.js';
import type { BudgetEntities } from './schemas.js';
import {
  buildLookups,
  CLEARED_MAP,
  FLAG_MAP,
  mapTransaction,
  resolvePayee,
  toMilliunits,
  transactionSchema,
} from './schemas.js';

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
    const milliunits = toMilliunits(params.amount);
    const txId = crypto.randomUUID();
    const budget = await syncBudget<BudgetEntities>(planId);
    const serverKnowledge = budget.current_server_knowledge ?? 0;
    const lookups = buildLookups(budget.changed_entities ?? {});
    const changedEntities: Record<string, unknown> = {};

    let payeeId = params.payee_id ?? null;
    if (!payeeId && params.payee_name) {
      const resolved = resolvePayee(budget.changed_entities?.be_payees ?? [], params.payee_name);
      payeeId = resolved.payeeId;
      if (resolved.newPayee) {
        changedEntities.be_payees = [resolved.newPayee];
        lookups.payees.set(resolved.payeeId, params.payee_name);
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
          // cash_amount and credit_amount are server-computed splits the account
          // type determines. Captured from a credit card account create where
          // YNAB's UI sent zeros and the server populated them on response —
          // not yet verified for cash/checking accounts but likely the same
          // pattern.
          cash_amount: 0,
          credit_amount: 0,
          credit_amount_adjusted: 0,
          subcategory_credit_amount_preceding: 0,
          memo: params.memo ?? null,
          cleared: CLEARED_MAP[params.cleared ?? 'uncleared'],
          // YNAB's wire format calls this "accepted"; the public tool surface uses "approved".
          accepted: params.approved ?? true,
          check_number: null,
          flag: params.flag_color ? FLAG_MAP[params.flag_color] : null,
          transfer_account_id: null,
          transfer_transaction_id: null,
          transfer_subtransaction_id: null,
          matched_transaction_id: null,
          ynab_id: null,
          // Import-related fields are only populated by bank-feed imports, not manual entry.
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

    const result = await syncWrite<BudgetEntities>(planId, changedEntities, serverKnowledge);

    const saved = result.changed_entities?.be_transactions?.find(t => t.id === txId);
    if (!saved) {
      throw ToolError.internal('Transaction was created but no data was returned');
    }

    return { transaction: mapTransaction(saved, lookups) };
  },
});
