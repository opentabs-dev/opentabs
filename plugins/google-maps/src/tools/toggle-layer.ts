import { defineTool, getCurrentUrl } from '@opentabs-dev/plugin-sdk';
import { z } from 'zod';

export const toggleLayer = defineTool({
  name: 'toggle_layer',
  displayName: 'Toggle Map Layer',
  description:
    'Toggle a map layer on Google Maps by navigating to the appropriate URL with the layer parameter. Supports traffic, transit, bicycling, and terrain layers.',
  summary: 'Toggle traffic/transit/biking/terrain layer',
  icon: 'layers',
  group: 'Map',
  input: z.object({
    layer: z.enum(['traffic', 'transit', 'bicycling', 'terrain']).describe('Map layer to toggle'),
  }),
  output: z.object({
    url: z.string().describe('Updated Google Maps URL with the layer'),
    success: z.boolean().describe('Whether the layer toggle succeeded'),
  }),
  handle: async params => {
    const currentUrl = getCurrentUrl();

    // Layer codes in Maps URL: !5m1!1e1 (traffic), !5m1!1e2 (transit), !5m1!1e3 (bicycling), !5m1!1e4 (terrain)
    const layerMap: Record<string, string> = {
      traffic: '!5m1!1e1',
      transit: '!5m1!1e2',
      bicycling: '!5m1!1e3',
      terrain: '!5m1!1e4',
    };

    const layerCode = layerMap[params.layer];

    // Extract current @lat,lng,zoom from URL
    const coordMatch = currentUrl.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*),(\d+\.?\d*)z/);
    if (coordMatch?.[1] && coordMatch[2] && coordMatch[3]) {
      const lat = coordMatch[1];
      const lng = coordMatch[2];
      const zoom = coordMatch[3];
      const url = `https://www.google.com/maps/@${lat},${lng},${zoom}z/data=${layerCode}`;
      window.location.href = url;
      return { url, success: true };
    }

    // If no coordinates in URL, append layer to current URL
    const separator = currentUrl.includes('data=') ? '' : '/data=';
    const url = `${currentUrl}${separator}${layerCode}`;
    window.location.href = url;
    return { url, success: true };
  },
});
