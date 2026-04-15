import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { waitForAuth } from './carta-api.js';
import { checkFavourite } from './tools/check-favourite.js';
import { getCompanyProfile } from './tools/get-company-profile.js';
import { getCurrentUser } from './tools/get-current-user.js';
import { getEntities } from './tools/get-entities.js';
import { getHoldingsDashboard } from './tools/get-holdings-dashboard.js';
import { getInboxCount } from './tools/get-inbox-count.js';
import { getQsbsEligibility } from './tools/get-qsbs-eligibility.js';
import { getTasks } from './tools/get-tasks.js';
import { getTaxDocuments } from './tools/get-tax-documents.js';
import { getWitnessSignatures } from './tools/get-witness-signatures.js';
import { listAccounts } from './tools/list-accounts.js';
import { listCompanies } from './tools/list-companies.js';
import { listConvertibles } from './tools/list-convertibles.js';
import { listEquityGrants } from './tools/list-equity-grants.js';
import { listOptions } from './tools/list-options.js';
import { listPius } from './tools/list-pius.js';
import { listRsus } from './tools/list-rsus.js';
import { listSars } from './tools/list-sars.js';
import { listShares } from './tools/list-shares.js';
import { listWarrants } from './tools/list-warrants.js';

class CartaPlugin extends OpenTabsPlugin {
  readonly name = 'carta';
  readonly description = 'OpenTabs plugin for Carta';
  override readonly displayName = 'Carta';
  readonly urlPatterns = ['*://app.carta.com/*'];
  override readonly homepage = 'https://app.carta.com';

  readonly tools: ToolDefinition[] = [
    // User & Account
    getCurrentUser,
    listAccounts,
    // Portfolio
    listCompanies,
    getCompanyProfile,
    getEntities,
    checkFavourite,
    // Holdings
    getHoldingsDashboard,
    listOptions,
    listShares,
    listRsus,
    listEquityGrants,
    listConvertibles,
    listWarrants,
    listSars,
    listPius,
    // Tax
    getTaxDocuments,
    getQsbsEligibility,
    // Tasks & Documents
    getTasks,
    getWitnessSignatures,
    // Communication
    getInboxCount,
  ];

  async isReady(): Promise<boolean> {
    return waitForAuth();
  }
}

export default new CartaPlugin();
