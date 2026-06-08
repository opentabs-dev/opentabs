import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api, getCurrentDriveId } from '../powerpoint-api.js';
import { driveSchema, mapDrive, type RawDrive } from './schemas.js';

export const getDrive = defineTool({
  name: 'get_drive',
  displayName: 'Get Drive Info',
  description: 'Get OneDrive storage information including total capacity, used space, and remaining quota.',
  summary: 'Get drive storage quota info',
  icon: 'hard-drive',
  group: 'Drive',
  input: z.object({}),
  output: z.object({
    drive: driveSchema.describe('Drive storage information'),
  }),
  handle: async () => {
    const driveId = await getCurrentDriveId();
    const data = await api<RawDrive>(`/drives/${driveId}`, {
      query: { $select: 'id,name,driveType,quota' },
    });
    return { drive: mapDrive(data) };
  },
});
