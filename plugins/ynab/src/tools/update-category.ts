import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getPlanId, syncBudget, syncWrite } from '../ynab-api.js';
import type { BudgetEntities, RawCategory } from './schemas.js';
import {
  assertCategoryGroupDeletable,
  buildGoalFields,
  categorySchema,
  findCategory,
  findCategoryGroup,
  goalSpecSchema,
  mapCategory,
} from './schemas.js';

export const updateCategory = defineTool({
  name: 'update_category',
  displayName: 'Update Category',
  description:
    'Rename a category, change its group, set/clear its goal, or hide/unhide it. Only specified fields change; omitted fields remain unchanged. Goal types: "set_aside" / "refill" (recurring NEED with optional cadence), "target_balance" (have $X), "target_by_date" (have $X by date), "debt" (recurring debt payment), or "none" to clear an existing goal.',
  summary: 'Update a category',
  icon: 'pencil',
  group: 'Categories',
  input: z.object({
    category_id: z.string().min(1).describe('Category ID to update'),
    name: z.string().min(1).optional().describe('New name'),
    group_id: z.string().min(1).optional().describe('New parent category group ID (to move the category)'),
    goal: goalSpecSchema.optional().describe('New goal definition. Pass { type: "none" } to clear the goal.'),
    hidden: z.boolean().optional().describe('Hide or unhide the category'),
    note: z.string().optional().describe('New note (pass empty string to clear)'),
  }),
  output: z.object({
    category: categorySchema,
  }),
  handle: async params => {
    const planId = getPlanId();

    const budget = await syncBudget<BudgetEntities>(planId);
    const serverKnowledge = budget.current_server_knowledge ?? 0;

    const existing = findCategory(budget.changed_entities, params.category_id);
    if (params.group_id) {
      assertCategoryGroupDeletable(findCategoryGroup(budget.changed_entities, params.group_id));
    }
    if (params.goal?.type === 'debt' && existing.entities_account_id == null) {
      throw ToolError.validation('Debt goals can only be set on debt-account categories.');
    }

    const updated: RawCategory = {
      ...existing,
      name: params.name ?? existing.name,
      entities_master_category_id: params.group_id ?? existing.entities_master_category_id,
      is_hidden: params.hidden ?? existing.is_hidden,
      note: params.note ?? existing.note,
      ...(params.goal !== undefined ? buildGoalFields(params.goal) : {}),
    };

    await syncWrite<BudgetEntities>(planId, { be_subcategories: [updated] }, serverKnowledge);

    return { category: mapCategory(updated) };
  },
});
