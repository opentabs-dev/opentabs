import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../retool-api.js';
import { mapSourceControlSettings, type RawSourceControlSettings, sourceControlSettingsSchema } from './schemas.js';

export const getSourceControlSettings = defineTool({
  name: 'get_source_control_settings',
  displayName: 'Get Source Control Settings',
  description:
    'Get the source control configuration for the Retool organization, including auto branch naming, PR templates, and branch cleanup settings.',
  summary: 'Get source control configuration',
  icon: 'settings',
  group: 'Source Control',
  input: z.object({}),
  output: z.object({ settings: sourceControlSettingsSchema }),
  handle: async () => {
    const data = await api<{ settings: RawSourceControlSettings }>('/api/sourceControl/settings');
    return { settings: mapSourceControlSettings(data.settings ?? {}) };
  },
});
