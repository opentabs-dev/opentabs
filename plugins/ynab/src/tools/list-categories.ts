import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getPlanId, syncBudget } from '../ynab-api.js';
import type { BudgetEntities } from './schemas.js';
import {
  buildSubcategoryBudgetMap,
  buildSubcategoryCalcMap,
  categoryGroupSchema,
  categorySchema,
  currentMonthKey,
  mapCategoryForMonth,
  mapCategoryGroup,
  notTombstone,
} from './schemas.js';

export const listCategories = defineTool({
  name: 'list_categories',
  displayName: 'List Categories',
  description:
    'List category groups and categories in the active YNAB plan. Returns budgeted amounts, activity, and available balances for the current month. Hidden and deleted categories are excluded by default — pass include_hidden=true to also see hidden categories (useful for editing budgets on hidden categories).',
  summary: 'List budget categories with balances',
  icon: 'tags',
  group: 'Categories',
  input: z.object({
    include_hidden: z.boolean().optional().describe('Include hidden categories (default false)'),
  }),
  output: z.object({
    groups: z.array(categoryGroupSchema).describe('Category groups'),
    categories: z.array(categorySchema).describe('Categories with budget data'),
  }),
  handle: async params => {
    const planId = getPlanId();
    const result = await syncBudget<BudgetEntities>(planId);

    const entities = result.changed_entities;
    const rawGroups = (entities?.be_master_categories ?? []).filter(notTombstone);
    const rawCategories = (entities?.be_subcategories ?? []).filter(notTombstone);
    const budgetMap = buildSubcategoryBudgetMap(entities?.be_monthly_subcategory_budgets ?? []);
    const calcMap = buildSubcategoryCalcMap(entities?.be_monthly_subcategory_budget_calculations ?? []);
    const currentMonth = currentMonthKey();

    let groups = rawGroups.map(mapCategoryGroup);
    let categories = rawCategories.map(c => mapCategoryForMonth(c, budgetMap, calcMap, currentMonth));

    if (!params.include_hidden) {
      groups = groups.filter(g => !g.hidden);
      categories = categories.filter(c => !c.hidden);
    }

    return { groups, categories };
  },
});
