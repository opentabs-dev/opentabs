import { z } from 'zod';

// --- Currency formatting ---
// YNAB stores amounts in milliunits (1000 = 1 currency unit, e.g. $1.00 = 1000)

export const formatMilliunits = (milliunits: number): string => {
  const amount = milliunits / 1000;
  return amount.toFixed(2);
};

// --- Shared output schemas ---

export const userSchema = z.object({
  id: z.string().describe('User ID'),
  first_name: z.string().describe('First name'),
  email: z.string().describe('Email address'),
});

export const planSchema = z.object({
  id: z.string().describe('Plan (budget version) ID used in API calls'),
  budget_id: z.string().describe('Underlying budget ID'),
  name: z.string().describe('Plan name'),
  date_format: z.string().describe('Date format string (e.g. MM/DD/YYYY)'),
  currency_symbol: z.string().describe('Currency symbol (e.g. $)'),
  currency_iso_code: z.string().describe('Currency ISO code (e.g. USD)'),
});

export const accountSchema = z.object({
  id: z.string().describe('Account ID'),
  name: z.string().describe('Account name'),
  type: z.string().describe('Account type (e.g. checking, savings, creditCard)'),
  on_budget: z.boolean().describe('Whether this account is on-budget'),
  closed: z.boolean().describe('Whether the account is closed'),
  balance: z.string().describe('Current balance formatted as currency string'),
  balance_milliunits: z.number().describe('Current balance in milliunits'),
  cleared_balance: z.string().describe('Cleared balance formatted as currency string'),
  uncleared_balance: z.string().describe('Uncleared balance formatted as currency string'),
  note: z.string().describe('Account note'),
});

export const categoryGroupSchema = z.object({
  id: z.string().describe('Category group ID'),
  name: z.string().describe('Category group name'),
  hidden: z.boolean().describe('Whether the group is hidden'),
});

export const categorySchema = z.object({
  id: z.string().describe('Category ID'),
  category_group_id: z.string().describe('Parent category group ID'),
  name: z.string().describe('Category name'),
  hidden: z.boolean().describe('Whether the category is hidden'),
  budgeted: z.string().describe('Amount budgeted this month as currency string'),
  activity: z.string().describe('Spending activity this month as currency string'),
  balance: z.string().describe('Available balance as currency string'),
  budgeted_milliunits: z.number().describe('Amount budgeted in milliunits'),
  activity_milliunits: z.number().describe('Activity in milliunits'),
  balance_milliunits: z.number().describe('Balance in milliunits'),
  goal_type: z.string().describe('Goal type (TB, TBD, MF, NEED, DEBT, or empty if none)'),
  goal_target: z.string().describe('Goal target amount as currency string'),
  goal_percentage_complete: z.number().describe('Goal completion percentage (0-100)'),
});

export const payeeSchema = z.object({
  id: z.string().describe('Payee ID'),
  name: z.string().describe('Payee name'),
  transfer_account_id: z.string().describe('If a transfer payee, the linked account ID'),
});

export const transactionSchema = z.object({
  id: z.string().describe('Transaction ID'),
  date: z.string().describe('Transaction date (YYYY-MM-DD)'),
  amount: z.string().describe('Transaction amount as currency string'),
  amount_milliunits: z.number().describe('Transaction amount in milliunits'),
  memo: z.string().describe('Transaction memo'),
  cleared: z.string().describe('Cleared status: cleared, uncleared, or reconciled'),
  approved: z.boolean().describe('Whether the transaction is approved'),
  flag_color: z.string().describe('Flag color or empty string'),
  flag_name: z.string().describe('Custom flag name or empty string'),
  account_id: z.string().describe('Account ID'),
  account_name: z.string().describe('Account name'),
  payee_id: z.string().describe('Payee ID'),
  payee_name: z.string().describe('Payee name'),
  category_id: z.string().describe('Category ID'),
  category_name: z.string().describe('Category name'),
  transfer_account_id: z.string().describe('If a transfer, the destination account ID'),
  import_id: z.string().describe('Import ID for deduplication'),
  deleted: z.boolean().describe('Whether the transaction is deleted'),
});

