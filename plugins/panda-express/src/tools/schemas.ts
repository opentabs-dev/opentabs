import { z } from 'zod';

// --- Restaurant ---

export const restaurantSchema = z.object({
  id: z.number().describe('Restaurant ID'),
  name: z.string().describe('Restaurant name'),
  slug: z.string().describe('URL-friendly slug'),
  street_address: z.string().describe('Street address'),
  city: z.string().describe('City'),
  state: z.string().describe('State abbreviation'),
  zip: z.string().describe('ZIP code'),
  phone: z.string().describe('Phone number'),
  latitude: z.number().describe('Latitude coordinate'),
  longitude: z.number().describe('Longitude coordinate'),
  distance: z.number().describe('Distance from search point in miles'),
  is_available: z.boolean().describe('Whether the restaurant is currently available for orders'),
  is_open: z.boolean().describe('Whether the restaurant is currently open'),
  can_deliver: z.boolean().describe('Whether delivery is available'),
  can_pickup: z.boolean().describe('Whether pickup is available'),
  delivery_fee: z.string().describe('Delivery fee amount'),
  ext_ref: z.string().describe('External reference number'),
});

export interface RawRestaurant {
  id?: number;
  name?: string;
  slug?: string;
  streetaddress?: string;
  city?: string;
  state?: string;
  zip?: string;
  telephone?: string;
  latitude?: number;
  longitude?: number;
  distance?: number;
  isavailable?: boolean;
  isopen?: boolean;
  candeliver?: boolean;
  canpickup?: boolean;
  deliveryfee?: string;
  extref?: string;
}

export const mapRestaurant = (r: RawRestaurant) => ({
  id: r.id ?? 0,
  name: r.name ?? '',
  slug: r.slug ?? '',
  street_address: r.streetaddress ?? '',
  city: r.city ?? '',
  state: r.state ?? '',
  zip: r.zip ?? '',
  phone: r.telephone ?? '',
  latitude: r.latitude ?? 0,
  longitude: r.longitude ?? 0,
  distance: r.distance ?? 0,
  is_available: r.isavailable ?? false,
  is_open: r.isopen ?? false,
  can_deliver: r.candeliver ?? false,
  can_pickup: r.canpickup ?? false,
  delivery_fee: r.deliveryfee ?? '0',
  ext_ref: r.extref ?? '',
});

// --- Menu Category ---

export const menuCategorySchema = z.object({
  id: z.number().describe('Category ID'),
  name: z.string().describe('Category name (e.g., "Bigger Plates", "Sides")'),
  description: z.string().describe('Category description'),
  product_count: z.number().int().describe('Number of products in this category'),
});

export interface RawMenuCategory {
  id?: number;
  name?: string;
  description?: string;
  products?: unknown[];
}

export const mapMenuCategory = (c: RawMenuCategory) => ({
  id: c.id ?? 0,
  name: c.name ?? '',
  description: c.description ?? '',
  product_count: c.products?.length ?? 0,
});

// --- Menu Product ---

export const menuProductSchema = z.object({
  id: z.number().describe('Product ID'),
  name: z.string().describe('Product name (e.g., "Orange Chicken", "Chow Mein")'),
  description: z.string().describe('Product description'),
  cost: z.number().describe('Base cost in dollars'),
  base_calories: z.string().describe('Base calorie count'),
  max_calories: z.string().describe('Maximum calorie count'),
  image_url: z.string().describe('Product image URL'),
  category: z.string().describe('Category name this product belongs to'),
});

export interface RawMenuProduct {
  id?: number;
  name?: string;
  description?: string;
  cost?: number;
  basecalories?: string;
  maxcalories?: string;
  imagefilename?: string;
  images?: Array<{ filename?: string }>;
}

export const mapMenuProduct = (p: RawMenuProduct, categoryName: string, imagePath: string) => ({
  id: p.id ?? 0,
  name: p.name ?? '',
  description: p.description ?? '',
  cost: p.cost ?? 0,
  base_calories: p.basecalories ?? '',
  max_calories: p.maxcalories ?? '',
  image_url: p.images?.[0]?.filename ? `${imagePath}${p.images[0].filename}` : '',
  category: categoryName,
});

// --- Basket ---

export const basketSchema = z.object({
  id: z.string().describe('Basket ID (UUID)'),
  vendor_id: z.number().describe('Restaurant ID'),
  subtotal: z.number().describe('Subtotal before tax'),
  sales_tax: z.number().describe('Sales tax amount'),
  total: z.number().describe('Total amount including tax and fees'),
  product_count: z.number().int().describe('Number of products in the basket'),
  delivery_mode: z.string().describe('Delivery mode (e.g., "pickup", "delivery")'),
  earliest_ready_time: z.string().describe('Earliest ready time as ISO 8601 timestamp'),
  lead_time_minutes: z.number().describe('Estimated lead time in minutes'),
  coupon_discount: z.number().describe('Coupon discount amount'),
});

