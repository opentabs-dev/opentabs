import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import { createTransaction } from './tools/create-transaction.js';
import { deleteTransaction } from './tools/delete-transaction.js';
import { getAccount } from './tools/get-account.js';
import { getCurrentUser } from './tools/get-current-user.js';
import { getMonth } from './tools/get-month.js';
import { getPlan } from './tools/get-plan.js';
import { getTransaction } from './tools/get-transaction.js';
import { listAccounts } from './tools/list-accounts.js';
import { listCategories } from './tools/list-categories.js';
import { listMonths } from './tools/list-months.js';
import { listPayees } from './tools/list-payees.js';
import { listScheduledTransactions } from './tools/list-scheduled-transactions.js';
import { listTransactions } from './tools/list-transactions.js';
import { moveCategoryBudget } from './tools/move-category-budget.js';
import { updateCategoryBudget } from './tools/update-category-budget.js';
import { updateTransaction } from './tools/update-transaction.js';
import { isAuthenticated, waitForAuth } from './ynab-api.js';

class YnabPlugin extends OpenTabsPlugin {
  readonly name = 'ynab';
  readonly description = 'OpenTabs plugin for YNAB (You Need A Budget)';
  override readonly displayName = 'YNAB';
  readonly urlPatterns = ['*://app.ynab.com/*'];
  override readonly homepage = 'https://app.ynab.com';
  readonly tools: ToolDefinition[] = [
    // Account
    getCurrentUser,
    // Plans
    getPlan,
    // Accounts
    listAccounts,
    getAccount,
    // Categories
    listCategories,
    updateCategoryBudget,
    moveCategoryBudget,
    // Payees
    listPayees,
    // Transactions
    listTransactions,
    getTransaction,
    createTransaction,
    updateTransaction,
    deleteTransaction,
    listScheduledTransactions,
    // Months
    listMonths,
    getMonth,
  ];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForAuth();
  }
}

export default new YnabPlugin();
