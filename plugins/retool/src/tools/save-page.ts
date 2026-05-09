import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';

export const savePage = defineTool({
  name: 'save_page',
  displayName: 'Save Page',
  description:
    'Save (update) a Retool app by pushing its full app state JSON. This is the core tool for programmatically building and modifying Retool apps. The appState must be a valid Transit-encoded JSON string (the same format returned by get_app). Use get_app_state to get the current state, modify it, then use this tool to save changes.',
  summary: 'Save app state to a Retool page',
  icon: 'save',
  group: 'Apps',
  input: z.object({
    page_uuid: z.string().describe('App UUID (from list_apps or create_app)'),
    app_state: z.string().describe('Transit-encoded app state JSON string (same format as returned by get_app_state)'),
    commit_message: z
      .string()
      .optional()
      .describe('Optional commit message describing the change (shown in edit history)'),
  }),
  output: z.object({
    save_id: z.number().describe('ID of the new save record'),
    success: z.boolean().describe('Whether the save was successful'),
  }),
  handle: async params => {
    const getResp = await api<{ page: { id: number; multiplayerSessionId: string | null } }>(
      `/api/pages/uuids/${params.page_uuid}`,
    );
    const currentSaveId = getResp.page.id;
    const multiplayerSessionId = getResp.page.multiplayerSessionId;

    const saveResp = await api<{ save: { id: number } }>(`/api/pages/uuids/${params.page_uuid}/save`, {
      method: 'POST',
      body: {
        appState: params.app_state,
        branchName: null,
        changesRecordV2: { changes: [], numUntrackedActionsTriggered: 1, isCopilotMode: false },
        saveValidationInfo: { multiplayerSessionId, pageSaveId: currentSaveId },
        isCopilotGenerated: false,
        subflowsDiff: null,
        saveAppTesting: false,
      },
    });

    return {
      save_id: saveResp.save?.id ?? 0,
      success: true,
    };
  },
});
