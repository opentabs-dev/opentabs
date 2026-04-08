import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { getPlanId, syncBudget } from '../ynab-api.js';
import type { BudgetEntities } from './schemas.js';
import { accountSchema, buildAccountCalcMap, mapAccount } from './schemas.js';

export const getAccount = defineTool({
  name: 'get_account',
  displayName: 'Get Account',
  description:
    'Get details for a specific account in the active YNAB plan by its ID. Returns name, type, balances, and on-budget status.',
  summary: 'Get account details by ID',
  icon: 'landmark',
  group: 'Accounts',
  input: z.object({
    account_id: z.string().min(1).describe('Account ID to retrieve'),
  }),
  output: z.object({
    account: accountSchema,
  }),
  handle: async params => {
    const planId = getPlanId();
    const result = await syncBudget<BudgetEntities>(planId);

    const entities = result.changed_entities;
    const raw = entities?.be_accounts ?? [];
    const calcMap = buildAccountCalcMap(entities ?? {});

    const account = raw.find(a => a.id === params.account_id && !a.is_tombstone);
    if (!account) {
      throw ToolError.notFound(`Account not found: ${params.account_id}`);
    }

    return { account: mapAccount(account, calcMap.get(account.id)) };
  },
});
