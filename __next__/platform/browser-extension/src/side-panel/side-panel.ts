/**
 * Side Panel — Minimal status display
 *
 * Queries the background script for connection status and renders
 * service connection state. Listens for live status updates.
 *
 * This is a lightweight placeholder for the migrated extension.
 * The full React-based side panel from the original extension
 * can be ported later.
 */

import { MessageTypes } from '@opentabs/core';
import type { ConnectionStatus, ServiceConnectionStatus } from '@opentabs/core';

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const renderRelayBadge = (connected: boolean): void => {
  const badge = $('relay-badge');
  if (!badge) return;
  badge.textContent = connected ? 'Connected' : 'Disconnected';
  badge.className = `badge ${connected ? 'connected' : 'disconnected'}`;
};

const renderServices = (services: Record<string, ServiceConnectionStatus>): void => {
  const list = $('services-list');
  if (!list) return;

  const entries = Object.entries(services);

  if (entries.length === 0) {
    list.innerHTML = `
      <div class="item">
        <span class="item-label" style="color:#666">No services discovered</span>
      </div>`;
    return;
  }

  list.innerHTML = entries
    .map(([serviceId, status]) => {
      const displayName = serviceId.charAt(0).toUpperCase() + serviceId.slice(1);
      const connected = status.connected;
      const iconFile = connected ? `${serviceId}.svg` : `${serviceId}-gray.svg`;
      const badgeClass = connected ? 'connected' : 'disconnected';
      const badgeText = connected ? 'Connected' : 'Disconnected';

      return `
        <div class="item">
          <div class="item-left">
            <img src="../icons/${iconFile}" alt="${displayName}"
                 onerror="this.src='../icons/icon-gray.svg'" />
            <span class="item-label">${displayName}</span>
          </div>
          <span class="badge ${badgeClass}">${badgeText}</span>
        </div>`;
    })
    .join('');
};

const renderStatus = (status: ConnectionStatus): void => {
  renderRelayBadge(status.mcpConnected);
  renderServices(status.services);

  const loading = $('loading');
  const content = $('status-content');
  if (loading) loading.style.display = 'none';
  if (content) content.style.display = 'block';
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const initialize = (): void => {
  // Notify background that side panel opened
  chrome.windows.getCurrent().then(win => {
    if (win.id) {
      chrome.runtime
        .sendMessage({
          type: MessageTypes.SIDE_PANEL_OPENED,
          windowId: win.id,
        })
        .catch(() => {});
    }
  });

  // Listen for close command from background (toggle behavior)
  chrome.runtime.onMessage.addListener((message: { type: string }) => {
    if (message.type === MessageTypes.CLOSE_SIDE_PANEL) {
      window.close();
    }
  });

  // Notify background when closing
  window.addEventListener('beforeunload', () => {
    chrome.windows.getCurrent().then(win => {
      if (win.id) {
        chrome.runtime
          .sendMessage({
            type: MessageTypes.SIDE_PANEL_CLOSED,
            windowId: win.id,
          })
          .catch(() => {});
      }
    });
  });

  // Request initial status
  chrome.runtime.sendMessage({ type: MessageTypes.GET_STATUS }, (response: ConnectionStatus | undefined) => {
    if (chrome.runtime.lastError) {
      console.error('[SidePanel] Failed to get status:', chrome.runtime.lastError.message);
      const loading = $('loading');
      if (loading) loading.textContent = 'Failed to load status';
      return;
    }
    if (response) {
      renderStatus(response);
    }
  });

  // Listen for live status updates
  chrome.runtime.onMessage.addListener((message: { type: string } & Partial<ConnectionStatus>) => {
    if (message.type === MessageTypes.STATUS_UPDATE) {
      renderStatus({
        mcpConnected: message.mcpConnected ?? false,
        port: message.port,
        serverPath: message.serverPath,
        services: message.services ?? {},
      });
    }
  });
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
