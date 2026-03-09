import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated, waitForAuth } from './robinhood-api.js';
import { createWatchlist } from './tools/create-watchlist.js';
import { deleteWatchlist } from './tools/delete-watchlist.js';
import { getAccount } from './tools/get-account.js';
import { getCurrentUser } from './tools/get-current-user.js';
import { getEarnings } from './tools/get-earnings.js';
import { getFundamentals } from './tools/get-fundamentals.js';
import { getHistoricals } from './tools/get-historicals.js';
import { getInstrument } from './tools/get-instrument.js';
import { getMarketHours } from './tools/get-market-hours.js';
import { getNewsFeed } from './tools/get-news-feed.js';
import { getPortfolioHistoricals } from './tools/get-portfolio-historicals.js';
import { getPortfolio } from './tools/get-portfolio.js';
import { getQuote } from './tools/get-quote.js';
import { getRatings } from './tools/get-ratings.js';
import { getWatchlist } from './tools/get-watchlist.js';
import { listCryptoHoldings } from './tools/list-crypto-holdings.js';
import { listDividends } from './tools/list-dividends.js';
import { listNotifications } from './tools/list-notifications.js';
import { listOrders } from './tools/list-orders.js';
import { listPositions } from './tools/list-positions.js';
import { listTransfers } from './tools/list-transfers.js';
import { listWatchlists } from './tools/list-watchlists.js';
import { searchInstruments } from './tools/search-instruments.js';

class RobinhoodPlugin extends OpenTabsPlugin {
  readonly name = 'robinhood';
  readonly description = 'OpenTabs plugin for Robinhood';
  override readonly displayName = 'Robinhood';
  readonly urlPatterns = ['*://*.robinhood.com/*'];
  override readonly homepage = 'https://robinhood.com';
  readonly tools: ToolDefinition[] = [
    // Account
    getCurrentUser,
    getAccount,
    listTransfers,
    listNotifications,
    // Portfolio
    getPortfolio,
    getPortfolioHistoricals,
    listPositions,
    listCryptoHoldings,
    listDividends,
    // Market Data
    getQuote,
    getFundamentals,
    getHistoricals,
    getEarnings,
    getRatings,
    getInstrument,
    searchInstruments,
    getMarketHours,
    getNewsFeed,
    // Orders (read-only)
    listOrders,
    // Lists
    listWatchlists,
    getWatchlist,
    createWatchlist,
    deleteWatchlist,
  ];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    return waitForAuth();
  }
}

export default new RobinhoodPlugin();
