import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getPlanId, getUserId, syncBudget, syncWrite } from '../ynab-api.js';
import type { BudgetEntities, RawCategory, RawMonthlySubcategoryBudget } from './schemas.js';
import {
  buildSubcategoryBudgetMap,
  buildSubcategoryCalcMap,
  categorySchema,
  formatMonthlyBudgetId,
  formatSubcategoryBudgetId,
  mapCategoryForMonth,
  MONEY_MOVEMENT_SOURCE,
  notTombstone,
  toMilliunits,
  toMonthKey,
} from './schemas.js';

export const moveCategoryBudget = defineTool({
  name: 'move_category_budget',
  displayName: 'Move Category Budget',
  description:
    'Move budgeted money between categories or to/from Ready to Assign for a specific month. Omit from_category_id to move money out of Ready to Assign; omit to_category_id to move money back to Ready to Assign. Both null is invalid.',
  summary: 'Move money between budget categories',
  icon: 'arrow-left-right',
  group: 'Categories',
  input: z
    .object({
      month: z
        .string()
        .regex(/^\d{4}-\d{2}(-\d{2})?$/, 'Month must be YYYY-MM or YYYY-MM-DD')
        .describe('Month in YYYY-MM format (e.g. 2026-03)'),
      amount: z.number().positive().describe('Amount to move in currency units (e.g. 50 for $50)'),
      from_category_id: z.string().optional().describe('Source category ID. Omit to move from Ready to Assign.'),
      to_category_id: z.string().optional().describe('Destination category ID. Omit to move to Ready to Assign.'),
    })
    .refine(p => p.from_category_id || p.to_category_id, {
      message: 'At least one of from_category_id or to_category_id must be provided',
    })
    .refine(p => !p.from_category_id || !p.to_category_id || p.from_category_id !== p.to_category_id, {
      message: 'from_category_id and to_category_id must differ',
    }),
  output: z.object({
    categories: z
      .array(categorySchema)
      .describe('Updated categories (1 if RTA is involved, 2 for category-to-category)'),
  }),
  handle: async params => {
    const planId = getPlanId();
    const userId = getUserId();
    const milliunits = toMilliunits(params.amount);
    const monthKey = toMonthKey(params.month);
    const monthlyBudgetId = formatMonthlyBudgetId(monthKey, planId);

    const budget = await syncBudget<BudgetEntities>(planId);
    const serverKnowledge = budget.current_server_knowledge ?? 0;
    const subcategories = budget.changed_entities?.be_subcategories ?? [];
    const existingBudgets = budget.changed_entities?.be_monthly_subcategory_budgets ?? [];

    const findCategory = (id: string): RawCategory & { id: string } => {
      const c = subcategories.find(s => s.id === id && notTombstone(s));
      if (!c?.id) throw ToolError.notFound(`Category not found: ${id}`);
      return { ...c, id: c.id };
    };
    const fromCategory = params.from_category_id ? findCategory(params.from_category_id) : null;
    const toCategory = params.to_category_id ? findCategory(params.to_category_id) : null;

    const fromBudgetId = fromCategory ? formatSubcategoryBudgetId(monthKey, fromCategory.id) : null;
    const toBudgetId = toCategory ? formatSubcategoryBudgetId(monthKey, toCategory.id) : null;

    const buildEntry = (categoryId: string, budgetId: string, signedDelta: number): RawMonthlySubcategoryBudget => {
      const current = existingBudgets.find(b => b.id === budgetId && notTombstone(b))?.budgeted ?? 0;
      return {
        id: budgetId,
        is_tombstone: false,
        entities_monthly_budget_id: monthlyBudgetId,
        entities_subcategory_id: categoryId,
        budgeted: current + signedDelta,
      };
    };

    const budgetEntries: RawMonthlySubcategoryBudget[] = [];
    if (fromCategory && fromBudgetId) budgetEntries.push(buildEntry(fromCategory.id, fromBudgetId, -milliunits));
    if (toCategory && toBudgetId) budgetEntries.push(buildEntry(toCategory.id, toBudgetId, milliunits));

    const source = fromCategory && toCategory ? MONEY_MOVEMENT_SOURCE.MOVEMENT : MONEY_MOVEMENT_SOURCE.ASSIGN;

    const result = await syncWrite<BudgetEntities>(
      planId,
      {
        be_monthly_subcategory_budgets: budgetEntries,
        be_money_movements: [
          {
            id: crypto.randomUUID(),
            is_tombstone: false,
            from_entities_monthly_subcategory_budget_id: fromBudgetId,
            to_entities_monthly_subcategory_budget_id: toBudgetId,
            entities_money_movement_group_id: null,
            amount: milliunits,
            performed_by_user_id: userId,
            note: null,
            source,
            move_started_at: new Date().toISOString(),
            move_accepted_at: null,
          },
        ],
      },
      serverKnowledge,
    );

    const calcMap = buildSubcategoryCalcMap(result.changed_entities?.be_monthly_subcategory_budget_calculations ?? []);
    // Prefer the server's echoed values — if a concurrent update from another
    // client merged in, that change shows up here. Fall back to our local
    // entries for any that the server didn't echo.
    const budgetMap = buildSubcategoryBudgetMap(result.changed_entities?.be_monthly_subcategory_budgets ?? []);
    for (const e of budgetEntries) {
      const key = `${monthKey}/${e.entities_subcategory_id}`;
      if (!budgetMap.has(key)) budgetMap.set(key, e);
    }

    const categories: Array<ReturnType<typeof mapCategoryForMonth>> = [];
    if (fromCategory) categories.push(mapCategoryForMonth(fromCategory, budgetMap, calcMap, monthKey));
    if (toCategory) categories.push(mapCategoryForMonth(toCategory, budgetMap, calcMap, monthKey));
    return { categories };
  },
});
