/**
 * Slack Adapter — MAIN world script for the Slack plugin
 *
 * Receives JSON-RPC requests from the background script via
 * chrome.scripting.executeScript and returns JSON-RPC responses. Runs in the
 * page's JS context with access to session cookies and localStorage.
 *
 * Supported JSON-RPC methods (second segment of method string):
 * - api — Slack Web API (/api/{method})
 *
 * All business logic lives in the MCP tool layer (src/tools/), not here.
 * The adapter is a thin transport layer that authenticates and dispatches
 * HTTP requests using the user's browser session.
 */

import {
  ok,
  fail,
  registerAdapter,
  parseAction,
  INVALID_PARAMS,
  METHOD_NOT_FOUND,
  INTERNAL_ERROR,
} from '@opentabs/plugin-sdk/adapter';
import type { JsonRpcRequest, JsonRpcResponse } from '@opentabs/plugin-sdk/adapter';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SlackAuth {
  readonly token: string;
  readonly workspaceUrl: string;
  readonly workspace: string;
  readonly teamId: string;
}

// ---------------------------------------------------------------------------
// Auth — Extract credentials from Slack's localStorage
// ---------------------------------------------------------------------------

const getAuth = (): SlackAuth | null => {
  try {
    const raw = localStorage.getItem('localConfig_v2');
    if (!raw) return null;

    const config = JSON.parse(raw) as {
      teams: Record<string, { token: string; url: string; name: string }>;
      lastActiveTeamId?: string;
    };
    if (!config.teams) return null;

    const teamId = config.lastActiveTeamId || Object.keys(config.teams)[0];
    if (!teamId) return null;

    const team = config.teams[teamId];
    if (!team?.token) return null;

    return {
      token: team.token,
      workspaceUrl: window.location.origin,
      workspace: team.name || teamId,
      teamId,
    };
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// API Transport
// ---------------------------------------------------------------------------

/**
 * Call the Slack Web API (/api/{method}) using the user's session token.
 * Uses form-encoded POST requests matching Slack's internal client behavior.
 */
const callApi = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
  const auth = getAuth();
  if (!auth) return { ok: false, error: 'Not authenticated' };

  const form = new URLSearchParams();
  form.append('token', auth.token);

  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null) {
      form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
  }

  // Slack client metadata fields — makes requests appear as first-party
  form.append('_x_reason', 'api_call');
  form.append('_x_mode', 'online');
  form.append('_x_sonic', 'true');
  form.append('_x_app_name', 'client');
  if (auth.teamId) form.append('_x_team_id', auth.teamId);

  const response = await fetch(`${auth.workspaceUrl}/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    credentials: 'include',
  });

  return response.json();
};

// ---------------------------------------------------------------------------
// Request Handler
// ---------------------------------------------------------------------------

const handleRequest = async (request: JsonRpcRequest): Promise<JsonRpcResponse> => {
  const { id, method, params } = request;
  const action = parseAction(method);

  try {
    switch (action) {
      case 'api': {
        const apiMethod = params?.method as string | undefined;
        if (!apiMethod) {
          return fail(id, INVALID_PARAMS, 'Missing required parameter: method');
        }

        const apiParams = (params?.params as Record<string, unknown>) || {};
        const data = await callApi(apiMethod, apiParams);
        return ok(id, data);
      }

      default:
        return fail(id, METHOD_NOT_FOUND, `Unknown action: ${action ?? '(empty)'}`);
    }
  } catch (err) {
    return fail(id, INTERNAL_ERROR, err instanceof Error ? err.message : String(err));
  }
};

// ---------------------------------------------------------------------------
// Registration — Makes this adapter available to the platform
// ---------------------------------------------------------------------------

registerAdapter('slack', handleRequest);

export {};
