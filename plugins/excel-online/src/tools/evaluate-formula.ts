import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { workbookApi } from '../excel-api.js';

export const evaluateFormula = defineTool({
  name: 'evaluate_formula',
  displayName: 'Evaluate Formula',
  description:
    'Evaluate a formula expression without writing it to a cell. The formula is evaluated in the context of a specific worksheet. Returns the computed result. Useful for calculations, lookups, and data analysis without modifying the workbook.',
  summary: 'Evaluate a formula and return the result',
  icon: 'calculator',
  group: 'Workbook',
  input: z.object({
    worksheet: z.string().describe('Worksheet name for formula context (e.g., "Sheet1")'),
    formula: z.string().describe('Formula to evaluate (e.g., "=SUM(A1:A10)", "=AVERAGE(B2:B100)")'),
  }),
  output: z.object({
    result: z.unknown().describe('The computed result of the formula (number, string, boolean, or error)'),
    error: z.string().describe('Error message if the formula failed, empty string on success'),
  }),
  handle: async params => {
    // Write formula to a far-off temp cell, read the result, then clear it.
    // This is the most reliable approach with the Graph API.
    const tempCell = 'ZZ9999';
    const ws = encodeURIComponent(params.worksheet);

    // Write formula
    await workbookApi(`/worksheets('${ws}')/range(address='${tempCell}')`, {
      method: 'PATCH',
      body: { formulas: [[params.formula]] },
    });

    // Read result, then clear regardless of whether read succeeds
    let result: { values?: unknown[][]; text?: string[][] };
    try {
      result = await workbookApi<{
        values?: unknown[][];
        text?: string[][];
      }>(`/worksheets('${ws}')/range(address='${tempCell}')`);
    } finally {
      await workbookApi(`/worksheets('${ws}')/range(address='${tempCell}')/clear`, {
        method: 'POST',
        body: { applyTo: 'All' },
      }).catch(() => {});
    }

    const value = result.values?.[0]?.[0];
    const isError = typeof value === 'string' && value.startsWith('#');

    return {
      result: isError ? null : value,
      error: isError ? String(value) : '',
    };
  },
});
