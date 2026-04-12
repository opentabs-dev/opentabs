import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getPlanId, syncBudget, syncWrite } from '../ynab-api.js';
import type { BudgetEntities } from './schemas.js';
import { assertCategoryDeletable, findCategory } from './schemas.js';

export const deleteCategory = defineTool({
  name: 'delete_category',
  displayName: 'Delete Category',
  description:
    'Delete a category from the active YNAB plan. This is a soft delete (tombstone). Existing transactions assigned to this category remain in place but the category will no longer appear in budget views.',
  summary: 'Delete a category',
  icon: 'trash-2',
  group: 'Categories',
  input: z.object({
    category_id: z.string().min(1).describe('Category ID to delete'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
  handle: async params => {
    const planId = getPlanId();

    const budget = await syncBudget<BudgetEntities>(planId);
    const serverKnowledge = budget.current_server_knowledge ?? 0;
    const existing = findCategory(budget.changed_entities, params.category_id);
    assertCategoryDeletable(existing);

    await syncWrite<BudgetEntities>(
      planId,
      { be_subcategories: [{ ...existing, is_tombstone: true }] },
      serverKnowledge,
    );

    return { success: true };
  },
});
