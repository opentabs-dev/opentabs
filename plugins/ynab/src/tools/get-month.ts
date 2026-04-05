import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { syncBudget, getPlanId } from '../ynab-api.js';
import type { RawCategory, RawMonth, RawMonthlyBudgetCalc, RawMonthlySubcategoryBudgetCalc } from './schemas.js';
import { categorySchema, mapCategory, mapMonth, monthSchema } from './schemas.js';

interface BudgetData {
  be_monthly_budgets?: RawMonth[];
  be_subcategories?: RawCategory[];
  be_monthly_budget_calculations?: RawMonthlyBudgetCalc[];
  be_monthly_subcategory_budget_calculations?: RawMonthlySubcategoryBudgetCalc[];
}

export const getMonth = defineTool({
  name: 'get_month',
  displayName: 'Get Month',
  description:
    'Get budget summary and category details for a specific month. Returns the month overview (income, budgeted, activity, Ready to Assign) plus per-category breakdowns. Month format is YYYY-MM-DD using the first of the month (e.g. 2026-03-01).',
  summary: 'Get budget details for a month',
  icon: 'calendar',
  group: 'Months',
  input: z.object({
    month: z.string().min(1).describe('Month in YYYY-MM-DD format (first of month, e.g. 2026-03-01)'),
  }),
  output: z.object({
    month: monthSchema,
    categories: z.array(categorySchema).describe('Category budgets for this month'),
  }),
  handle: async params => {
    const planId = getPlanId();
    const result = await syncBudget<BudgetData>(planId);

    const entities = result.changed_entities;

    const rawMonths = entities?.be_monthly_budgets ?? [];
    const monthData = rawMonths.find(m => m.month === params.month && !m.is_tombstone);

    if (!monthData) {
      throw ToolError.notFound(`Month not found: ${params.month}`);
    }

    // Find the matching monthly budget calculation for aggregates
    const monthlyCalcs = entities?.be_monthly_budget_calculations ?? [];
    const monthCalc = monthlyCalcs.find(c => {
      const budgetId = c.entities_monthly_budget_id;
      return budgetId && budgetId.replace('mb/', '') === params.month;
    });

    const rawCategories = (entities?.be_subcategories ?? []).filter(c => !c.is_tombstone && c.is_hidden !== true);

    // Map subcategory budget calculations by category ID
    // entity_id format: mcbc/YYYY-MM/category-id
    const subcatCalcs = entities?.be_monthly_subcategory_budget_calculations ?? [];
    const calcMap = new Map<string, RawMonthlySubcategoryBudgetCalc>();
    for (const calc of subcatCalcs) {
      const entityId = calc.entities_monthly_subcategory_budget_id;
      if (entityId) {
        const parts = entityId.split('/');
        const categoryId = parts.length >= 3 ? parts.slice(2).join('/') : entityId;
        calcMap.set(categoryId, calc);
      }
    }

    const categories = rawCategories.map(c => {
      const calc = calcMap.get(c.id ?? '');
      return mapCategory({
        ...c,
        budgeted: calc?.budgeted ?? c.budgeted,
        activity: calc?.activity ?? c.activity,
        balance: calc?.balance ?? c.balance,
        goal_type: calc?.goal_type ?? c.goal_type,
        goal_target: calc?.goal_target ?? c.goal_target,
        goal_percentage_complete: calc?.goal_percentage_complete ?? c.goal_percentage_complete,
      });
    });

    return {
      month: mapMonth(monthData, monthCalc),
      categories,
    };
  },
});