export const subtransactionSchema = z.object({
  id: z.string().describe('Subtransaction ID'),
  transaction_id: z.string().describe('Parent transaction ID'),
  amount: z.string().describe('Subtransaction amount as currency string'),
  amount_milliunits: z.number().describe('Subtransaction amount in milliunits'),
  memo: z.string().describe('Subtransaction memo'),
  payee_id: z.string().describe('Payee ID'),
  payee_name: z.string().describe('Payee name'),
  category_id: z.string().describe('Category ID'),
  category_name: z.string().describe('Category name'),
  transfer_account_id: z.string().describe('If a transfer, the destination account ID'),
  deleted: z.boolean().describe('Whether the subtransaction is deleted'),
});

export const monthSchema = z.object({
  month: z.string().describe('Month in YYYY-MM-DD format (first of month)'),
  income: z.string().describe('Total income as currency string'),
  budgeted: z.string().describe('Total budgeted as currency string'),
  activity: z.string().describe('Total activity as currency string'),
  to_be_budgeted: z.string().describe('Ready to Assign amount as currency string'),
  income_milliunits: z.number().describe('Total income in milliunits'),
  budgeted_milliunits: z.number().describe('Total budgeted in milliunits'),
  activity_milliunits: z.number().describe('Total activity in milliunits'),
  to_be_budgeted_milliunits: z.number().describe('Ready to Assign in milliunits'),
  age_of_money: z.number().describe('Age of money in days'),
});

export const scheduledTransactionSchema = z.object({
  id: z.string().describe('Scheduled transaction ID'),
  date_first: z.string().describe('First occurrence date (YYYY-MM-DD)'),
  date_next: z.string().describe('Next occurrence date (YYYY-MM-DD)'),
  frequency: z
    .string()
    .describe(
      'Recurrence frequency (never, daily, weekly, everyOtherWeek, twiceAMonth, every4Weeks, monthly, everyOtherMonth, every3Months, every4Months, twiceAYear, yearly, everyOtherYear)',
    ),
  amount: z.string().describe('Scheduled amount as currency string'),
  amount_milliunits: z.number().describe('Scheduled amount in milliunits'),
  memo: z.string().describe('Scheduled transaction memo'),
  flag_color: z.string().describe('Flag color or empty string'),
  account_id: z.string().describe('Account ID'),
  account_name: z.string().describe('Account name'),
  payee_id: z.string().describe('Payee ID'),
  payee_name: z.string().describe('Payee name'),
  category_id: z.string().describe('Category ID'),
  category_name: z.string().describe('Category name'),
  deleted: z.boolean().describe('Whether the scheduled transaction is deleted'),
});

// --- Raw interfaces ---
// Field names match the YNAB internal catalog API (be_ entity collections)

export interface RawUser {
  id?: string;
  first_name?: string;
  email?: string;
}

export interface RawPlan {
  id?: string;
  budget_id?: string;
  budget_name?: string;
  date_format?: string;
  currency_format?: string;
}

export interface RawAccount {
  id?: string;
  account_name?: string;
  account_type?: string;
  on_budget?: boolean;
  is_closed?: boolean;
  note?: string | null;
  is_tombstone?: boolean;
  transfer_payee_id?: string;
}

export interface RawAccountCalculation {
  id?: string;
  entities_account_id?: string;
  cleared_balance?: number;
  uncleared_balance?: number;
  is_tombstone?: boolean;
}

export interface RawCategoryGroup {
  id?: string;
  name?: string;
  is_hidden?: boolean | null;
  is_tombstone?: boolean;
}

export interface RawCategory {
  id?: string;
  entities_master_category_id?: string;
  name?: string;
  is_hidden?: boolean | null;
  budgeted?: number;
  activity?: number;
  balance?: number;
  goal_type?: string | null;
  goal_target?: number | null;
  goal_percentage_complete?: number | null;
  is_tombstone?: boolean;
  note?: string | null;
}

