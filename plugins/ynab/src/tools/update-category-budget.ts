import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getPlanId, syncBudget, syncWrite } from '../ynab-api.js';
import type { BudgetEntities } from './schemas.js';
import { categorySchema, mapCategory } from './schemas.js';

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
    month: z.string().min(1).describe('Month in YYYY-MM format (e.g. 2026-03)'),
    budgeted: z.number().describe('Amount to budget in currency units (e.g. 500 for $500)'),
  }),
  output: z.object({
    category: categorySchema,
  }),
  handle: async params => {
    const planId = getPlanId();
    const milliunits = Math.round(params.budgeted * 1000);
    const monthKey = params.month.substring(0, 7);
    const budgetId = `mcb/${monthKey}/${params.category_id}`;
    const monthlyBudgetId = `mb/${monthKey}/${planId}`;

    const budget = await syncBudget<BudgetEntities>(planId);
    const serverKnowledge = budget.current_server_knowledge ?? 0;

    const result = await syncWrite(
      planId,
      {
        be_monthly_subcategory_budgets: [
          {
            id: budgetId,
            entities_monthly_budget_id: monthlyBudgetId,
            entities_subcategory_id: params.category_id,
            budgeted: milliunits,
            overspending_handling: 'AffectsBuffer',
            is_tombstone: false,
          },
        ],
      },
      serverKnowledge,
    );

    const budgets = (result.changed_entities as BudgetEntities | undefined)
      ?.be_monthly_subcategory_budget_calculations;
    const updatedBudget = budgets?.[0]?.budgeted ?? milliunits;

    return {
      category: mapCategory({
        id: params.category_id,
        budgeted: updatedBudget,
      }),
    };
  },
});
