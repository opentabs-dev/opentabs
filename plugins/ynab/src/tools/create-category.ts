import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getPlanId, syncBudget, syncWrite } from '../ynab-api.js';
import type { BudgetEntities, RawCategory, RawMonthlySubcategoryBudget } from './schemas.js';
import {
  buildGoalFields,
  CATEGORY_TYPE_DEFAULT,
  categorySchema,
  currentMonthKey,
  findCategoryGroup,
  formatMonthlyBudgetId,
  formatSubcategoryBudgetId,
  goalSpecSchema,
  mapCategory,
  nextTopSortableIndex,
} from './schemas.js';

export const createCategory = defineTool({
  name: 'create_category',
  displayName: 'Create Category',
  description:
    'Create a new category in an existing category group. Optionally set an initial goal: "set_aside" (set aside X per cadence), "refill" (refill the balance up to X per cadence), "target_balance" (have a balance of X), "target_by_date" (have a balance of X by a specific date), or "debt" (recurring debt payment). NEED-style goals (set_aside, refill) accept weekly/monthly/yearly cadence.',
  summary: 'Create a new budget category',
  icon: 'plus',
  group: 'Categories',
  input: z.object({
    group_id: z.string().min(1).describe('Category group ID to create the category in'),
    name: z.string().min(1).describe('Name of the new category'),
    goal: goalSpecSchema.optional().describe('Optional initial goal for the category'),
    note: z.string().optional().describe('Optional note for the category'),
  }),
  output: z.object({
    category: categorySchema,
  }),
  handle: async params => {
    const planId = getPlanId();
    const categoryId = crypto.randomUUID();

    const budget = await syncBudget<BudgetEntities>(planId);
    const serverKnowledge = budget.current_server_knowledge ?? 0;

    findCategoryGroup(budget.changed_entities, params.group_id);

    const childCategories = (budget.changed_entities?.be_subcategories ?? []).filter(
      c => c.entities_master_category_id === params.group_id,
    );
    const monthKey = currentMonthKey();
    const categoryEntry: RawCategory = {
      id: categoryId,
      is_tombstone: false,
      entities_master_category_id: params.group_id,
      entities_account_id: null,
      internal_name: null,
      sortable_index: nextTopSortableIndex(childCategories, 5),
      name: params.name,
      type: CATEGORY_TYPE_DEFAULT,
      note: params.note ?? null,
      monthly_funding: 0,
      is_hidden: false,
      pinned_index: null,
      pinned_goal_index: null,
      ...buildGoalFields(params.goal),
    };

    // YNAB's UI also creates a current-month budget row alongside the category.
    const budgetEntry: RawMonthlySubcategoryBudget = {
      id: formatSubcategoryBudgetId(monthKey, categoryId),
      is_tombstone: false,
      entities_monthly_budget_id: formatMonthlyBudgetId(monthKey, planId),
      entities_subcategory_id: categoryId,
      budgeted: 0,
    };

    await syncWrite<BudgetEntities>(
      planId,
      {
        be_subcategories: [categoryEntry],
        be_monthly_subcategory_budgets: [budgetEntry],
      },
      serverKnowledge,
    );

    return { category: mapCategory(categoryEntry) };
  },
});
