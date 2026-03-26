import { z } from 'zod';

// --- User Profile ---

export const userProfileSchema = z.object({
  guest_id: z.string().describe('Target guest ID'),
  first_name: z.string().describe('First name'),
  last_name: z.string().describe('Last name'),
  email: z.string().describe('Email address'),
  phone: z.string().describe('Phone number'),
  loyalty_id: z.string().describe('Target Circle loyalty ID'),
  preferred_store_id: z.string().describe('Preferred store ID'),
  residency_state: z.string().describe('State of residence'),
  has_red_card: z.boolean().describe('Whether user has a Target RedCard'),
  has_payment_card: z.boolean().describe('Whether user has a saved payment card'),
  created_date: z.string().describe('Account creation date (ISO 8601)'),
  base_membership: z.boolean().describe('Whether user has Target Circle base membership'),
  paid_membership: z.boolean().describe('Whether user has Target Circle 360 (paid) membership'),
});

export interface RawUserProfile {
  guest_profile_id?: string;
  profile?: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone_number?: string;
    loyalty_id?: string;
    preferred_store_id?: string;
    residency_state?: string;
    has_red_card?: boolean;
    has_payment_card?: boolean;
    created_date?: string;
  };
  target_membership?: {
    base_membership?: boolean;
    paid_membership?: boolean;
  };
}

export const mapUserProfile = (d: RawUserProfile) => ({
  guest_id: d.guest_profile_id ?? '',
  first_name: d.profile?.first_name ?? '',
  last_name: d.profile?.last_name ?? '',
  email: d.profile?.email ?? '',
  phone: d.profile?.phone_number ?? '',
  loyalty_id: d.profile?.loyalty_id ?? '',
  preferred_store_id: d.profile?.preferred_store_id ?? '',
  residency_state: d.profile?.residency_state ?? '',
  has_red_card: d.profile?.has_red_card ?? false,
  has_payment_card: d.profile?.has_payment_card ?? false,
  created_date: d.profile?.created_date ?? '',
  base_membership: d.target_membership?.base_membership ?? false,
  paid_membership: d.target_membership?.paid_membership ?? false,
});

// --- Loyalty ---

export const loyaltyDetailsSchema = z.object({
  account_status: z.string().describe('Loyalty account status (e.g., Active)'),
  available_balance: z.number().describe('Available Target Circle earnings balance in dollars'),
  lifetime_balance: z.number().describe('Lifetime earnings total in dollars'),
  total_savings: z.number().describe('Total lifetime savings in dollars'),
  vote_balance: z.number().describe('Community votes balance'),
  lifetime_votes: z.number().describe('Lifetime community votes'),
  enrolled_date: z.string().describe('Loyalty enrollment date (YYYY-MM-DD)'),
  expiry_date: z.string().describe('Earnings expiry date (YYYY-MM-DD)'),
  max_slots: z.number().describe('Maximum bonus offer slots'),
  filled_slots: z.number().describe('Currently filled bonus offer slots'),
});

export interface RawLoyaltyDetails {
  account_status?: string;
  available_balance?: number;
  lifetime_balance?: number;
  user_savings?: number;
  vote_balance?: number;
  lifetime_votes?: number;
  enrolled_date?: string;
  expiry_date?: string;
  max_slots?: number;
  filled_slots?: number;
}

export const mapLoyaltyDetails = (d: RawLoyaltyDetails) => ({
  account_status: d.account_status ?? '',
  available_balance: d.available_balance ?? 0,
  lifetime_balance: d.lifetime_balance ?? 0,
  total_savings: d.user_savings ?? 0,
  vote_balance: d.vote_balance ?? 0,
  lifetime_votes: d.lifetime_votes ?? 0,
  enrolled_date: d.enrolled_date ?? '',
  expiry_date: d.expiry_date ?? '',
  max_slots: d.max_slots ?? 0,
  filled_slots: d.filled_slots ?? 0,
});

// --- Savings Summary ---

