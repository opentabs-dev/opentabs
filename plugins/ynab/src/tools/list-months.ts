import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { syncBudget, getPlanId } from '../ynab-api.js';
import type { RawMonth, RawMonthlyBudgetCalc } from './schemas.js';
import { mapMonth, monthSchema } from './schemas.js';

interface BudgetData {
  be_monthly_budgets?: RawMonth[];
  be_monthly_budget_calculations?: RawMonthlyBudgetCalc[];
}

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
    const result = await syncBudget<BudgetData>(planId);

    const entities = result.changed_entities;
    const rawMonths = entities?.be_monthly_budgets ?? [];
    const rawCalcs = entities?.be_monthly_budget_calculations ?? [];

    // Map calculation data by month (entities_monthly_budget_id format: mb/YYYY-MM-DD)
    const calcMap = new Map<string, RawMonthlyBudgetCalc>();
    for (const calc of rawCalcs) {
      const budgetId = calc.entities_monthly_budget_id;
      if (budgetId) {
        const month = budgetId.replace('mb/', '');
        calcMap.set(month, calc);
      }
    }

    const months = rawMonths
      .filter(m => !m.is_tombstone)
      .map(m => mapMonth(m, calcMap.get(m.month ?? '')))
      .sort((a, b) => b.month.localeCompare(a.month));

    return { months };
  },
});
