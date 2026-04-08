import { defineTool, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { assertAuthenticated, catalog, getDeviceId } from '../ynab-api.js';
import type { RawPlan } from './schemas.js';
import { mapPlan, planSchema } from './schemas.js';

export const getPlan = defineTool({
  name: 'get_plan',
  displayName: 'Get Plan',
  description:
    'Get details about the currently active YNAB plan (budget), including name, currency, and date format. The plan ID is extracted from the current URL.',
  summary: 'Get the active plan details',
  icon: 'wallet',
  group: 'Plans',
  input: z.object({}),
  output: z.object({ plan: planSchema }),
  handle: async () => {
    assertAuthenticated();
    // getInitialUserData returns budget_version at the response root (not under
    // changed_entities), so we read it via the CatalogResponse index signature
    // and narrow it ourselves rather than retyping the whole response.
    const result = await catalog('getInitialUserData', {
      device_info: { id: getDeviceId(), device_os: 'web' },
    });
    const budgetVersion = result.budget_version as RawPlan | undefined;
    if (!budgetVersion) {
      throw ToolError.notFound('No active plan found');
    }
    return { plan: mapPlan(budgetVersion) };
  },
});
