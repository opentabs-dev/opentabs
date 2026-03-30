import { z } from 'zod';

// --- Paginated response envelope ---

export interface RHPaginated<T> {
  next?: string | null;
  previous?: string | null;
  results?: T[];
}

// --- User ---

export const userSchema = z.object({
  id: z.string().describe('User UUID'),
  username: z.string().describe('Robinhood username'),
  email: z.string().describe('Email address'),
  first_name: z.string().describe('First name'),
  last_name: z.string().describe('Last name'),
  created_at: z.string().describe('Account creation ISO 8601 timestamp'),
});

export interface RawUser {
  id?: string;
  username?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  created_at?: string;
}

export const mapUser = (u: RawUser) => ({
  id: u.id ?? '',
  username: u.username ?? '',
  email: u.email ?? '',
  first_name: u.first_name ?? '',
  last_name: u.last_name ?? '',
  created_at: u.created_at ?? '',
});

// --- Account ---

export const accountSchema = z.object({
  account_number: z.string().describe('Brokerage account number'),
  type: z.string().describe('Account type (e.g., margin, cash)'),
  brokerage_account_type: z.string().describe('Brokerage account type (e.g., individual)'),
  buying_power: z.string().describe('Total buying power in USD'),
  cash: z.string().describe('Cash balance in USD'),
  cash_available_for_withdrawal: z.string().describe('Cash available for withdrawal in USD'),
  cash_held_for_orders: z.string().describe('Cash held for pending orders in USD'),
  portfolio_cash: z.string().describe('Portfolio cash balance in USD'),
  deactivated: z.boolean().describe('Whether the account is deactivated'),
  created_at: z.string().describe('Account creation ISO 8601 timestamp'),
});

export interface RawAccount {
  account_number?: string;
  type?: string;
  brokerage_account_type?: string;
  buying_power?: string;
  cash?: string;
  cash_available_for_withdrawal?: string;
  cash_held_for_orders?: string;
  portfolio_cash?: string;
  deactivated?: boolean;
  created_at?: string;
}

export const mapAccount = (a: RawAccount) => ({
  account_number: a.account_number ?? '',
  type: a.type ?? '',
  brokerage_account_type: a.brokerage_account_type ?? '',
  buying_power: a.buying_power ?? '0',
  cash: a.cash ?? '0',
  cash_available_for_withdrawal: a.cash_available_for_withdrawal ?? '0',
  cash_held_for_orders: a.cash_held_for_orders ?? '0',
  portfolio_cash: a.portfolio_cash ?? '0',
  deactivated: a.deactivated ?? false,
  created_at: a.created_at ?? '',
});

// --- Portfolio ---

export const portfolioSchema = z.object({
  equity: z.string().describe('Total portfolio equity in USD'),
  market_value: z.string().describe('Total market value of holdings in USD'),
  excess_margin: z.string().describe('Excess margin in USD'),
  extended_hours_equity: z.string().describe('Extended hours equity in USD'),
  extended_hours_market_value: z.string().describe('Extended hours market value in USD'),
  equity_previous_close: z.string().describe('Portfolio equity at previous close in USD'),
  start_date: z.string().describe('Portfolio start date (YYYY-MM-DD)'),
});

export interface RawPortfolio {
  equity?: string;
  market_value?: string;
  excess_margin?: string;
  extended_hours_equity?: string;
  extended_hours_market_value?: string;
  equity_previous_close?: string;
  start_date?: string;
}

export const mapPortfolio = (p: RawPortfolio) => ({
  equity: p.equity ?? '0',
  market_value: p.market_value ?? '0',
  excess_margin: p.excess_margin ?? '0',
  extended_hours_equity: p.extended_hours_equity ?? '0',
  extended_hours_market_value: p.extended_hours_market_value ?? '0',
  equity_previous_close: p.equity_previous_close ?? '0',
  start_date: p.start_date ?? '',
});

// --- Position ---

export const positionSchema = z.object({
  instrument_id: z.string().describe('Instrument UUID'),
  symbol: z.string().describe('Ticker symbol'),
  quantity: z.string().describe('Number of shares held'),
  average_buy_price: z.string().describe('Average cost basis per share in USD'),
  shares_available_for_sells: z.string().describe('Shares available to sell'),
  created_at: z.string().describe('Position opened ISO 8601 timestamp'),
});

