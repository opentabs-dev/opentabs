import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api, getRequiredAuthToken } from '../panda-api.js';

const billingAccountSchema = z.object({
  id: z.number().describe('Billing account ID'),
  card_type: z.string().describe('Card type (e.g., "Visa", "Mastercard")'),
  card_suffix: z.string().describe('Last 4 digits of the card number'),
  expiration: z.string().describe('Card expiration date (MM/YY)'),
  is_default: z.boolean().describe('Whether this is the default payment method'),
});

interface RawBillingAccount {
  accountid?: number;
  cardtype?: string;
  cardsuffix?: string;
  expiration?: string;
  isdefault?: boolean;
}

const mapBillingAccount = (a: RawBillingAccount) => ({
  id: a.accountid ?? 0,
  card_type: a.cardtype ?? '',
  card_suffix: a.cardsuffix ?? '',
  expiration: a.expiration ?? '',
  is_default: a.isdefault ?? false,
});

export const getBillingAccounts = defineTool({
  name: 'get_billing_accounts',
  displayName: 'Get Billing Accounts',
  description:
    "Get the authenticated user's saved payment methods. Returns card type, last 4 digits, and default status.",
  summary: 'View your saved payment methods',
  icon: 'credit-card',
  group: 'Account',
  input: z.object({}),
  output: z.object({
    accounts: z.array(billingAccountSchema).describe('Saved billing accounts'),
  }),
  handle: async () => {
    const authtoken = getRequiredAuthToken();
    const data = await api<{ billingaccounts?: RawBillingAccount[] }>(`/users/${authtoken}/billingaccounts`);
    return { accounts: (data.billingaccounts ?? []).map(mapBillingAccount) };
  },
});
