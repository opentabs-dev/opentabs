import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getPlanId, getUserId, syncBudget, syncWrite } from '../ynab-api.js';
import type { BudgetEntities, RawMonthlySubcategoryBudget } from './schemas.js';
import {
  buildSubcategoryBudgetMap,
  buildSubcategoryCalcMap,
  categorySchema,
  formatMonthlyBudgetId,
  formatSubcategoryBudgetId,
  MONEY_MOVEMENT_SOURCE,
  mapCategoryForMonth,
  notTombstone,
  toMilliunits,
  toMonthKey,
} from './schemas.js';

export const updateCategoryBudget = defineTool({
  name: 'update_category_budget',
  displayName: 'Update Category Budget',
  description:
    'Set the budgeted amount for a category in a specific month. Amount is in currency units (e.g. 500 to budget $500). The month should be in YYYY-MM format (e.g. 2026-03 for March 2026).',
  summary: 'Set budgeted amount for a category',
  icon: 'pencil',
  group: 'Categories',
  input: z.object({
    category_id: z.string().min(1).describe('Category ID to budget'),
    month: z
      .string()
      .regex(/^\d{4}-\d{2}(-\d{2})?$/, 'Month must be YYYY-MM or YYYY-MM-DD')
      .describe('Month in YYYY-MM format (e.g. 2026-03)'),
    budgeted: z.number().describe('Amount to budget in currency units (e.g. 500 for $500)'),
  }),
  output: z.object({
    category: categorySchema,
  }),
  handle: async params => {
    const planId = getPlanId();
    const userId = getUserId();
    const milliunits = toMilliunits(params.budgeted);
    const monthKey = toMonthKey(params.month);
    const budgetId = formatSubcategoryBudgetId(monthKey, params.category_id);
    const monthlyBudgetId = formatMonthlyBudgetId(monthKey, planId);

    const budget = await syncBudget<BudgetEntities>(planId);
    const serverKnowledge = budget.current_server_knowledge ?? 0;
    const category = (budget.changed_entities?.be_subcategories ?? []).find(
      c => c.id === params.category_id && notTombstone(c),
    );
    if (!category) {
      throw ToolError.notFound(`Category not found: ${params.category_id}`);
    }

    const existingBudget = (budget.changed_entities?.be_monthly_subcategory_budgets ?? []).find(
      b => b.id === budgetId && notTombstone(b),
    );
    const delta = milliunits - (existingBudget?.budgeted ?? 0);

    const budgetEntry: RawMonthlySubcategoryBudget = {
      id: budgetId,
      is_tombstone: false,
      entities_monthly_budget_id: monthlyBudgetId,
      entities_subcategory_id: params.category_id,
      budgeted: milliunits,
    };
    const changedEntities: Record<string, unknown> = { be_monthly_subcategory_budgets: [budgetEntry] };

    // YNAB tracks budget changes as money movements; without this the write
    // is silently rejected (the budget value reverts on the next sync).
    // Direction is encoded via from/to (always positive amount).
    if (delta !== 0) {
      changedEntities.be_money_movements = [
        {
          id: crypto.randomUUID(),
          is_tombstone: false,
          to_entities_monthly_subcategory_budget_id: delta > 0 ? budgetId : null,
          from_entities_monthly_subcategory_budget_id: delta < 0 ? budgetId : null,
          entities_money_movement_group_id: null,
          amount: Math.abs(delta),
          performed_by_user_id: userId,
          note: null,
          source: MONEY_MOVEMENT_SOURCE.ASSIGN,
          move_started_at: new Date().toISOString(),
          move_accepted_at: null,
        },
      ];
    }

    const result = await syncWrite<BudgetEntities>(planId, changedEntities, serverKnowledge);

    const calcMap = buildSubcategoryCalcMap(result.changed_entities?.be_monthly_subcategory_budget_calculations ?? []);
    // Prefer the server's echoed values — if a concurrent update from another
    // client merged in, that change shows up here. Fall back to our local entry
    // if the server didn't echo (shouldn't happen in practice).
    const budgetMap = buildSubcategoryBudgetMap(result.changed_entities?.be_monthly_subcategory_budgets ?? []);
    const key = `${monthKey}/${params.category_id}`;
    if (!budgetMap.has(key)) budgetMap.set(key, budgetEntry);
    return { category: mapCategoryForMonth(category, budgetMap, calcMap, monthKey) };
  },
});