export interface RawPayee {
  id?: string;
  name?: string;
  entities_account_id?: string | null;
  is_tombstone?: boolean;
}

export interface RawTransaction {
  id?: string;
  date?: string;
  amount?: number;
  memo?: string | null;
  cleared?: string;
  approved?: boolean;
  flag_color?: string | null;
  flag_name?: string | null;
  entities_account_id?: string;
  account_name?: string;
  entities_payee_id?: string | null;
  payee_name?: string | null;
  entities_subcategory_id?: string | null;
  category_name?: string | null;
  transfer_account_id?: string | null;
  import_id?: string | null;
  is_tombstone?: boolean;
}

export interface RawSubtransaction {
  id?: string;
  entities_transaction_id?: string;
  amount?: number;
  memo?: string | null;
  entities_payee_id?: string | null;
  payee_name?: string | null;
  entities_subcategory_id?: string | null;
  category_name?: string | null;
  transfer_account_id?: string | null;
  is_tombstone?: boolean;
}

export interface RawMonth {
  month?: string;
  is_tombstone?: boolean;
}

export interface RawMonthlyBudgetCalc {
  entities_monthly_budget_id?: string;
  immediate_income?: number;
  budgeted?: number;
  cash_outflows?: number;
  credit_outflows?: number;
  available_to_budget?: number;
  age_of_money?: number | null;
}

export interface RawMonthlySubcategoryBudgetCalc {
  entities_monthly_subcategory_budget_id?: string;
  budgeted?: number;
  activity?: number;
  balance?: number;
  goal_type?: string | null;
  goal_target?: number | null;
  goal_percentage_complete?: number | null;
}

export interface RawScheduledTransaction {
  id?: string;
  date_first?: string;
  date_next?: string;
  frequency?: string;
  amount?: number;
  memo?: string | null;
  flag_color?: string | null;
  entities_account_id?: string;
  account_name?: string;
  entities_payee_id?: string | null;
  payee_name?: string | null;
  entities_subcategory_id?: string | null;
  category_name?: string | null;
  is_tombstone?: boolean;
}

// --- Defensive mappers ---

export const mapUser = (u: RawUser) => ({
  id: u.id ?? '',
  first_name: u.first_name ?? '',
  email: u.email ?? '',
});

export const mapPlan = (p: RawPlan) => {
  let dateFormat = '';
  let currencySymbol = '$';
  let currencyIsoCode = 'USD';

  try {
    if (p.date_format) {
      const df = JSON.parse(p.date_format) as { format?: string };
      dateFormat = df.format ?? '';
    }
  } catch {
    dateFormat = p.date_format ?? '';
  }

  try {
    if (p.currency_format) {
      const cf = JSON.parse(p.currency_format) as {
        currency_symbol?: string;
        iso_code?: string;
      };
      currencySymbol = cf.currency_symbol ?? '$';
      currencyIsoCode = cf.iso_code ?? 'USD';
    }
  } catch {
    // keep defaults
  }

  return {
    id: p.id ?? '',
    budget_id: p.budget_id ?? '',
    name: p.budget_name ?? '',
    date_format: dateFormat,
    currency_symbol: currencySymbol,
    currency_iso_code: currencyIsoCode,
  };
};

export const mapAccount = (a: RawAccount, calc?: RawAccountCalculation) => ({
  id: a.id ?? '',
  name: a.account_name ?? '',
  type: a.account_type ?? '',
  on_budget: a.on_budget ?? false,
  closed: a.is_closed === true,
  balance: formatMilliunits((calc?.cleared_balance ?? 0) + (calc?.uncleared_balance ?? 0)),
  balance_milliunits: (calc?.cleared_balance ?? 0) + (calc?.uncleared_balance ?? 0),
  cleared_balance: formatMilliunits(calc?.cleared_balance ?? 0),
  uncleared_balance: formatMilliunits(calc?.uncleared_balance ?? 0),
  note: a.note ?? '',
});

export const mapCategoryGroup = (g: RawCategoryGroup) => ({
  id: g.id ?? '',
  name: g.name ?? '',
  hidden: g.is_hidden === true,
});

