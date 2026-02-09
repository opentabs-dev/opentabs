/**
 * Icon Status Manager
 *
 * Renders a colored status dot (green/red) on the extension badge icon
 * based on the MCP server connection state.
 */

import { MessageTypes } from '@extension/shared';
import type { ConnectionStatus } from '@extension/shared';

// Slack brand colors for connected/disconnected states
const STATUS_COLORS = {
  connected: '#2EB67D',
  disconnected: '#E01E5A',
} as const;

const ICON_SIZES = [16, 32, 48, 128] as const;

let baseIconImageData: ImageData | null = null;
let lastConnectionState: boolean | null = null;

const loadBaseIcon = async (): Promise<ImageData> => {
  if (baseIconImageData) return baseIconImageData;

  const response = await fetch(chrome.runtime.getURL('icons/icon-128.png'));
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = new OffscreenCanvas(128, 128);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, 128, 128);
  baseIconImageData = ctx.getImageData(0, 0, 128, 128);
  return baseIconImageData;
};

const createIconWithStatusDot = async (connected: boolean): Promise<Record<number, ImageData>> => {
  const baseImageData = await loadBaseIcon();
  const result: Record<number, ImageData> = {};
  const color = connected ? STATUS_COLORS.connected : STATUS_COLORS.disconnected;

  const baseCanvas = new OffscreenCanvas(128, 128);
  baseCanvas.getContext('2d')!.putImageData(baseImageData, 0, 0);

  for (const size of ICON_SIZES) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d')!;

    ctx.drawImage(baseCanvas, 0, 0, size, size);

    // Status dot in bottom-right corner
    const dotRadius = Math.max(size * 0.2, 3);
    const dotX = size - dotRadius - 1;
    const dotY = size - dotRadius - 1;

    // White border
    ctx.beginPath();
    ctx.arc(dotX, dotY, dotRadius + 1.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // Colored dot
    ctx.beginPath();
    ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    result[size] = ctx.getImageData(0, 0, size, size);
  }

  return result;
};

/**
 * Update the extension badge icon and broadcast status to UI surfaces.
 * Icon reflects MCP server connection state (green = connected, red = disconnected).
 */
const updateBadge = async (connectionStatus: ConnectionStatus): Promise<void> => {
  const isConnected = connectionStatus.mcpConnected;

  if (lastConnectionState !== isConnected) {
    lastConnectionState = isConnected;
    try {
      const iconData = await createIconWithStatusDot(isConnected);
      await chrome.action.setIcon({ imageData: iconData });
    } catch (err) {
      console.error('[OpenTabs] Error updating icon:', err);
    }
  }

  chrome.action.setBadgeText({ text: '' });
  chrome.runtime.sendMessage({ type: MessageTypes.STATUS_UPDATE, ...connectionStatus }).catch(() => {});
};

export { updateBadge };
