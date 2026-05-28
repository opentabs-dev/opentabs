import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api, resolveWorkbookContext } from '../excel-api.js';
import { workbookInfoSchema } from './schemas.js';

export const getWorkbookInfo = defineTool({
  name: 'get_workbook_info',
  displayName: 'Get Workbook Info',
  description:
    'Get information about the currently open Excel workbook including drive ID, item ID, and file name. Returns context needed by other tools. The workbook must be open in the browser.',
  summary: 'Get current workbook metadata',
  icon: 'file-spreadsheet',
  group: 'Workbook',
  input: z.object({}),
  output: z.object({ workbook: workbookInfoSchema }),
  handle: async () => {
    const ctx = await resolveWorkbookContext();

    const data = await api<{ id?: string; name?: string }>(
      `/drives/${ctx.driveId}/items/${encodeURIComponent(ctx.itemId)}`,
    );

    return {
      workbook: {
        drive_id: ctx.driveId,
        item_id: ctx.itemId,
        name: data.name ?? '',
      },
    };
  },
});
