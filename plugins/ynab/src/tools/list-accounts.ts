import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { syncBudget, getPlanId } from '../ynab-api.js';
import type { BudgetEntities } from './schemas.js';
import { accountSchema, buildAccountCalcMap, mapAccount, notTombstone } from './schemas.js';

export const listAccounts = defineTool({
  name: 'list_accounts',
  displayName: 'List Accounts',
  description:
    'List all accounts in the active YNAB plan. Returns account name, type, balances, and on-budget status. Includes checking, savings, credit cards, and tracking accounts.',
  summary: 'List all budget accounts',
  icon: 'landmark',
  group: 'Accounts',
  input: z.object({
    include_closed: z.boolean().optional().describe('Include closed accounts (default false)'),
  }),
  output: z.object({
    accounts: z.array(accountSchema).describe('List of accounts'),
  }),
  handle: async params => {
    const planId = getPlanId();
    const result = await syncBudget<BudgetEntities>(planId);

    const entities = result.changed_entities;
    const raw = entities?.be_accounts ?? [];
    const calcMap = buildAccountCalcMap(entities ?? {});

    let accounts = raw.filter(notTombstone).map(a => mapAccount(a, calcMap.get(a.id)));

    if (!params.include_closed) {
      accounts = accounts.filter(a => !a.closed);
    }

    return { accounts };
  },
});
