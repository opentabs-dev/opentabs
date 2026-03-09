import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../robinhood-api.js';
import { type RawPortfolio, mapPortfolio, portfolioSchema } from './schemas.js';

export const getPortfolio = defineTool({
  name: 'get_portfolio',
  displayName: 'Get Portfolio',
  description:
    'Get the Robinhood portfolio summary including total equity, market value, extended hours values, and previous close equity.',
  summary: 'Get portfolio summary',
  icon: 'briefcase',
  group: 'Portfolio',
  input: z.object({}),
  output: portfolioSchema,
  handle: async () => {
    const data = await api<{ results: RawPortfolio[] }>('/portfolios/');
    const portfolio = data.results?.[0] ?? {};
    return mapPortfolio(portfolio);
  },
});
