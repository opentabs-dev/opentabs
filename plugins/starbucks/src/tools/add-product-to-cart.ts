import { ToolError, defineTool, getPageGlobal } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../starbucks-api.js';

// The Starbucks cart is managed client-side in Redux. Adding a product dispatches
// an ADD_PRODUCT_TO_CART action with the full product data and selected size.
// The product data must be fetched from the API first.

type ReduxDispatch = (action: { type: string; payload: unknown }) => void;

interface StarbucksStore {
  dispatch?: ReduxDispatch;
}

interface ProductSize {
  name?: string;
  sizeCode?: string;
  sku?: string;
  recipe?: { default?: unknown[] };
  [key: string]: unknown;
}

interface Product {
  name?: string;
  productNumber?: number;
  formCode?: string;
  imageURL?: string;
  productType?: string;
  sizes?: ProductSize[];
  [key: string]: unknown;
}

interface ProductResponse {
  products?: Product[];
}

export const addProductToCart = defineTool({
  name: 'add_product_to_cart',
  displayName: 'Add Product to Cart',
  description:
    'Quick-add a product to the cart by its product code. Get product codes from get_store_menu. Optionally specify a quantity (defaults to 1). The user must have selected a store on the Starbucks website first.',
  summary: 'Add a product to the cart',
  icon: 'plus-circle',
  group: 'Cart',
  input: z.object({
    product_number: z.number().int().describe('Product number from the menu (e.g., 34833)'),
    form: z.string().describe('Product form (e.g., "iced", "hot", "single")'),
    size: z
      .string()
      .optional()
      .describe('Size code (e.g., "Tall", "Grande", "Venti"). Defaults to the product\'s default size.'),
    quantity: z.number().int().min(1).optional().describe('Quantity to add (default 1)'),
    store_number: z.string().describe('Store number for product availability (e.g., "53646-283069")'),
  }),
  output: z.object({
    added: z.boolean().describe('Whether the item was added'),
    item_key: z.string().describe('Cart item key for the added product'),
    name: z.string().describe('Product name'),
    size: z.string().describe('Selected size'),
    sku: z.string().describe('Selected size SKU'),
  }),
  handle: async params => {
    // Fetch the full product data (needed for the Redux cart item)
    const data = await api<ProductResponse>(`/ordering/${params.product_number}/${params.form}`, {
      query: { storeNumber: params.store_number },
    });

    const product = data.products?.[0];
    if (!product) throw ToolError.notFound(`Product ${params.product_number}/${params.form} not found`);

    const sizes = product.sizes ?? [];

    // Find the requested size, or use the default
    let selectedSize: ProductSize | undefined;
    if (params.size) {
      selectedSize = sizes.find(s => s.sizeCode?.toLowerCase() === params.size?.toLowerCase());
      if (!selectedSize)
        throw ToolError.validation(
          `Size "${params.size}" not found. Available: ${sizes.map(s => s.sizeCode).join(', ')}`,
        );
    } else {
      selectedSize = sizes.find(s => (s as Record<string, unknown>).default === true) ?? sizes[0];
    }

    if (!selectedSize) throw ToolError.notFound('No sizes available for this product');

    const sizeCode = selectedSize.sizeCode ?? '';
    const sku = selectedSize.sku ?? '';
    const quantity = params.quantity ?? 1;

    // Build the cart item key (matches Starbucks convention)
    const itemKey = `${params.product_number}/${params.form}:${sizeCode}`;

    // Build the payload matching the ie() function's output
    const payload = {
      product,
      size: selectedSize,
      sizeCode,
      selectedOptions: [],
      quantity,
      timeAdded: Date.now(),
      productImage: product.imageURL ?? '',
      availabilityWhenAdded: 'Available',
      stalenessAdded: false,
      productAddSource: 'opentabs',
    };

    // Dispatch to the Redux store
    const store = getPageGlobal('store') as StarbucksStore | undefined;
    if (!store?.dispatch) throw ToolError.internal('Redux store not available');

    store.dispatch({
      type: 'ADD_PRODUCT_TO_CART',
      payload,
    });

    return {
      added: true,
      item_key: itemKey,
      name: product.name ?? '',
      size: sizeCode,
      sku,
    };
  },
});
