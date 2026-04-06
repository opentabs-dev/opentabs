import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { syncBudget, getPlanId } from '../ynab-api.js';
import type { BudgetEntities } from './schemas.js';
import {
  buildSubcategoryCalcMap,
  categoryGroupSchema,
  categorySchema,
  mapCategoryGroup,
  mapCategoryWithCalc,
} from './schemas.js';

export const listCategories = defineTool({
  name: 'list_categories',
  displayName: 'List Categories',
  description:
    'List all category groups and categories in the active YNAB plan. Returns budgeted amounts, activity, and available balances for the current month. Excludes hidden and deleted categories by default.',
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
    const rawGroups = (entities?.be_master_categories ?? []).filter(g => !g.is_tombstone);
    const rawCategories = (entities?.be_subcategories ?? []).filter(c => !c.is_tombstone);
    const calcMap = buildSubcategoryCalcMap(entities?.be_monthly_subcategory_budget_calculations ?? []);

    let groups = rawGroups.map(mapCategoryGroup);
    let categories = rawCategories.map(c => mapCategoryWithCalc(c, calcMap));

    if (!params.include_hidden) {
      groups = groups.filter(g => !g.hidden);
      categories = categories.filter(c => !c.hidden);
    }

    return { groups, categories };
  },
});
