import { OpenTabsPlugin } from '@opentabs-dev/plugin-sdk';
import type { ToolDefinition } from '@opentabs-dev/plugin-sdk';
import { isAuthenticated, isSharePointWorkbook, waitForAuth } from './excel-api.js';
import { addNamedItem } from './tools/add-named-item.js';
import { addTableColumn } from './tools/add-table-column.js';
import { addTableRow } from './tools/add-table-row.js';
import { addWorksheet } from './tools/add-worksheet.js';
import { calculateWorkbook } from './tools/calculate-workbook.js';
import { clearRange } from './tools/clear-range.js';
import { createChart } from './tools/create-chart.js';
import { createTable } from './tools/create-table.js';
import { deleteChart } from './tools/delete-chart.js';
import { deleteRange } from './tools/delete-range.js';
import { deleteTable } from './tools/delete-table.js';
import { deleteTableRow } from './tools/delete-table-row.js';
import { deleteWorksheet } from './tools/delete-worksheet.js';
import { evaluateFormula } from './tools/evaluate-formula.js';
import { getCurrentUser } from './tools/get-current-user.js';
import { getRange } from './tools/get-range.js';
import { getTableColumns } from './tools/get-table-columns.js';
import { getTableRows } from './tools/get-table-rows.js';
import { getUsedRange } from './tools/get-used-range.js';
import { getWorkbookInfo } from './tools/get-workbook-info.js';
import { insertRange } from './tools/insert-range.js';
import { listCharts } from './tools/list-charts.js';
import { listNamedItems } from './tools/list-named-items.js';
import { listTables } from './tools/list-tables.js';
import { listWorksheets } from './tools/list-worksheets.js';
import { reauthenticate } from './tools/reauthenticate.js';
import { sortRange } from './tools/sort-range.js';
import { updateRange } from './tools/update-range.js';
import { updateWorksheet } from './tools/update-worksheet.js';

class ExcelOnlinePlugin extends OpenTabsPlugin {
  readonly name = 'excel-online';
  readonly description = 'OpenTabs plugin for Microsoft Excel Online';
  override readonly displayName = 'Excel Online';
  readonly urlPatterns = ['*://excel.cloud.microsoft/*', '*://*.sharepoint.com/:x:/*'];
  override readonly homepage = 'https://excel.cloud.microsoft/';
  readonly tools: ToolDefinition[] = [
    // Account
    getCurrentUser,
    reauthenticate,
    // Workbook
    getWorkbookInfo,
    calculateWorkbook,
    evaluateFormula,
    listNamedItems,
    addNamedItem,
    // Worksheets
    listWorksheets,
    addWorksheet,
    updateWorksheet,
    deleteWorksheet,
    // Ranges
    getRange,
    getUsedRange,
    updateRange,
    clearRange,
    insertRange,
    deleteRange,
    sortRange,
    // Tables
    listTables,
    createTable,
    deleteTable,
    getTableRows,
    getTableColumns,
    addTableRow,
    deleteTableRow,
    addTableColumn,
    // Charts
    listCharts,
    createChart,
    deleteChart,
  ];

  async isReady(): Promise<boolean> {
    if (isAuthenticated()) return true;
    // On SharePoint/OneDrive-hosted workbooks the Graph token is captured
    // asynchronously by the pre-script from MSAL's token-endpoint responses
    // and may not have arrived yet. Report the workbook page as ready so the
    // plugin activates on load; tool handlers surface a clear auth error if
    // the token has not been captured. Readiness checks must return promptly,
    // so this does not wait on token capture.
    if (isSharePointWorkbook()) return true;
    return waitForAuth();
  }
}

export default new ExcelOnlinePlugin();
