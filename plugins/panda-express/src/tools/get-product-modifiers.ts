import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../panda-api.js';

const modifierOptionSchema = z.object({
  id: z.number().describe('Option ID — pass to add_product_to_basket in the options array'),
  name: z.string().describe('Option name (e.g., "Chow Mein", "16.9oz")'),
  cost: z.number().describe('Additional cost for this option (0 if included)'),
  is_default: z.boolean().describe('Whether this option is selected by default'),
});

const modifierGroupSchema = z.object({
  id: z.number().describe('Modifier group ID'),
  name: z.string().describe('Group name (e.g., "Step 1", "Size")'),
  mandatory: z.boolean().describe('Whether a selection is required from this group'),
  options: z.array(modifierOptionSchema).describe('Available options in this group'),
});

interface RawOption {
  id?: number;
  name?: string;
  cost?: number;
  isdefault?: boolean;
}

interface RawGroup {
  id?: number;
  description?: string;
  mandatory?: boolean;
  options?: RawOption[];
}

export const getProductModifiers = defineTool({
  name: 'get_product_modifiers',
  displayName: 'Get Product Modifiers',
  description:
    'Get available modifier options for a menu product. Most products (bowls, plates, combos) require modifier selections (side, entree, drink choices). Use the returned option IDs when calling add_product_to_basket.',
  summary: 'Get customization options for a menu item',
  icon: 'list-checks',
  group: 'Menu',
  input: z.object({
    product_id: z.number().int().describe('Product ID from get_restaurant_menu'),
  }),
  output: z.object({
    groups: z.array(modifierGroupSchema).describe('Modifier groups with their options'),
  }),
  handle: async params => {
    const data = await api<{ optiongroups?: RawGroup[] }>(`/products/${params.product_id}/modifiers`);
    const groups = (data.optiongroups ?? []).map(g => ({
      id: g.id ?? 0,
      name: g.description ?? '',
      mandatory: g.mandatory ?? false,
      options: (g.options ?? []).map(o => ({
        id: o.id ?? 0,
        name: o.name ?? '',
        cost: o.cost ?? 0,
        is_default: o.isdefault ?? false,
      })),
    }));
    return { groups };
  },
});
