import { defineTool, getCurrentUrl, getPageTitle } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api, resolveDocumentContext } from '../microsoft-word-api.js';
import { type RawDriveItem, driveItemSchema, mapDriveItem } from './schemas.js';

export const getActiveDocument = defineTool({
  name: 'get_active_document',
  displayName: 'Get Active Document',
  description:
    'Get information about the document currently open in the Word Online editor. Returns the document ID, name, and metadata. The document ID can then be used with get_document_text, update_document, append_to_document, replace_text_in_document, and other tools. This is the recommended first step — call this to discover the active document before reading or editing it.',
  summary: 'Get the currently open document',
  icon: 'file',
  group: 'Documents',
  input: z.object({}),
  output: z.object({
    item: driveItemSchema.describe('The currently open document'),
    drive_id: z.string().describe('Drive ID (needed for some advanced operations)'),
  }),
  handle: async () => {
    const url = getCurrentUrl();
    // Resolve the open document's drive/item ids — from the URL query on the
    // standalone app, or via Graph /shares on SharePoint/OneDrive-hosted files.
    const context = await resolveDocumentContext();

    if (!context) {
      // Not on a document page — try to get info from page title
      const title = getPageTitle();
      return {
        item: {
          id: '',
          name: title || 'Unknown',
          size: 0,
          is_folder: false,
          mime_type: '',
          web_url: url,
          created_at: '',
          last_modified_at: '',
          parent_path: '',
          parent_id: '',
          description: '',
        },
        drive_id: '',
      };
    }

    const data = await api<RawDriveItem>(`/drives/${context.driveId}/items/${context.itemId}`);

    return {
      item: mapDriveItem(data),
      drive_id: context.driveId,
    };
  },
});
