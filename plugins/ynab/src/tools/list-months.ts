import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { syncBudget, getPlanId } from '../ynab-api.js';
import type { BudgetEntities } from './schemas.js';
import { buildMonthlyBudgetCalcMap, mapMonth, monthSchema, notTombstone } from './schemas.js';

export const listMonths = defineTool({
  name: 'list_months',
  displayName: 'List Months',
  description:
    'List all budget months in the active YNAB plan. Returns income, budgeted, activity, and Ready to Assign amounts for each month. Sorted from most recent to oldest.',
  summary: 'List budget months with summaries',
  icon: 'calendar',
  group: 'Months',
  input: z.object({}),
  output: z.object({
    months: z.array(monthSchema).describe('List of budget months'),
  }),
  handle: async () => {
    const planId = getPlanId();
    const result = await syncBudget<BudgetEntities>(planId);

    const entities = result.changed_entities;
    const rawMonths = entities?.be_monthly_budgets ?? [];
    const calcMap = buildMonthlyBudgetCalcMap(entities?.be_monthly_budget_calculations ?? []);

    const months = rawMonths
      .filter(notTombstone)
      .map(m => mapMonth(m, calcMap.get((m.month ?? '').substring(0, 7))))
      .sort((a, b) => b.month.localeCompare(a.month));

    return { months };
  },
});