export interface RawPosition {
  instrument_id?: string;
  symbol?: string;
  quantity?: string;
  average_buy_price?: string;
  shares_available_for_sells?: string;
  created_at?: string;
}

export const mapPosition = (p: RawPosition) => ({
  instrument_id: p.instrument_id ?? '',
  symbol: p.symbol ?? '',
  quantity: p.quantity ?? '0',
  average_buy_price: p.average_buy_price ?? '0',
  shares_available_for_sells: p.shares_available_for_sells ?? '0',
  created_at: p.created_at ?? '',
});

// --- Quote ---

export const quoteSchema = z.object({
  symbol: z.string().describe('Ticker symbol'),
  ask_price: z.string().describe('Current ask price in USD'),
  bid_price: z.string().describe('Current bid price in USD'),
  last_trade_price: z.string().describe('Last trade price in USD'),
  last_extended_hours_trade_price: z.string().describe('Last extended hours trade price in USD'),
  previous_close: z.string().describe('Previous closing price in USD'),
  adjusted_previous_close: z.string().describe('Adjusted previous close in USD'),
  trading_halted: z.boolean().describe('Whether trading is halted'),
  updated_at: z.string().describe('Quote last updated ISO 8601 timestamp'),
});

export interface RawQuote {
  symbol?: string;
  ask_price?: string;
  bid_price?: string;
  last_trade_price?: string;
  last_extended_hours_trade_price?: string;
  previous_close?: string;
  adjusted_previous_close?: string;
  trading_halted?: boolean;
  updated_at?: string;
}

export const mapQuote = (q: RawQuote) => ({
  symbol: q.symbol ?? '',
  ask_price: q.ask_price ?? '0',
  bid_price: q.bid_price ?? '0',
  last_trade_price: q.last_trade_price ?? '0',
  last_extended_hours_trade_price: q.last_extended_hours_trade_price ?? '',
  previous_close: q.previous_close ?? '0',
  adjusted_previous_close: q.adjusted_previous_close ?? '0',
  trading_halted: q.trading_halted ?? false,
  updated_at: q.updated_at ?? '',
});

// --- Instrument ---

export const instrumentSchema = z.object({
  id: z.string().describe('Instrument UUID'),
  symbol: z.string().describe('Ticker symbol'),
  simple_name: z.string().describe('Simple display name (e.g., "Apple")'),
  name: z.string().describe('Full legal name (e.g., "Apple Inc. Common Stock")'),
  type: z.string().describe('Instrument type (e.g., stock, etp, adr)'),
  country: z.string().describe('Country code (e.g., US)'),
  state: z.string().describe('Instrument state (e.g., active)'),
  tradeable: z.boolean().describe('Whether the instrument is tradeable'),
  list_date: z.string().describe('IPO / listing date (YYYY-MM-DD)'),
});

export interface RawInstrument {
  id?: string;
  symbol?: string;
  simple_name?: string;
  name?: string;
  type?: string;
  country?: string;
  state?: string;
  tradeable?: boolean;
  list_date?: string;
}

export const mapInstrument = (i: RawInstrument) => ({
  id: i.id ?? '',
  symbol: i.symbol ?? '',
  simple_name: i.simple_name ?? '',
  name: i.name ?? '',
  type: i.type ?? '',
  country: i.country ?? '',
  state: i.state ?? '',
  tradeable: i.tradeable ?? false,
  list_date: i.list_date ?? '',
});

// --- Fundamentals ---

export const fundamentalsSchema = z.object({
  market_cap: z.string().describe('Market capitalization in USD'),
  pe_ratio: z.string().describe('Price-to-earnings ratio'),
  pb_ratio: z.string().describe('Price-to-book ratio'),
  dividend_yield: z.string().describe('Dividend yield as a percentage'),
  high_52_weeks: z.string().describe('52-week high price in USD'),
  low_52_weeks: z.string().describe('52-week low price in USD'),
  average_volume: z.string().describe('Average trading volume'),
  volume: z.string().describe('Current trading volume'),
  open: z.string().describe('Today open price in USD'),
  high: z.string().describe('Today high price in USD'),
  low: z.string().describe('Today low price in USD'),
  description: z.string().describe('Company description'),
  shares_outstanding: z.string().describe('Number of shares outstanding'),
});

