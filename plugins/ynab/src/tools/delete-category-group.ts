import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getPlanId, syncBudget, syncWrite } from '../ynab-api.js';
import type { BudgetEntities } from './schemas.js';
import { findCategoryGroup, notTombstone } from './schemas.js';

export const deleteCategoryGroup = defineTool({
  name: 'delete_category_group',
  displayName: 'Delete Category Group',
  description:
    'Delete a category group and all of its child categories from the active YNAB plan. This is a soft delete (tombstone). Internal/non-deletable groups (Credit Card Payments, Hidden Categories, Internal Master Category) cannot be deleted.',
  summary: 'Delete a category group and its children',
  icon: 'folder-x',
  group: 'Categories',
  input: z.object({
    group_id: z.string().min(1).describe('Category group ID to delete'),
  }),
  output: z.object({
    success: z.boolean(),
    deleted_category_count: z.number().describe('Number of child categories that were also tombstoned'),
  }),
  handle: async params => {
    const planId = getPlanId();

    const budget = await syncBudget<BudgetEntities>(planId);
    const serverKnowledge = budget.current_server_knowledge ?? 0;

    const group = findCategoryGroup(budget.changed_entities, params.group_id);
    // Default-deny: only allow deletion when YNAB explicitly marks the group as deletable.
    // Internal groups (Credit Card Payments, Hidden Categories, Internal Master Category)
    // either have deletable=false or omit the field entirely.
    if (group.deletable !== true) {
      throw ToolError.validation(`Category group "${group.name}" is not deletable.`);
    }

    const childCategories = (budget.changed_entities?.be_subcategories ?? []).filter(
      c => c.entities_master_category_id === params.group_id && notTombstone(c),
    );

    await syncWrite<BudgetEntities>(
      planId,
      {
        be_master_categories: [{ ...group, is_tombstone: true }],
        be_subcategories: childCategories.map(c => ({ ...c, is_tombstone: true })),
      },
      serverKnowledge,
    );

    return { success: true, deleted_category_count: childCategories.length };
  },
});
