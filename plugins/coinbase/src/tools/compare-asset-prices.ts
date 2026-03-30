import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { gql } from '../coinbase-api.js';
import { type RawLatestPrice, latestPriceSchema, mapLatestPrice } from './schemas.js';

const buildQuery = (uuids: string[]): string => {
  const varDefs = uuids.map((_, i) => `$uuid${i}: String!`).join(', ');
  const fields = uuids
    .map(
      (_, i) =>
        `a${i}: assetByUuid(uuid: $uuid${i}) { uuid name symbol latestPrice(quoteCurrency: $quoteCurrency) { price timestamp quoteCurrency } }`,
    )
    .join('\n  ');
  return `query CompareAssetPrices($quoteCurrency: String!, ${varDefs}) {\n  ${fields}\n}`;
};

interface AssetResult {
  uuid?: string;
  name?: string;
  symbol?: string;
  latestPrice?: RawLatestPrice;
}

const priceComparisonSchema = z.object({
  uuid: z.string().describe('Asset UUID'),
  name: z.string().describe('Asset name'),
  symbol: z.string().describe('Ticker symbol'),
  latest_price: latestPriceSchema,
});

export const compareAssetPrices = defineTool({
  name: 'compare_asset_prices',
  displayName: 'Compare Asset Prices',
  description:
    'Get current prices for multiple assets in a single request. Provide up to 10 asset UUIDs and receive all their latest prices at once. Useful for comparing prices across assets.',
  summary: 'Compare prices of multiple assets',
  icon: 'bar-chart-3',
  group: 'Prices',
  input: z.object({
    uuids: z.array(z.string()).min(1).max(10).describe('Array of asset UUIDs to compare (1-10)'),
    quote_currency: z.string().optional().describe('Quote currency for prices (default "USD")'),
  }),
  output: z.object({
    assets: z.array(priceComparisonSchema).describe('Assets with their current prices'),
  }),
  handle: async params => {
    const query = buildQuery(params.uuids);
    const variables: Record<string, string> = { quoteCurrency: params.quote_currency ?? 'USD' };
    for (const [i, uuid] of params.uuids.entries()) {
      variables[`uuid${i}`] = uuid;
    }
    const data = await gql<Record<string, AssetResult>>(query, variables);

    const assets = params.uuids.map((_, i) => {
      const a = data[`a${i}`] ?? {};
      return {
        uuid: a.uuid ?? '',
        name: a.name ?? '',
        symbol: a.symbol ?? '',
        latest_price: mapLatestPrice(a.latestPrice ?? {}),
      };
    });

    return { assets };
  },
});