export const savingsSummarySchema = z.object({
  total_savings: z.number().describe('Total savings in the period'),
  average_savings: z.number().describe('Average savings per purchase'),
  number_of_purchases: z.number().describe('Number of purchases in the period'),
  redcard_savings: z.number().describe('Savings from RedCard'),
  circle_savings: z.number().describe('Savings from Target Circle offers'),
  promotional_savings: z.number().describe('Savings from promotions'),
  last_x_days_savings: z.number().describe('Savings in the last rolling period'),
});

export interface RawSavingsSummary {
  monetary_savings?: {
    savings_summary?: {
      total_savings?: number;
      average_savings?: number;
      number_of_purchases?: number;
      last_x_days_savings?: number;
    };
    savings?: {
      redcard_savings?: number;
      circle_savings?: number;
      promotional_savings?: number;
    };
  };
}

export const mapSavingsSummary = (d: RawSavingsSummary) => ({
  total_savings: d.monetary_savings?.savings_summary?.total_savings ?? 0,
  average_savings: d.monetary_savings?.savings_summary?.average_savings ?? 0,
  number_of_purchases: d.monetary_savings?.savings_summary?.number_of_purchases ?? 0,
  redcard_savings: d.monetary_savings?.savings?.redcard_savings ?? 0,
  circle_savings: d.monetary_savings?.savings?.circle_savings ?? 0,
  promotional_savings: d.monetary_savings?.savings?.promotional_savings ?? 0,
  last_x_days_savings: d.monetary_savings?.savings_summary?.last_x_days_savings ?? 0,
});

// --- Store ---

export const storeSchema = z.object({
  store_id: z.string().describe('Store ID'),
  name: z.string().describe('Store name'),
  status: z.string().describe('Store status (e.g., Open)'),
  distance: z.number().describe('Distance from search location in miles'),
  phone: z.string().describe('Store phone number'),
  address: z.string().describe('Full street address'),
  city: z.string().describe('City'),
  state: z.string().describe('State'),
  zip: z.string().describe('ZIP/postal code'),
});

export interface RawStore {
  store_id?: string;
  location_id?: number;
  location_name?: string;
  store_name?: string;
  status?: string;
  distance?: number;
  main_voice_phone_number?: string;
  store_main_phone?: string;
  mailing_address?: {
    address_line1?: string;
    city?: string;
    state?: string;
    region?: string;
    postal_code?: string;
  };
}

export const mapStore = (s: RawStore) => ({
  store_id: s.store_id ?? String(s.location_id ?? ''),
  name: s.location_name ?? s.store_name ?? '',
  status: s.status ?? '',
  distance: s.distance ?? 0,
  phone: s.main_voice_phone_number ?? s.store_main_phone ?? '',
  address: s.mailing_address?.address_line1 ?? '',
  city: s.mailing_address?.city ?? '',
  state: s.mailing_address?.region ?? s.mailing_address?.state ?? '',
  zip: s.mailing_address?.postal_code ?? '',
});

// --- Product (search result) ---

export const productSummarySchema = z.object({
  tcin: z.string().describe('Target item number (TCIN) — unique product identifier'),
  title: z.string().describe('Product title'),
  price: z.string().describe('Formatted current price (e.g., "$29.99")'),
  brand: z.string().describe('Brand name'),
  rating: z.number().describe('Average rating (0-5)'),
  review_count: z.number().describe('Number of reviews'),
  image_url: z.string().describe('Primary product image URL'),
  url: z.string().describe('Product page URL on target.com'),
});

export interface RawProductSummary {
  tcin?: string;
  item?: {
    product_description?: { title?: string };
    primary_brand?: { name?: string };
    enrichment?: { images?: { primary_image_url?: string } };
  };
  price?: { formatted_current_price?: string };
  ratings_and_reviews?: {
    statistics?: { rating?: { average?: number; count?: number } };
  };
}

export const mapProductSummary = (p: RawProductSummary) => ({
  tcin: p.tcin ?? '',
  title: p.item?.product_description?.title ?? '',
  price: p.price?.formatted_current_price ?? '',
  brand: p.item?.primary_brand?.name ?? '',
  rating: p.ratings_and_reviews?.statistics?.rating?.average ?? 0,
  review_count: p.ratings_and_reviews?.statistics?.rating?.count ?? 0,
  image_url: p.item?.enrichment?.images?.primary_image_url ?? '',
  url: p.tcin ? `https://www.target.com/p/-/A-${p.tcin}` : '',
});

