import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { syncBudget, getPlanId } from '../ynab-api.js';
import type { BudgetEntities } from './schemas.js';
import {
  buildMonthlyBudgetCalcMap,
  buildSubcategoryBudgetMap,
  buildSubcategoryCalcMap,
  categorySchema,
  mapCategoryForMonth,
  mapMonth,
  monthSchema,
  notTombstone,
  toMonthKey,
} from './schemas.js';

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
    include_hidden: z.boolean().optional().describe('Include hidden categories (default false)'),
  }),
  output: z.object({
    month: monthSchema,
    categories: z.array(categorySchema).describe('Category budgets for this month'),
  }),
  handle: async params => {
    const planId = getPlanId();
    const result = await syncBudget<BudgetEntities>(planId);

    const entities = result.changed_entities;
    const rawMonths = entities?.be_monthly_budgets ?? [];
    const monthData = rawMonths.find(m => m.month === params.month && !m.is_tombstone);

    if (!monthData) {
      throw ToolError.notFound(`Month not found: ${params.month}`);
    }

    const monthKey = toMonthKey(params.month);
    const monthCalcMap = buildMonthlyBudgetCalcMap(entities?.be_monthly_budget_calculations ?? []);
    const monthCalc = monthCalcMap.get(monthKey);

    const rawCategories = (entities?.be_subcategories ?? []).filter(
      c => notTombstone(c) && (params.include_hidden || c.is_hidden !== true),
    );
    const budgetMap = buildSubcategoryBudgetMap(entities?.be_monthly_subcategory_budgets ?? []);
    const calcMap = buildSubcategoryCalcMap(entities?.be_monthly_subcategory_budget_calculations ?? []);
    const categories = rawCategories.map(c => mapCategoryForMonth(c, budgetMap, calcMap, monthKey));

    return {
      month: mapMonth(monthData, monthCalc),
      categories,
    };
  },
});
