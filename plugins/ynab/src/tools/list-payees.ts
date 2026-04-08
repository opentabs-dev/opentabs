import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getPlanId, syncBudget } from '../ynab-api.js';
import type { BudgetEntities } from './schemas.js';
import { mapPayee, notTombstone, payeeSchema } from './schemas.js';

export const listPayees = defineTool({
  name: 'list_payees',
  displayName: 'List Payees',
  description:
    'List all payees in the active YNAB plan. Payees represent merchants, employers, or transfer targets. Excludes deleted payees.',
  summary: 'List all payees',
  icon: 'store',
  group: 'Payees',
  input: z.object({}),
  output: z.object({
    payees: z.array(payeeSchema).describe('List of payees'),
  }),
  handle: async () => {
    const planId = getPlanId();
    const result = await syncBudget<BudgetEntities>(planId);

    const raw = result.changed_entities?.be_payees ?? [];
    const payees = raw.filter(notTombstone).map(mapPayee);

    return { payees };
  },
});