export interface RawFundamentals {
  market_cap?: string;
  pe_ratio?: string | null;
  pb_ratio?: string | null;
  dividend_yield?: string | null;
  high_52_weeks?: string;
  low_52_weeks?: string;
  average_volume?: string;
  volume?: string;
  open?: string;
  high?: string;
  low?: string;
  description?: string;
  shares_outstanding?: string;
}

export const mapFundamentals = (f: RawFundamentals) => ({
  market_cap: f.market_cap ?? '0',
  pe_ratio: f.pe_ratio ?? '',
  pb_ratio: f.pb_ratio ?? '',
  dividend_yield: f.dividend_yield ?? '',
  high_52_weeks: f.high_52_weeks ?? '0',
  low_52_weeks: f.low_52_weeks ?? '0',
  average_volume: f.average_volume ?? '0',
  volume: f.volume ?? '0',
  open: f.open ?? '0',
  high: f.high ?? '0',
  low: f.low ?? '0',
  description: f.description ?? '',
  shares_outstanding: f.shares_outstanding ?? '0',
});

// --- Historical data point ---

export const historicalSchema = z.object({
  begins_at: z.string().describe('Period start ISO 8601 timestamp'),
  open_price: z.string().describe('Open price in USD'),
  close_price: z.string().describe('Close price in USD'),
  high_price: z.string().describe('High price in USD'),
  low_price: z.string().describe('Low price in USD'),
  volume: z.number().describe('Trading volume'),
});

export interface RawHistorical {
  begins_at?: string;
  open_price?: string;
  close_price?: string;
  high_price?: string;
  low_price?: string;
  volume?: number;
}

export const mapHistorical = (h: RawHistorical) => ({
  begins_at: h.begins_at ?? '',
  open_price: h.open_price ?? '0',
  close_price: h.close_price ?? '0',
  high_price: h.high_price ?? '0',
  low_price: h.low_price ?? '0',
  volume: h.volume ?? 0,
});

// --- Order ---

export const orderSchema = z.object({
  id: z.string().describe('Order UUID'),
  instrument_id: z.string().describe('Instrument UUID'),
  side: z.string().describe('Order side: buy or sell'),
  type: z.string().describe('Order type: market, limit, stop, stop_limit'),
  state: z.string().describe('Order state: filled, cancelled, confirmed, queued, rejected, etc.'),
  quantity: z.string().describe('Ordered quantity'),
  cumulative_quantity: z.string().describe('Filled quantity'),
  average_price: z.string().describe('Average fill price in USD'),
  price: z.string().describe('Limit price in USD (empty for market orders)'),
  time_in_force: z.string().describe('Time in force: gfd, gtc, ioc, opg'),
  created_at: z.string().describe('Order created ISO 8601 timestamp'),
  updated_at: z.string().describe('Order updated ISO 8601 timestamp'),
});

export interface RawOrder {
  id?: string;
  instrument_id?: string;
  instrument?: string;
  side?: string;
  type?: string;
  state?: string;
  quantity?: string;
  cumulative_quantity?: string;
  average_price?: string | null;
  price?: string | null;
  time_in_force?: string;
  created_at?: string;
  updated_at?: string;
}

export const mapOrder = (o: RawOrder) => ({
  id: o.id ?? '',
  instrument_id: o.instrument_id ?? '',
  side: o.side ?? '',
  type: o.type ?? '',
  state: o.state ?? '',
  quantity: o.quantity ?? '0',
  cumulative_quantity: o.cumulative_quantity ?? '0',
  average_price: o.average_price ?? '',
  price: o.price ?? '',
  time_in_force: o.time_in_force ?? '',
  created_at: o.created_at ?? '',
  updated_at: o.updated_at ?? '',
});

// --- Dividend ---

export const dividendSchema = z.object({
  id: z.string().describe('Dividend UUID'),
  instrument_id: z.string().describe('Instrument UUID (extracted from instrument URL)'),
  amount: z.string().describe('Dividend amount in USD'),
  rate: z.string().describe('Dividend rate per share in USD'),
  position: z.string().describe('Share quantity at record date'),
  state: z.string().describe('Dividend state: paid, pending, voided, reinvested'),
  record_date: z.string().describe('Record date (YYYY-MM-DD)'),
  payable_date: z.string().describe('Payable date (YYYY-MM-DD)'),
  paid_at: z.string().describe('Actual payment ISO 8601 timestamp'),
});