export interface RawBasket {
  id?: string;
  vendorid?: number;
  subtotal?: number;
  salestax?: number;
  total?: number;
  products?: unknown[];
  deliverymode?: string;
  earliestreadytime?: string;
  leadtimeestimateminutes?: number;
  coupondiscount?: number;
}

export const mapBasket = (b: RawBasket) => ({
  id: b.id ?? '',
  vendor_id: b.vendorid ?? 0,
  subtotal: b.subtotal ?? 0,
  sales_tax: b.salestax ?? 0,
  total: b.total ?? 0,
  product_count: Array.isArray(b.products) ? b.products.length : 0,
  delivery_mode: b.deliverymode ?? '',
  earliest_ready_time: b.earliestreadytime ?? '',
  lead_time_minutes: b.leadtimeestimateminutes ?? 0,
  coupon_discount: b.coupondiscount ?? 0,
});

// --- Basket Product ---

export const basketProductSchema = z.object({
  id: z.number().describe('Basket product instance ID'),
  product_id: z.number().describe('Product ID from the menu'),
  name: z.string().describe('Product name'),
  quantity: z.number().int().describe('Quantity in basket'),
  total_cost: z.number().describe('Total cost for this line item'),
});

export interface RawBasketProduct {
  id?: number;
  productId?: number;
  name?: string;
  quantity?: number;
  totalcost?: number;
}

export const mapBasketProduct = (p: RawBasketProduct) => ({
  id: p.id ?? 0,
  product_id: p.productId ?? 0,
  name: p.name ?? '',
  quantity: p.quantity ?? 0,
  total_cost: p.totalcost ?? 0,
});

// --- Order ---

export const orderSchema = z.object({
  id: z.string().describe('Order ID'),
  vendor_id: z.number().describe('Restaurant ID'),
  vendor_name: z.string().describe('Restaurant name'),
  status: z.string().describe('Order status'),
  subtotal: z.number().describe('Subtotal before tax'),
  sales_tax: z.number().describe('Sales tax'),
  total: z.number().describe('Total amount'),
  delivery_mode: z.string().describe('Delivery mode (e.g., "pickup", "delivery")'),
  time_placed: z.string().describe('Time order was placed as ISO 8601 timestamp'),
  time_ready: z.string().describe('Estimated ready time'),
  product_count: z.number().int().describe('Number of products in the order'),
});

export interface RawOrder {
  id?: string;
  vendorid?: number;
  vendorname?: string;
  status?: string;
  subtotal?: number;
  salestax?: number;
  total?: number;
  deliverymode?: string;
  timeplaced?: string;
  timeready?: string;
  products?: unknown[];
}

export const mapOrder = (o: RawOrder) => ({
  id: o.id ?? '',
  vendor_id: o.vendorid ?? 0,
  vendor_name: o.vendorname ?? '',
  status: o.status ?? '',
  subtotal: o.subtotal ?? 0,
  sales_tax: o.salestax ?? 0,
  total: o.total ?? 0,
  delivery_mode: o.deliverymode ?? '',
  time_placed: o.timeplaced ?? '',
  time_ready: o.timeready ?? '',
  product_count: Array.isArray(o.products) ? o.products.length : 0,
});

// --- Favorite ---

export const favoriteSchema = z.object({
  id: z.number().describe('Favorite ID'),
  name: z.string().describe('Favorite name'),
  vendor_id: z.number().describe('Restaurant ID'),
});

export interface RawFavorite {
  id?: number;
  description?: string;
  vendorid?: number;
}

export const mapFavorite = (f: RawFavorite) => ({
  id: f.id ?? 0,
  name: f.description ?? '',
  vendor_id: f.vendorid ?? 0,
});

// --- Loyalty Reward ---

export const loyaltyRewardSchema = z.object({
  id: z.number().describe('Reward ID'),
  name: z.string().describe('Reward name'),
  description: z.string().describe('Reward description'),
  image_url: z.string().describe('Reward image URL'),
  points_required: z.number().int().describe('Points required to redeem'),
});

export interface RawLoyaltyReward {
  redeemable_id?: number;
  redeemable_name?: string;
  redeemable_description?: string;
  redeemable_image_url?: string;
  points_required_to_redeem?: number;
}

export const mapLoyaltyReward = (r: RawLoyaltyReward) => ({
  id: r.redeemable_id ?? 0,
  name: r.redeemable_name ?? '',
  description: r.redeemable_description ?? '',
  image_url: r.redeemable_image_url ?? '',
  points_required: r.points_required_to_redeem ?? 0,
});
