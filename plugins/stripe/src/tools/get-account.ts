import { defineTool, getPageGlobal, ToolError } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const getAccount = defineTool({
  name: 'get_account',
  displayName: 'Get Account',
  description:
    'Get the current Stripe account information including business name, email, country, and default currency. Reads from the page bootstrap data for instant response.',
  summary: 'Get current Stripe account info',
  icon: 'building-2',
  group: 'Account',
  input: z.object({}),
  output: z.object({
    id: z.string().describe('Account ID (e.g., acct_xxx)'),
    business_name: z.string().describe('Business display name'),
    email: z.string().describe('Primary email address'),
    country: z.string().describe('Two-letter country code'),
    default_currency: z.string().describe('Default currency code'),
    business_type: z.string().describe('Business type (individual, company, etc.)'),
    livemode: z.boolean().describe('Whether viewing live mode'),
    timezone: z.string().describe('Account timezone'),
  }),
  handle: async () => {
    const merchant = getPageGlobal('PRELOADED.merchant') as Record<string, unknown> | undefined;
    if (!merchant) throw ToolError.internal('Account data not available');
    const livemode = !window.location.pathname.includes('/test/');
    return {
      id: (merchant.id as string) ?? '',
      business_name: (merchant.business_name as string) ?? '',
      email: (merchant.primary_email as string) ?? '',
      country: (merchant.country as string) ?? '',
      default_currency: (merchant.default_currency as string) ?? '',
      business_type: (merchant.business_type as string) ?? '',
      livemode,
      timezone: (merchant.timezone as string) ?? '',
    };
  },
});
