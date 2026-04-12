import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getPlanId, syncBudget, syncWrite } from '../ynab-api.js';
import type { BudgetEntities, RawCategoryGroup } from './schemas.js';
import { categoryGroupSchema, mapCategoryGroup, nextTopSortableIndex } from './schemas.js';

export const createCategoryGroup = defineTool({
  name: 'create_category_group',
  displayName: 'Create Category Group',
  description: 'Create a new category group in the active YNAB plan.',
  summary: 'Create a category group',
  icon: 'folder-plus',
  group: 'Categories',
  input: z.object({
    name: z.string().min(1).describe('Name of the new category group'),
  }),
  output: z.object({
    group: categoryGroupSchema,
  }),
  handle: async params => {
    const planId = getPlanId();
    const groupId = crypto.randomUUID();

    const budget = await syncBudget<BudgetEntities>(planId);
    const serverKnowledge = budget.current_server_knowledge ?? 0;

    const groupEntry: RawCategoryGroup = {
      id: groupId,
      is_tombstone: false,
      internal_name: '',
      deletable: true,
      sortable_index: nextTopSortableIndex(budget.changed_entities?.be_master_categories ?? []),
      name: params.name,
      note: '',
      is_hidden: false,
    };

    await syncWrite<BudgetEntities>(planId, { be_master_categories: [groupEntry] }, serverKnowledge);

    return { group: mapCategoryGroup(groupEntry) };
  },
});
