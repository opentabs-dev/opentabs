import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api, getCurrentDriveId } from '../powerpoint-api.js';
import { mapPermission, permissionSchema, type RawPermission } from './schemas.js';

export const createSharingLink = defineTool({
  name: 'create_sharing_link',
  displayName: 'Create Sharing Link',
  description:
    'Create a sharing link for a file or folder. Supports view-only and edit links with anonymous or organization scope.',
  summary: 'Create a sharing link for a file',
  icon: 'link',
  group: 'Sharing',
  input: z.object({
    item_id: z.string().describe('Item ID of the file or folder'),
    type: z.enum(['view', 'edit', 'embed']).describe('Link type — view (read-only), edit (read-write), or embed'),
    scope: z
      .enum(['anonymous', 'organization'])
      .optional()
      .describe('Link scope — anonymous (anyone) or organization (org members only). Default: anonymous'),
  }),
  output: z.object({
    permission: permissionSchema.describe('The created sharing permission'),
  }),
  handle: async params => {
    const driveId = await getCurrentDriveId();
    const data = await api<RawPermission>(`/drives/${driveId}/items/${params.item_id}/createLink`, {
      method: 'POST',
      body: {
        type: params.type,
        scope: params.scope ?? 'anonymous',
      },
    });
    return { permission: mapPermission(data) };
  },
});
