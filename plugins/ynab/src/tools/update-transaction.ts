import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getPlanId, syncBudget, syncWrite } from '../ynab-api.js';
import type { BudgetEntities, ClearedStatus, FlagColor } from './schemas.js';
import {
  buildLookups,
  CLEARED_MAP,
  FLAG_MAP,
  mapTransaction,
  resolvePayee,
  toMilliunits,
  transactionSchema,
} from './schemas.js';

const resolveFlag = (requested: FlagColor | 'none' | undefined, existing: string | null | undefined): string | null => {
  if (requested === 'none') return null;
  if (requested) return FLAG_MAP[requested];
  return existing ?? null;
};

const resolveCleared = (requested: ClearedStatus | undefined, existing: string | null | undefined): string => {
  if (requested) return CLEARED_MAP[requested];
  return existing ?? 'Uncleared';
};

export const updateTransaction = defineTool({
  name: 'update_transaction',
  displayName: 'Update Transaction',
  description:
    'Update an existing transaction in the active YNAB plan. Only specified fields are changed; omitted fields remain unchanged. Amount is in currency units (negative for expenses, positive for income). Transfers and split transactions cannot be updated through this tool — edit them directly in YNAB.',
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
    flag_color: z
      .enum(['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'none'])
      .optional()
      .describe('New flag color (pass "none" to clear)'),
  }),
  output: z.object({
    transaction: transactionSchema,
  }),
  handle: async params => {
    const planId = getPlanId();

    const budget = await syncBudget<BudgetEntities>(planId);
    const serverKnowledge = budget.current_server_knowledge ?? 0;
    const lookups = buildLookups(budget.changed_entities ?? {});
    const existing = budget.changed_entities?.be_transactions?.find(
      t => t.id === params.transaction_id && !t.is_tombstone,
    );
    if (!existing) {
      throw ToolError.notFound(`Transaction not found: ${params.transaction_id}`);
    }

    if (existing.transfer_account_id) {
      throw ToolError.validation('Cannot update transfer transactions — edit them in YNAB directly.');
    }

    const hasSubtransactions = (budget.changed_entities?.be_subtransactions ?? []).some(
      s => s.entities_transaction_id === params.transaction_id && !s.is_tombstone,
    );
    if (hasSubtransactions) {
      throw ToolError.validation('Cannot update split transactions — edit them in YNAB directly.');
    }

    const changedEntities: Record<string, unknown> = {};

    let payeeId = params.payee_id ?? existing.entities_payee_id ?? null;
    if (params.payee_name && !params.payee_id) {
      const resolved = resolvePayee(budget.changed_entities?.be_payees ?? [], params.payee_name);
      payeeId = resolved.payeeId;
      if (resolved.newPayee) {
        changedEntities.be_payees = [resolved.newPayee];
        lookups.payees.set(resolved.payeeId, params.payee_name);
      }
    }

    // Spread `...existing` so every wire field the server stores round-trips
    // untouched. Earlier versions reconstructed the row and nulled fields like
    // `imported_date`, `matched_transaction_id`, and `provider_cleansed_payee`
    // — the server accepted those nulls for `imported_date` specifically,
    // breaking YNAB's bank-feed dedup and causing duplicate imports on accounts
    // with frequent edits. Server-computed fields (cash_amount, credit_amount,
    // credit_amount_adjusted, subcategory_credit_amount_preceding) are
    // preserved from `existing`; the server recomputes them anyway.
    const updatedTransaction: typeof existing = {
      ...existing,
      id: params.transaction_id,
      is_tombstone: false,
      entities_account_id: params.account_id,
      entities_payee_id: payeeId,
      entities_subcategory_id: params.category_id ?? existing.entities_subcategory_id ?? null,
      date: params.date ?? existing.date ?? '',
      amount: params.amount !== undefined ? toMilliunits(params.amount) : (existing.amount ?? 0),
      memo: params.memo ?? existing.memo ?? null,
      cleared: resolveCleared(params.cleared, existing.cleared),
      // YNAB's wire format calls this "accepted"; the public tool surface uses "approved".
      accepted: params.approved ?? existing.accepted ?? false,
      flag: resolveFlag(params.flag_color, existing.flag),
    };

    changedEntities.be_transaction_groups = [
      { id: params.transaction_id, be_transaction: updatedTransaction, be_subtransactions: null },
    ];

    const result = await syncWrite<BudgetEntities>(planId, changedEntities, serverKnowledge);

    // Prefer server-echoed data (captures any concurrent merges); fall back to
    // our local copy when the server omits the transaction from the response.
    const saved =
      result.changed_entities?.be_transactions?.find(t => t.id === params.transaction_id) ?? updatedTransaction;

    return { transaction: mapTransaction(saved, lookups) };
  },
});