export const mapCategory = (c: RawCategory) => ({
  id: c.id ?? '',
  category_group_id: c.entities_master_category_id ?? '',
  name: c.name ?? '',
  hidden: c.is_hidden === true,
  budgeted: formatMilliunits(c.budgeted ?? 0),
  activity: formatMilliunits(c.activity ?? 0),
  balance: formatMilliunits(c.balance ?? 0),
  budgeted_milliunits: c.budgeted ?? 0,
  activity_milliunits: c.activity ?? 0,
  balance_milliunits: c.balance ?? 0,
  goal_type: c.goal_type ?? '',
  goal_target: formatMilliunits(c.goal_target ?? 0),
  goal_percentage_complete: c.goal_percentage_complete ?? 0,
});

export const mapPayee = (p: RawPayee) => ({
  id: p.id ?? '',
  name: p.name ?? '',
  transfer_account_id: p.entities_account_id ?? '',
});

export const mapTransaction = (t: RawTransaction) => ({
  id: t.id ?? '',
  date: t.date ?? '',
  amount: formatMilliunits(t.amount ?? 0),
  amount_milliunits: t.amount ?? 0,
  memo: t.memo ?? '',
  cleared: t.cleared ?? 'uncleared',
  approved: t.approved ?? false,
  flag_color: t.flag_color ?? '',
  flag_name: t.flag_name ?? '',
  account_id: t.entities_account_id ?? '',
  account_name: t.account_name ?? '',
  payee_id: t.entities_payee_id ?? '',
  payee_name: t.payee_name ?? '',
  category_id: t.entities_subcategory_id ?? '',
  category_name: t.category_name ?? '',
  transfer_account_id: t.transfer_account_id ?? '',
  import_id: t.import_id ?? '',
  deleted: t.is_tombstone === true,
});

export const mapSubtransaction = (s: RawSubtransaction) => ({
  id: s.id ?? '',
  transaction_id: s.entities_transaction_id ?? '',
  amount: formatMilliunits(s.amount ?? 0),
  amount_milliunits: s.amount ?? 0,
  memo: s.memo ?? '',
  payee_id: s.entities_payee_id ?? '',
  payee_name: s.payee_name ?? '',
  category_id: s.entities_subcategory_id ?? '',
  category_name: s.category_name ?? '',
  transfer_account_id: s.transfer_account_id ?? '',
  deleted: s.is_tombstone === true,
});

export const mapMonth = (m: RawMonth, calc?: RawMonthlyBudgetCalc) => {
  const income = calc?.immediate_income ?? 0;
  const budgeted = calc?.budgeted ?? 0;
  const activity = (calc?.cash_outflows ?? 0) + (calc?.credit_outflows ?? 0);
  const toBeBudgeted = calc?.available_to_budget ?? 0;
  return {
    month: m.month ?? '',
    income: formatMilliunits(income),
    budgeted: formatMilliunits(budgeted),
    activity: formatMilliunits(activity),
    to_be_budgeted: formatMilliunits(toBeBudgeted),
    income_milliunits: income,
    budgeted_milliunits: budgeted,
    activity_milliunits: activity,
    to_be_budgeted_milliunits: toBeBudgeted,
    age_of_money: calc?.age_of_money ?? 0,
  };
};

export const mapScheduledTransaction = (s: RawScheduledTransaction) => ({
  id: s.id ?? '',
  date_first: s.date_first ?? '',
  date_next: s.date_next ?? '',
  frequency: s.frequency ?? 'never',
  amount: formatMilliunits(s.amount ?? 0),
  amount_milliunits: s.amount ?? 0,
  memo: s.memo ?? '',
  flag_color: s.flag_color ?? '',
  account_id: s.entities_account_id ?? '',
  account_name: s.account_name ?? '',
  payee_id: s.entities_payee_id ?? '',
  payee_name: s.payee_name ?? '',
  category_id: s.entities_subcategory_id ?? '',
  category_name: s.category_name ?? '',
  deleted: s.is_tombstone === true,
});