// --- Product (full details) ---

export const productDetailSchema = z.object({
  tcin: z.string().describe('Target item number (TCIN)'),
  title: z.string().describe('Product title'),
  description: z.string().describe('Product description'),
  price: z.string().describe('Formatted current price'),
  brand: z.string().describe('Brand name'),
  rating: z.number().describe('Average rating (0-5)'),
  review_count: z.number().describe('Number of reviews'),
  image_url: z.string().describe('Primary product image URL'),
  bullet_descriptions: z.array(z.string()).describe('Key feature bullet points'),
  url: z.string().describe('Product page URL on target.com'),
});

export interface RawProductDetail {
  tcin?: string;
  item?: {
    product_description?: {
      title?: string;
      downstream_description?: string;
      bullet_descriptions?: string[];
    };
    primary_brand?: { name?: string };
    enrichment?: { images?: { primary_image_url?: string } };
  };
  price?: { formatted_current_price?: string };
  ratings_and_reviews?: {
    statistics?: {
      rating?: { average?: number; count?: number };
      review_count?: number;
    };
  };
}

export const mapProductDetail = (p: RawProductDetail) => ({
  tcin: p.tcin ?? '',
  title: p.item?.product_description?.title ?? '',
  description: stripHtml(p.item?.product_description?.downstream_description ?? ''),
  price: p.price?.formatted_current_price ?? '',
  brand: p.item?.primary_brand?.name ?? '',
  rating: p.ratings_and_reviews?.statistics?.rating?.average ?? 0,
  review_count:
    p.ratings_and_reviews?.statistics?.review_count ?? p.ratings_and_reviews?.statistics?.rating?.count ?? 0,
  image_url: p.item?.enrichment?.images?.primary_image_url ?? '',
  bullet_descriptions: (p.item?.product_description?.bullet_descriptions ?? []).map(stripHtml),
  url: p.tcin ? `https://www.target.com/p/-/A-${p.tcin}` : '',
});

// --- Cart ---

export const cartItemSchema = z.object({
  cart_item_id: z.string().describe('Cart item ID (used for updates/removal)'),
  tcin: z.string().describe('Target item number'),
  title: z.string().describe('Item description'),
  quantity: z.number().int().describe('Quantity in cart'),
  unit_price: z.number().describe('Unit price in dollars'),
  image_url: z.string().describe('Item image URL'),
  fulfillment_type: z.string().describe('Fulfillment type (e.g., SHIP_TO_HOME, STORE_PICKUP)'),
});

export const cartSummarySchema = z.object({
  cart_id: z.string().describe('Cart ID'),
  items_quantity: z.number().int().describe('Total number of items in cart'),
  grand_total: z.number().describe('Grand total in dollars'),
  total_discounts: z.number().describe('Total discounts applied'),
  total_tax: z.number().describe('Total tax amount'),
  items: z.array(cartItemSchema).describe('Cart items'),
});

export interface RawCartItem {
  cart_item_id?: string;
  tcin?: string;
  item_attributes?: { description?: string; image_url?: string };
  quantity?: number;
  unit_price?: number;
  fulfillment?: { type?: string };
}

export interface RawCartView {
  cart_id?: string;
  summary?: {
    items_quantity?: number;
    grand_total?: number;
    total_discounts?: number;
    total_tax?: number;
  };
  cart_items?: RawCartItem[];
}

export const mapCartItem = (i: RawCartItem) => ({
  cart_item_id: i.cart_item_id ?? '',
  tcin: i.tcin ?? '',
  title: i.item_attributes?.description ?? '',
  quantity: i.quantity ?? 0,
  unit_price: i.unit_price ?? 0,
  image_url: i.item_attributes?.image_url ?? '',
  fulfillment_type: i.fulfillment?.type ?? '',
});

