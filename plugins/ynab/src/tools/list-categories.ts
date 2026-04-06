import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { syncBudget, getPlanId } from '../ynab-api.js';
import type { BudgetEntities, RawMonthlySubcategoryBudgetCalc } from './schemas.js';
import { categoryGroupSchema, categorySchema, mapCategory, mapCategoryGroup } from './schemas.js';

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

    // Merge monthly subcategory budget calculations into categories
    // entity_id format: mcbc/YYYY-MM/category-id — extract category-id suffix
    const calcs = entities?.be_monthly_subcategory_budget_calculations ?? [];
    const calcMap = new Map<string, RawMonthlySubcategoryBudgetCalc>();
    for (const calc of calcs) {
      const entityId = calc.entities_monthly_subcategory_budget_id;
      if (entityId) {
        const parts = entityId.split('/');
        const categoryId = parts.length >= 3 ? parts.slice(2).join('/') : entityId;
        calcMap.set(categoryId, calc);
      }
    }

    let groups = rawGroups.map(mapCategoryGroup);
    let categories = rawCategories.map(c => {
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

    if (!params.include_hidden) {
      groups = groups.filter(g => !g.hidden);
      categories = categories.filter(c => !c.hidden);
    }

    return { groups, categories };
  },
});
