import { defineTool } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';
import { api } from '../tinder-api.js';

export const updateLocation = defineTool({
  name: 'update_location',
  displayName: 'Update Location',
  description:
    'Update your current location for Tinder discovery. This changes where you appear to other users and affects which profiles you see.',
  summary: 'Update your location',
  icon: 'map-pin',
  group: 'Location',
  input: z.object({
    lat: z.number().describe('Latitude coordinate'),
    lon: z.number().describe('Longitude coordinate'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the location was updated successfully'),
  }),
  handle: async params => {
    await api('/v2/meta', {
      method: 'POST',
      body: { lat: params.lat, lon: params.lon },
    });
    return { success: true };
  },
});