export interface RawDividend {
  id?: string;
  instrument?: string;
  amount?: string;
  rate?: string;
  position?: string;
  state?: string;
  record_date?: string;
  payable_date?: string;
  paid_at?: string | null;
}

const extractIdFromUrl = (url?: string): string => {
  if (!url) return '';
  const parts = url.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
};

export const mapDividend = (d: RawDividend) => ({
  id: d.id ?? '',
  instrument_id: extractIdFromUrl(d.instrument),
  amount: d.amount ?? '0',
  rate: d.rate ?? '0',
  position: d.position ?? '0',
  state: d.state ?? '',
  record_date: d.record_date ?? '',
  payable_date: d.payable_date ?? '',
  paid_at: d.paid_at ?? '',
});

// --- Transfer ---

export const transferSchema = z.object({
  id: z.string().describe('Transfer UUID'),
  amount: z.string().describe('Transfer amount in USD'),
  direction: z.string().describe('Transfer direction: deposit or withdraw'),
  state: z.string().describe('Transfer state: pending, completed, cancelled'),
  created_at: z.string().describe('Transfer created ISO 8601 timestamp'),
  expected_landing_date: z.string().describe('Expected completion date'),
});

export interface RawTransfer {
  id?: string;
  amount?: string;
  direction?: string;
  state?: string;
  created_at?: string;
  expected_landing_date?: string | null;
}

export const mapTransfer = (t: RawTransfer) => ({
  id: t.id ?? '',
  amount: t.amount ?? '0',
  direction: t.direction ?? '',
  state: t.state ?? '',
  created_at: t.created_at ?? '',
  expected_landing_date: t.expected_landing_date ?? '',
});

// --- Earnings ---

export const earningsSchema = z.object({
  symbol: z.string().describe('Ticker symbol'),
  year: z.number().describe('Fiscal year'),
  quarter: z.number().describe('Fiscal quarter (1-4)'),
  eps_estimate: z.string().describe('Estimated EPS'),
  eps_actual: z.string().describe('Actual EPS (empty if not reported)'),
  report_date: z.string().describe('Report date (YYYY-MM-DD)'),
  report_timing: z.string().describe('Report timing: am, pm, or empty'),
});

export interface RawEarnings {
  symbol?: string;
  year?: number;
  quarter?: number;
  eps?: { estimate?: string; actual?: string | null };
  report?: { date?: string; timing?: string };
}

export const mapEarnings = (e: RawEarnings) => ({
  symbol: e.symbol ?? '',
  year: e.year ?? 0,
  quarter: e.quarter ?? 0,
  eps_estimate: e.eps?.estimate ?? '',
  eps_actual: e.eps?.actual ?? '',
  report_date: e.report?.date ?? '',
  report_timing: e.report?.timing ?? '',
});

// --- Rating ---

export const ratingSummarySchema = z.object({
  num_buy_ratings: z.number().describe('Number of buy recommendations'),
  num_hold_ratings: z.number().describe('Number of hold recommendations'),
  num_sell_ratings: z.number().describe('Number of sell recommendations'),
});

export const ratingSchema = z.object({
  published_at: z.string().describe('Rating published ISO 8601 timestamp'),
  type: z.string().describe('Rating type: buy, hold, or sell'),
  text: z.string().describe('Analyst commentary text'),
});

export interface RawRatingSummary {
  num_buy_ratings?: number;
  num_hold_ratings?: number;
  num_sell_ratings?: number;
}

export interface RawRating {
  published_at?: string;
  type?: string;
  text?: string;
}

export const mapRatingSummary = (s: RawRatingSummary) => ({
  num_buy_ratings: s.num_buy_ratings ?? 0,
  num_hold_ratings: s.num_hold_ratings ?? 0,
  num_sell_ratings: s.num_sell_ratings ?? 0,
});

export const mapRating = (r: RawRating) => ({
  published_at: r.published_at ?? '',
  type: r.type ?? '',
  text: r.text ?? '',
});

// --- Market Hours ---

