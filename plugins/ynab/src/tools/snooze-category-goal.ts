import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getPlanId, syncBudget, syncWrite } from '../ynab-api.js';
import type { BudgetEntities, RawMonthlySubcategoryBudget } from './schemas.js';
import { findCategory, formatMonthlyBudgetId, formatSubcategoryBudgetId, notTombstone, toMonthKey } from './schemas.js';

export const snoozeCategoryGoal = defineTool({
  name: 'snooze_category_goal',
  displayName: 'Snooze Category Goal',
  description:
    'Snooze a category goal for a specific month so it does not appear as needing funding for that month. Pass snooze=false to un-snooze.',
  summary: 'Snooze a category goal for a month',
  icon: 'bell-off',
  group: 'Categories',
  input: z.object({
    category_id: z.string().min(1).describe('Category ID whose goal to snooze'),
    month: z
      .string()
      .regex(/^\d{4}-\d{2}(-\d{2})?$/, 'Month must be YYYY-MM or YYYY-MM-DD')
      .describe('Month in YYYY-MM format (e.g. 2026-04)'),
    snooze: z.boolean().optional().describe('true to snooze (default), false to un-snooze'),
  }),
  output: z.object({
    success: z.boolean(),
    snoozed_at: z.string().nullable().describe('ISO timestamp the goal was snoozed at, or null if un-snoozed'),
  }),
  handle: async params => {
    const planId = getPlanId();
    const monthKey = toMonthKey(params.month);
    const budgetId = formatSubcategoryBudgetId(monthKey, params.category_id);
    const monthlyBudgetId = formatMonthlyBudgetId(monthKey, planId);
    const shouldSnooze = params.snooze ?? true;

    const budget = await syncBudget<BudgetEntities>(planId);
    const serverKnowledge = budget.current_server_knowledge ?? 0;

    const category = findCategory(budget.changed_entities, params.category_id);
    if (!category.goal_type) {
      throw ToolError.validation(`Category "${category.name}" has no goal to snooze.`);
    }

    const existing = (budget.changed_entities?.be_monthly_subcategory_budgets ?? []).find(
      b => b.id === budgetId && notTombstone(b),
    );

    const snoozedAt = shouldSnooze ? new Date().toISOString() : null;
    // Preserve every field on the existing budget row so we don't accidentally
    // wipe state by sending only the fields we care about.
    const budgetEntry: RawMonthlySubcategoryBudget = {
      ...(existing ?? {}),
      id: budgetId,
      is_tombstone: false,
      entities_monthly_budget_id: monthlyBudgetId,
      entities_subcategory_id: params.category_id,
      budgeted: existing?.budgeted ?? 0,
      goal_snoozed_at: snoozedAt,
    };

    await syncWrite<BudgetEntities>(planId, { be_monthly_subcategory_budgets: [budgetEntry] }, serverKnowledge);

    return { success: true, snoozed_at: snoozedAt };
  },
});
