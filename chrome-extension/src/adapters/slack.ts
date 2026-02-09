/**
 * Slack Adapter — MAIN world script registered by adapter-manager.ts
 *
 * Receives JSON-RPC requests from the background via chrome.scripting.executeScript
 * and returns JSON-RPC responses. Runs in the page's JS context with access to
 * session cookies and localStorage.
 *
 * Supported JSON-RPC methods (second segment of method string):
 * - api           — Slack Web API  (/api/{method})
 * - edgeApi       — Enterprise Edge API (edgeapi.slack.com)
 *
 * All business logic lives in the MCP tool layer, not here.
 */

import { ok, fail, INVALID_PARAMS, METHOD_NOT_FOUND, INTERNAL_ERROR, registerAdapter } from './shared';
import type { JsonRpcRequest, JsonRpcResponse } from './shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SlackAuth {
  token: string;
  workspaceUrl: string;
  workspace: string;
  teamId: string;
}

// ---------------------------------------------------------------------------
// Auth
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
// API transports
// ---------------------------------------------------------------------------

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

const callEdgeApi = async (endpoint: string, params: Record<string, unknown>): Promise<unknown> => {
  const auth = getAuth();
  if (!auth) return { ok: false, error: 'Not authenticated' };

  const body = { token: auth.token, enterprise_token: auth.token, ...params };

  const response = await fetch(`https://edgeapi.slack.com/cache/${auth.teamId}/${endpoint}?_x_app_name=client`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(body),
    credentials: 'include',
  });

  return response.json();
};

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

const handleRequest = async (request: JsonRpcRequest): Promise<JsonRpcResponse> => {
  const { id, method, params } = request;
  const [, action] = method.split('.');

  try {
    switch (action) {
      case 'api': {
        const apiMethod = params?.method as string;
        if (!apiMethod) return fail(id, INVALID_PARAMS, 'Missing required parameter: method');

        const apiParams = (params?.params as Record<string, unknown>) || {};
        const data = await callApi(apiMethod, apiParams);
        return ok(id, data);
      }

      case 'edgeApi': {
        const endpoint = params?.endpoint as string;
        if (!endpoint) return fail(id, INVALID_PARAMS, 'Missing required parameter: endpoint');

        const edgeParams = (params?.params as Record<string, unknown>) || {};
        const data = await callEdgeApi(endpoint, edgeParams);
        return ok(id, data);
      }

      default:
        return fail(id, METHOD_NOT_FOUND, `Unknown action: ${action}`);
    }
  } catch (err) {
    return fail(id, INTERNAL_ERROR, err instanceof Error ? err.message : String(err));
  }
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

registerAdapter('slack', handleRequest);

export {};