export const marketHoursSchema = z.object({
  date: z.string().describe('Date (YYYY-MM-DD)'),
  is_open: z.boolean().describe('Whether the market is open on this date'),
  opens_at: z.string().describe('Market open ISO 8601 timestamp'),
  closes_at: z.string().describe('Market close ISO 8601 timestamp'),
  extended_opens_at: z.string().describe('Extended hours open ISO 8601 timestamp'),
  extended_closes_at: z.string().describe('Extended hours close ISO 8601 timestamp'),
});

export interface RawMarketHours {
  date?: string;
  is_open?: boolean;
  opens_at?: string | null;
  closes_at?: string | null;
  extended_opens_at?: string | null;
  extended_closes_at?: string | null;
}

export const mapMarketHours = (h: RawMarketHours) => ({
  date: h.date ?? '',
  is_open: h.is_open ?? false,
  opens_at: h.opens_at ?? '',
  closes_at: h.closes_at ?? '',
  extended_opens_at: h.extended_opens_at ?? '',
  extended_closes_at: h.extended_closes_at ?? '',
});

// --- Crypto Holding ---

export const cryptoHoldingSchema = z.object({
  currency_code: z.string().describe('Cryptocurrency code (e.g., BTC)'),
  quantity: z.string().describe('Amount of cryptocurrency held'),
  cost_basis: z.string().describe('Total cost basis in USD'),
  quantity_available: z.string().describe('Quantity available for trading'),
});

export interface RawCryptoHolding {
  currency?: { code?: string };
  quantity_available?: string;
  cost_bases?: { direct_cost_basis?: string; direct_quantity?: string }[];
}

export const mapCryptoHolding = (h: RawCryptoHolding) => {
  const totalQuantity =
    h.cost_bases?.reduce((sum, cb) => sum + Number.parseFloat(cb.direct_quantity ?? '0'), 0).toString() ?? '0';
  const totalCostBasis =
    h.cost_bases?.reduce((sum, cb) => sum + Number.parseFloat(cb.direct_cost_basis ?? '0'), 0).toString() ?? '0';
  return {
    currency_code: h.currency?.code ?? '',
    quantity: totalQuantity,
    cost_basis: totalCostBasis,
    quantity_available: h.quantity_available ?? '0',
  };
};

// --- Notification ---

export const notificationSchema = z.object({
  id: z.string().describe('Notification card ID'),
  type: z.string().describe('Notification type identifier'),
  title: z.string().describe('Notification title'),
  message: z.string().describe('Notification message body'),
});

export interface RawNotification {
  card_id?: string;
  type?: string;
  title?: string;
  message?: string;
}

export const mapNotification = (n: RawNotification) => ({
  id: n.card_id ?? '',
  type: n.type ?? '',
  title: n.title ?? '',
  message: n.message ?? '',
});

// --- Watchlist / Discovery List ---

export const watchlistSchema = z.object({
  id: z.string().describe('List UUID'),
  display_name: z.string().describe('List display name'),
  item_count: z.number().describe('Number of items in the list'),
  owner_type: z.string().describe('List ownership type (e.g., custom, default)'),
  icon_emoji: z.string().describe('Emoji icon for the list'),
  created_at: z.string().describe('List created ISO 8601 timestamp'),
});

export interface RawWatchlist {
  id?: string;
  display_name?: string;
  item_count?: number;
  owner_type?: string;
  icon_emoji?: string;
  created_at?: string;
}

export const mapWatchlist = (w: RawWatchlist) => ({
  id: w.id ?? '',
  display_name: w.display_name ?? '',
  item_count: w.item_count ?? 0,
  owner_type: w.owner_type ?? '',
  icon_emoji: w.icon_emoji ?? '',
  created_at: w.created_at ?? '',
});

// --- News Feed Item ---

export const newsFeedItemSchema = z.object({
  category: z.string().describe('Feed category (e.g., news, indicators)'),
  display_label: z.string().describe('Display label for the category'),
  content_count: z.number().describe('Number of content items in this category'),
});

export interface RawNewsFeedItem {
  category?: string;
  display_label?: string;
  contents?: unknown[];
}

export const mapNewsFeedItem = (f: RawNewsFeedItem) => ({
  category: f.category ?? '',
  display_label: f.display_label ?? '',
  content_count: f.contents?.length ?? 0,
});