export const mapCartView = (d: RawCartView) => ({
  cart_id: d.cart_id ?? '',
  items_quantity: d.summary?.items_quantity ?? 0,
  grand_total: d.summary?.grand_total ?? 0,
  total_discounts: d.summary?.total_discounts ?? 0,
  total_tax: d.summary?.total_tax ?? 0,
  items: (d.cart_items ?? []).map(mapCartItem),
});

// --- Shopping Lists ---

export const shoppingListSchema = z.object({
  list_id: z.string().describe('List ID'),
  list_title: z.string().describe('List title'),
  list_type: z.string().describe('List type (SHOPPING, STARTER)'),
  is_default: z.boolean().describe('Whether this is the default list'),
  pending_items_count: z.number().int().describe('Number of pending items'),
  total_items_count: z.number().int().describe('Total number of items'),
  last_modified: z.string().describe('Last modified timestamp (ISO 8601)'),
});

export interface RawShoppingList {
  list_id?: string;
  list_title?: string;
  list_type?: string;
  default_list?: boolean;
  pending_items_count?: number;
  total_items_count?: number;
  last_modified_ts?: string;
}

export const mapShoppingList = (l: RawShoppingList) => ({
  list_id: l.list_id ?? '',
  list_title: l.list_title ?? '',
  list_type: l.list_type ?? '',
  is_default: l.default_list ?? false,
  pending_items_count: l.pending_items_count ?? 0,
  total_items_count: l.total_items_count ?? 0,
  last_modified: l.last_modified_ts ?? '',
});

// --- Orders ---

export const orderLineSchema = z.object({
  order_line_id: z.string().describe('Order line ID'),
  tcin: z.string().describe('Target item number'),
  description: z.string().describe('Item description'),
  quantity: z.number().int().describe('Quantity ordered'),
  fulfillment_type: z.string().describe('Fulfillment method (e.g., Store Pickup, Shipping)'),
  status: z.string().describe('Line item status'),
  image_url: z.string().describe('Item image URL'),
});

export const orderSchema = z.object({
  order_number: z.string().describe('Order number'),
  placed_date: z.string().describe('Order placed date (ISO 8601)'),
  grand_total: z.string().describe('Order total'),
  purchase_type: z.string().describe('Purchase type (e.g., ONLINE, IN_STORE)'),
  line_count: z.number().int().describe('Number of line items'),
  lines: z.array(orderLineSchema).describe('Order line items'),
});

export interface RawOrderLine {
  order_line_id?: string;
  order_line_key?: string;
  item?: {
    tcin?: string;
    description?: string;
    images?: { primary_image?: string; base_url?: string };
  };
  original_quantity?: number;
  fulfillment_spec?: {
    fulfillment_method?: string;
    status?: { key?: string };
  };
}

export interface RawOrder {
  order_number?: string;
  placed_date?: string;
  summary?: { grand_total?: string };
  order_purchase_type?: string;
  order_lines?: RawOrderLine[];
}

export const mapOrderLine = (l: RawOrderLine) => ({
  order_line_id: l.order_line_id ?? l.order_line_key ?? '',
  tcin: l.item?.tcin ?? '',
  description: stripHtml(l.item?.description ?? ''),
  quantity: l.original_quantity ?? 0,
  fulfillment_type: l.fulfillment_spec?.fulfillment_method ?? '',
  status: l.fulfillment_spec?.status?.key ?? '',
  image_url:
    l.item?.images?.base_url && l.item?.images?.primary_image
      ? `${l.item.images.base_url}${l.item.images.primary_image}`
      : '',
});

export const mapOrder = (o: RawOrder) => ({
  order_number: o.order_number ?? '',
  placed_date: o.placed_date ?? '',
  grand_total: o.summary?.grand_total ?? '',
  purchase_type: o.order_purchase_type ?? '',
  line_count: o.order_lines?.length ?? 0,
  lines: (o.order_lines ?? []).map(mapOrderLine),
});

// --- Helpers ---

/** Strip HTML tags from a string, looping until stable for nested markup */
const stripHtml = (html: string): string => {
  let result = html;
  let prev: string;
  do {
    prev = result;
    result = result.replace(/<[^>]+>/g, '');
  } while (result !== prev);
  return result.trim();
};
