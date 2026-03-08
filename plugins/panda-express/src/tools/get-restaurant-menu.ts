import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../panda-api.js';
import {
  type RawMenuProduct,
  mapMenuCategory,
  mapMenuProduct,
  menuCategorySchema,
  menuProductSchema,
} from './schemas.js';

interface RawMenuCategoryWithProducts {
  id?: number;
  name?: string;
  description?: string;
  products?: RawMenuProduct[];
}

interface RawMenu {
  categories?: RawMenuCategoryWithProducts[];
  imagepath?: string;
}

export const getRestaurantMenu = defineTool({
  name: 'get_restaurant_menu',
  displayName: 'Get Restaurant Menu',
  description:
    'Get the full menu for a specific Panda Express restaurant. Returns categories (e.g., "Bigger Plates", "Sides") with their products including name, description, price, and calories.',
  summary: 'Get menu for a Panda Express location',
  icon: 'utensils',
  group: 'Menu',
  input: z.object({
    restaurant_id: z.number().int().describe('Restaurant ID (from find_restaurants)'),
  }),
  output: z.object({
    categories: z.array(menuCategorySchema).describe('Menu categories'),
    products: z.array(menuProductSchema).describe('All menu products across categories'),
  }),
  handle: async params => {
    const data = await api<RawMenu>(`/restaurants/${params.restaurant_id}/menu`);
    const imagePath = data.imagepath ?? '';
    const categories = (data.categories ?? []).map(mapMenuCategory);
    const products = (data.categories ?? []).flatMap(cat =>
      (cat.products ?? []).map(p => mapMenuProduct(p, cat.name ?? '', imagePath)),
    );
    return { categories, products };
  },
});
