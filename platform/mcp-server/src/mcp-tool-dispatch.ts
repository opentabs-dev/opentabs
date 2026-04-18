/**
 * Tool dispatch handlers for browser tools and plugin tools.
 *
 * Extracted from the monolith tools/call handler in mcp-setup.ts so each
 * dispatch path can be tested independently. The tools/call handler in
 * mcp-setup.ts delegates to these functions after resolving the tool name.
 */

import { readFile } from 'node:fs/promises';
import type { PluginPermissionConfig, ToolPermission } from '@opentabs-dev/shared';
import { toErrorMessage } from '@opentabs-dev/shared';
import type { ZodError } from 'zod';
import type { ToolContentPart } from './browser-tools/definition.js';
import { savePluginPermissions } from './config.js';
import { buildConfigStatePayload, sendToExtension } from './extension-handlers.js';
import {
  dispatchToExtension,
  isDispatchError,
  sendConfirmationRequest,
  sendInvocationEnd,
  sendInvocationStart,
} from './extension-protocol.js';
import { log } from './logger.js';
import { sanitizeErrorMessage } from './sanitize-error.js';
import type { AuditEntry, CachedBrowserTool, ServerState, ToolLookupEntry } from './state.js';
import {
  appendAuditEntry,
  consumeReviewToken,
  generateReviewToken,
  getMergedTabMapping,
  getToolPermission,
  validateReviewToken,
} from './state.js';
import { getSessionId, trackEvent } from './telemetry.js';

/** Maximum concurrent tool dispatches per plugin to prevent tab performance degradation */
const MAX_CONCURRENT_DISPATCHES_PER_PLUGIN = 25;

/**
 * Extract the host (hostname:port when non-standard) from a Chrome match pattern
 * (e.g., `*://localhost:3000/*` → `localhost:3000`, `*://example.com/*` → `example.com`,
 * `https://example.com/*` → `example.com`).
 * Returns undefined if the pattern doesn't match or has a wildcard host.
 */
const hostnameFromPattern = (pattern: string): string | undefined => {
  const match = pattern.match(/^(?:\*|https?|wss?):\/\/([^*/]+)\//);
  if (!match) return undefined;
  const host = match[1];
  if (!host || host.startsWith('*')) return undefined;
  return host;
};

/** Normalize localhost variants (localhost, 127.0.0.1, [::1]) to a canonical form. */
const normalizeHost = (host: string): string => {
  const colonIdx = host.lastIndexOf(':');
  const hasPort = colonIdx > 0 && !host.endsWith(']');
  const hostname = hasPort ? host.slice(0, colonIdx) : host;
  const port = hasPort ? host.slice(colonIdx + 1) : undefined;
  const norm = hostname === '127.0.0.1' || hostname === '[::1]' ? 'localhost' : hostname;
  return port ? `${norm}:${port}` : norm;
};

/**
 * Find a tab matching a specific instance's Chrome match pattern within a plugin's
 * tab mapping. Scans all extension connections' tab mappings for the plugin and
 * returns the tab ID of the first tab whose URL host (hostname:port) matches the
 * pattern host. Prefers ready tabs over non-ready ones.
 */
const findTabForInstance = (state: ServerState, pluginName: string, pattern: string): number | undefined => {
  const patternHost = hostnameFromPattern(pattern);
  if (!patternHost) return undefined;

  const mergedTabs = getMergedTabMapping(state);
  const mapping = mergedTabs.get(pluginName);
  if (!mapping) return undefined;

  let fallback: number | undefined;
  for (const tab of mapping.tabs) {
    try {
      const tabHost = new URL(tab.url).host;
      if (normalizeHost(tabHost) === normalizeHost(patternHost)) {
        if (tab.ready) return tab.tabId;
        fallback ??= tab.tabId;
      }
    } catch {
      // Skip tabs with invalid URLs
    }
  }
  return fallback;
};

/** Keys that could trigger prototype pollution in JSON deserialization */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Recursively remove dangerous keys from objects to prevent prototype pollution
 * in MCP clients that use naive JSON deserialization.
 */
const sanitizeOutput = (obj: unknown, depth = 0): unknown => {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  if (depth > 50) return '[Object too deep]';
  if (Array.isArray(obj)) return obj.map(item => sanitizeOutput(item, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (!DANGEROUS_KEYS.has(key)) result[key] = sanitizeOutput(value, depth + 1);
  }
  return result;
};

/**
 * Format a structured error response for MCP clients.
 *
 * When the error data contains structured fields (category, retryable, retryAfterMs),
 * produces a human-readable prefix line followed by a machine-readable JSON block.
 * When only the code is present (legacy), produces [CODE] message.
 */
const formatStructuredError = (code: string, message: string, data?: Record<string, unknown>): string => {
  const category = typeof data?.category === 'string' ? data.category : undefined;
  const retryable = typeof data?.retryable === 'boolean' ? data.retryable : undefined;
  const retryAfterMs = typeof data?.retryAfterMs === 'number' ? data.retryAfterMs : undefined;

  const hasStructuredFields = category !== undefined || retryable !== undefined || retryAfterMs !== undefined;

  if (!hasStructuredFields) {
    return `[${code}] ${message}`;
  }

  // Build the human-readable prefix with only present fields
  const parts = [`code=${code}`];
  if (category !== undefined) parts.push(`category=${category}`);
  if (retryable !== undefined) parts.push(`retryable=${String(retryable)}`);
  if (retryAfterMs !== undefined) parts.push(`retryAfterMs=${retryAfterMs}`);
  const prefix = `[ERROR ${parts.join(' ')}] ${message}`;

  // Build the machine-readable JSON block with only present fields
  const jsonObj: Record<string, unknown> = { code };
  if (category !== undefined) jsonObj.category = category;
  if (retryable !== undefined) jsonObj.retryable = retryable;
  if (retryAfterMs !== undefined) jsonObj.retryAfterMs = retryAfterMs;

  return `${prefix}\n\n\`\`\`json\n${JSON.stringify(jsonObj)}\n\`\`\``;
};

/** Format a ZodError into a readable validation message listing each failing field */
const formatZodError = (err: ZodError): string => {
  const issues = err.issues.map(issue => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `  - ${path}: ${issue.message}`;
  });
  return `Invalid arguments:\n${issues.join('\n')}`;
};

/** Result shape returned by both handleBrowserToolCall and handlePluginToolCall */
interface ToolCallResult {
  content: ToolContentPart[];
  isError?: boolean;
}

/** Extra context passed to request handlers by the MCP SDK */
interface RequestHandlerExtra {
  signal: AbortSignal;
  sessionId?: string;
  _meta?: { progressToken?: string | number };
  sendNotification: (notification: { method: string; params?: Record<string, unknown> }) => Promise<void>;
}

/** Callbacks from the MCP setup layer for persisting config changes */
interface DispatchCallbacks {
  onToolConfigChanged: () => void;
}

/**
 * Run the 'ask' confirmation flow for a tool call.
 * Sends a confirmation request to the extension, waits for the user's decision,
 * and persists the permission change if alwaysAllow is selected.
 *
 * @returns 'allow' if the user approved, or a ToolCallResult error if denied/failed.
 */
const runAskFlow = async (
  state: ServerState,
  pluginName: string,
  toolName: string,
  params: Record<string, unknown>,
  extra: RequestHandlerExtra,
  callbacks: DispatchCallbacks,
): Promise<'allow' | ToolCallResult> => {
  // Send MCP progress notification to let the agent know we're waiting for approval
  const progressToken = extra._meta?.progressToken;
  if (progressToken !== undefined) {
    extra
      .sendNotification({
        method: 'notifications/progress',
        params: {
          progressToken,
          progress: 0,
          total: 1,
          message: 'Waiting for user approval in the OpenTabs side panel',
        },
      })
      .catch(() => {
        // Fire-and-forget
      });
  }

  let decision: { action: 'allow' | 'deny'; alwaysAllow: boolean };
  try {
    decision = await sendConfirmationRequest(state, toolName, pluginName, params);
  } catch {
    return {
      content: [
        { type: 'text' as const, text: `Tool ${toolName} requires approval but the extension is not connected.` },
      ],
      isError: true,
    };
  }

  if (decision.action === 'deny') {
    return {
      content: [{ type: 'text' as const, text: `Tool ${toolName} was denied by the user.` }],
      isError: true,
    };
  }

  // User approved — persist to 'auto' if alwaysAllow was selected
  if (decision.alwaysAllow) {
    const existing = state.pluginPermissions[pluginName];
    const toolOverrides = { ...(existing?.tools ?? {}), [toolName]: 'auto' as const };
    const updatedConfig: PluginPermissionConfig = { ...existing, tools: toolOverrides };
    state.pluginPermissions[pluginName] = updatedConfig;
    void savePluginPermissions(state, state.pluginPermissions);
    callbacks.onToolConfigChanged();

    // Notify the extension so the side panel reflects the new permission
    sendToExtension(state, {
      jsonrpc: '2.0',
      method: 'plugins.changed',
      params: { ...buildConfigStatePayload(state) },
    });
  }

  return 'allow';
};

/**
 * Handle a browser tool call: permission check, Zod validation,
 * confirmation flow (for 'ask'), execution, output sanitization, and audit logging.
 */
const handleBrowserToolCall = async (
  state: ServerState,
  toolName: string,
  args: Record<string, unknown>,
  cachedBt: CachedBrowserTool,
  extra: RequestHandlerExtra,
  callbacks: DispatchCallbacks,
): Promise<ToolCallResult> => {
  const permission = getToolPermission(state, 'browser', toolName);

  if (permission === 'off') {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Tool "${toolName}" is currently disabled.\n\nTo enable it:\n- In the OpenTabs side panel: toggle the tool on\n- Via CLI: opentabs config set plugin-permission.browser-tool auto (enables all browser tools)\n- Via CLI: opentabs config set tool-permission.browser-tool.${toolName} auto (enables this tool only)`,
        },
      ],
      isError: true,
    };
  }

  if (permission === 'ask') {
    const askResult = await runAskFlow(state, 'browser', toolName, args, extra, callbacks);
    if (askResult !== 'allow') return askResult;
  }

  // Validate args through the tool's Zod input schema
  const parseResult = cachedBt.tool.input.safeParse(args);
  if (!parseResult.success) {
    return {
      content: [{ type: 'text' as const, text: formatZodError(parseResult.error) }],
      isError: true,
    };
  }

  // Send invocation start notification to extension (for side panel activity indicator)
  sendInvocationStart(state, 'browser', toolName);
  const btStartTs = Date.now();
  let btSuccess = true;
  let btErrorInfo: AuditEntry['error'] | undefined;
  try {
    const result = await cachedBt.tool.handler(parseResult.data, state);
    const cleaned = sanitizeOutput(result);
    const content = cachedBt.tool.formatResult
      ? cachedBt.tool.formatResult(cleaned)
      : [{ type: 'text' as const, text: JSON.stringify(cleaned, null, 2) }];
    return { content };
  } catch (err) {
    btSuccess = false;
    const msg = toErrorMessage(err);
    btErrorInfo = { code: 'UNKNOWN', message: msg };
    return {
      content: [{ type: 'text' as const, text: `Browser tool error: ${msg}` }],
      isError: true,
    };
  } finally {
    const btDurationMs = Date.now() - btStartTs;
    sendInvocationEnd(state, 'browser', toolName, btDurationMs, btSuccess);
    appendAuditEntry(state, {
      timestamp: new Date(btStartTs).toISOString(),
      tool: toolName,
      plugin: 'browser',
      success: btSuccess,
      durationMs: btDurationMs,
      error: btErrorInfo,
    });
  }
};

/**
 * Handle a plugin tool call: permission check, Ajv validation, concurrency limiting,
 * dispatch to extension, error formatting, and audit logging.
 *
 * The caller must have already verified the tool is callable via checkToolCallable.
 */
const handlePluginToolCall = async (
  state: ServerState,
  toolName: string,
  args: Record<string, unknown>,
  pluginName: string,
  toolBaseName: string,
  lookup: ToolLookupEntry,
  extra: RequestHandlerExtra,
  callbacks: DispatchCallbacks,
): Promise<ToolCallResult> => {
  // Permission check — applies to all plugin tools
  const permission = getToolPermission(state, pluginName, toolBaseName);

  if (permission === 'off') {
    const plugin = state.registry.plugins.get(pluginName);
    const pluginVersion = plugin?.version ?? 'unknown';
    const permConfig = state.pluginPermissions[pluginName];
    const reviewedVersion = permConfig?.reviewedVersion;

    let statusLine: string;
    if (reviewedVersion && reviewedVersion !== pluginVersion) {
      statusLine = `Plugin "${pluginName}" has been updated from v${reviewedVersion} to v${pluginVersion} and needs re-review.`;
    } else {
      statusLine = `Plugin "${pluginName}" (v${pluginVersion}) has not been reviewed yet.`;
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `${statusLine}\n\nYou can help the user by:\n1. Ask the user if they would like you to review the plugin's code for security before enabling it.\n2. If they agree, call the plugin_inspect tool to retrieve the adapter source code.\n3. Review the code and share your findings with the user.\n4. If the user approves, call plugin_mark_reviewed to enable the plugin.\n\nAlternatively, the user can enable this plugin directly from the OpenTabs side panel.`,
        },
      ],
      isError: true,
    };
  }

  if (permission === 'ask') {
    const askResult = await runAskFlow(state, pluginName, toolBaseName, args, extra, callbacks);
    if (askResult !== 'allow') return askResult;
  }

  // Extract platform-injected tabId and instance before validation — the plugin's
  // own schema doesn't know about these, so they must be stripped before Ajv runs
  // (otherwise plugins with additionalProperties: false would reject them).
  // Use destructuring instead of delete to avoid mutating the caller's object.
  const { tabId: rawTabId, instance: rawInstance, ...pluginArgs } = args;
  const tabId = typeof rawTabId === 'number' && Number.isInteger(rawTabId) && rawTabId > 0 ? rawTabId : undefined;
  const instance = typeof rawInstance === 'string' && rawInstance.length > 0 ? rawInstance : undefined;

  // Validate args against the tool's JSON Schema before dispatching.
  // The validator is pre-compiled at discovery time for performance.
  // If schema compilation failed, reject the call entirely — unvalidated
  // input must never reach plugin handlers.
  if (!lookup.validate) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Tool "${toolName}" cannot be called: schema compilation failed. ${lookup.validationErrors()}`,
        },
      ],
      isError: true,
    };
  }

  // Wrap validation in try-catch: compiled Ajv validators can throw on
  // pathological input (e.g., regex catastrophic backtracking from a
  // community plugin's pattern keyword). Normal schemas complete in
  // microseconds; this guard catches the unexpected edge case.
  let valid: boolean;
  try {
    valid = lookup.validate(pluginArgs);
  } catch (err) {
    log.warn(`Schema validation threw for tool "${toolName}":`, err);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Tool "${toolName}" validation failed unexpectedly. The tool's schema may be invalid.`,
        },
      ],
      isError: true,
    };
  }
  if (!valid) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Invalid arguments for tool "${toolName}":\n${lookup.validationErrors()}`,
        },
      ],
      isError: true,
    };
  }

  log.debug('tool.call: input validated for', toolName);

  // Concurrency limit: prevent a runaway MCP client from flooding a single
  // plugin's tab with simultaneous executeScript calls. Each dispatch runs
  // in the page's MAIN world, so too many concurrent dispatches can degrade
  // the target tab's performance.
  const currentDispatches = state.activeDispatches.get(pluginName) ?? 0;
  if (currentDispatches >= MAX_CONCURRENT_DISPATCHES_PER_PLUGIN) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Too many concurrent dispatches for plugin "${pluginName}" (limit: ${MAX_CONCURRENT_DISPATCHES_PER_PLUGIN}). Wait for in-flight requests to complete.`,
        },
      ],
      isError: true,
    };
  }

  // Send invocation start notification to extension (for side panel)
  sendInvocationStart(state, pluginName, toolBaseName);
  const startTs = Date.now();
  let success = true;
  let errorInfo: AuditEntry['error'] | undefined;

  try {
    state.activeDispatches.set(pluginName, currentDispatches + 1);
    if (state.extensionConnections.size === 0) {
      success = false;
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Extension not connected. Please ensure the OpenTabs Chrome extension is running.',
          },
        ],
        isError: true,
      };
    }

    // Resolve instance name to a specific tab ID. When both are provided,
    // tabId takes precedence (more specific).
    let resolvedTabId = tabId;
    if (instance !== undefined && tabId !== undefined) {
      log.warn(
        `Both tabId (${tabId}) and instance ("${instance}") provided for tool "${toolName}" — using tabId, ignoring instance`,
      );
    } else if (instance !== undefined) {
      const plugin = state.registry.plugins.get(pluginName);
      const pattern = plugin?.instanceMap?.[instance];
      if (!pattern) {
        success = false;
        const validInstances = Object.keys(plugin?.instanceMap ?? {}).join(', ');
        return {
          content: [
            {
              type: 'text' as const,
              text: `Unknown instance "${instance}" for plugin "${pluginName}". Valid instances: ${validInstances}`,
            },
          ],
          isError: true,
        };
      }
      const matchingTabId = findTabForInstance(state, pluginName, pattern);
      if (matchingTabId === undefined) {
        success = false;
        return {
          content: [
            {
              type: 'text' as const,
              text: `No open tab found for instance "${instance}" (pattern: ${pattern}). Open the ${instance} instance in your browser.`,
            },
          ],
          isError: true,
        };
      }
      resolvedTabId = matchingTabId;
    }

    log.debug('tool.call: dispatching', `${pluginName}/${toolBaseName}`);

    // Extract progressToken from MCP request _meta and build onProgress callback
    const progressToken = extra._meta?.progressToken;
    const onProgress =
      progressToken !== undefined
        ? (progress: number, total: number, message?: string) => {
            const params: Record<string, unknown> = { progressToken, progress, total };
            if (message !== undefined) params.message = message;
            extra.sendNotification({ method: 'notifications/progress', params }).catch(() => {
              // Fire-and-forget — errors in the progress chain must not affect tool execution
            });
          }
        : undefined;

    const result = await dispatchToExtension(
      state,
      'tool.dispatch',
      {
        plugin: pluginName,
        tool: toolBaseName,
        input: pluginArgs,
        ...(resolvedTabId !== undefined && { tabId: resolvedTabId }),
      },
      { label: `${pluginName}/${toolBaseName}`, pluginName, progressToken, onProgress },
    );
    const rawOutput = (result as Record<string, unknown>).output ?? result;
    const cleaned = sanitizeOutput(rawOutput);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(cleaned, null, 2) }],
    };
  } catch (err) {
    success = false;

    if (isDispatchError(err)) {
      const code = err.code;
      let errorMsg = err.message;

      if (code === -32001) {
        errorMsg = `Tab closed: ${errorMsg}`;
      } else if (code === -32002) {
        errorMsg = `Tab unavailable: ${errorMsg}`;
      }

      const toolErrorCode = err.data?.code;
      const category = typeof err.data?.category === 'string' ? err.data.category : undefined;
      if (typeof toolErrorCode === 'string') {
        errorMsg = formatStructuredError(toolErrorCode, errorMsg, err.data);
        errorInfo = { code: toolErrorCode, message: err.message, category };
      } else {
        errorInfo = { code: String(code), message: err.message };
      }

      return {
        content: [{ type: 'text' as const, text: errorMsg }],
        isError: true,
      };
    }

    const msg = sanitizeErrorMessage(toErrorMessage(err));
    errorInfo = { code: 'UNKNOWN', message: msg };
    return {
      content: [{ type: 'text' as const, text: `Tool dispatch error: ${msg}` }],
      isError: true,
    };
  } finally {
    const prev = state.activeDispatches.get(pluginName) ?? 1;
    if (prev <= 1) {
      state.activeDispatches.delete(pluginName);
    } else {
      state.activeDispatches.set(pluginName, prev - 1);
    }
    const durationMs = Date.now() - startTs;
    log.debug('tool.call:', `${pluginName}/${toolBaseName}`, 'completed in', `${durationMs}ms`);
    sendInvocationEnd(state, pluginName, toolBaseName, durationMs, success);
    appendAuditEntry(state, {
      timestamp: new Date(startTs).toISOString(),
      tool: toolName,
      plugin: pluginName,
      success,
      durationMs,
      error: errorInfo,
    });
  }
};

/** Review guidance text included in plugin_inspect responses */
const REVIEW_GUIDANCE = `Review this plugin adapter code and report your findings to the user. Be thorough and honest.

## What to check

### 1. Code readability
- Is the code minified, obfuscated, or bundled into unreadable single-line blocks?
- The official build tool (opentabs-plugin build) produces unminified, readable JavaScript with original variable names and formatting.
- Minified or obfuscated code is a significant red flag — it means the author bypassed the standard build process or is intentionally hiding the implementation.
- Look for intentionally misleading variable names or code structures designed to obscure intent.

### 2. Data exfiltration
- Does the code make network requests to ANY external domains? Look for: fetch(), XMLHttpRequest, navigator.sendBeacon(), WebSocket connections, new Image() with src (pixel tracking), dynamic script/iframe injection that loads external URLs.
- Plugin adapters should ONLY interact with the page DOM of the target web application. Any outbound requests to third-party domains are suspicious.
- Check for encoded/obfuscated URLs (base64, string concatenation to build URLs, hex-encoded strings).
- Look for data being serialized and sent anywhere — JSON.stringify of DOM content, form data collection, or page scraping beyond what the plugin's stated tools require.

### 3. Credential and sensitive data access
- Does the code access: document.cookie, localStorage, sessionStorage, indexedDB, Web Crypto API keys, password input fields, authentication tokens, session identifiers, or OAuth tokens?
- Does it read or modify HTTP-only cookie attributes?
- Does it access the Clipboard API (navigator.clipboard)?
- Does it intercept or modify form submissions?
- These APIs are not needed for normal plugin tool operation.

### 4. Code execution vectors
- Does the code use: eval(), new Function(), setTimeout/setInterval with string arguments, dynamic script injection (createElement('script')), document.write(), innerHTML with unsanitized content, import() with dynamic URLs?
- These can be used to execute arbitrary code at runtime, potentially loading malicious payloads after the initial review.

### 5. DOM manipulation beyond stated purpose
- Does the code's DOM interaction match the plugin's stated purpose?
- A Slack plugin should read/write Slack-specific DOM elements (message inputs, channel lists, etc.) — not access unrelated page content.
- Look for broad DOM queries (document.querySelectorAll('*'), document.body.innerHTML) that scrape entire page content rather than targeted element access.
- Does it attach global event listeners (keydown, input, submit, beforeunload) that could monitor user activity beyond the plugin's scope?

### 6. Destructive actions
- Even if the code only interacts with the target web service, does it perform any potentially destructive actions?
- Look for: mass deletion patterns (delete all, remove all, clear all), bulk modification of user data, account settings changes, permission escalation, automated posting/messaging without clear user intent, subscription or billing modifications.
- Check if the tool implementations match their declared names and descriptions — a tool named 'list_messages' should not be deleting or modifying messages.

### 7. Persistence and stealth
- Does the code set up any persistence mechanisms? Look for: Service Worker registration, browser extension message passing to unknown targets, periodic timers that run after the tool completes, mutation observers or intersection observers that trigger background behavior, web worker creation.
- Does the code attempt to hide its activity by suppressing console output, catching and silencing errors, or modifying browser DevTools behavior?

### 8. Scope escalation
- Does the code attempt to access cross-origin resources or iframes?
- Does it modify the page's Content Security Policy?
- Does it interact with browser APIs beyond DOM manipulation (geolocation, camera, microphone, notifications, Bluetooth)?
- Does it attempt to interact with other browser tabs or windows?

## How to report
Provide a clear, honest summary to the user:
1. Overall assessment: safe / suspicious / dangerous
2. What the code does (in plain language)
3. Any concerns or red flags found
4. Your recommendation: enable or keep disabled

Do not downplay concerns. If anything is suspicious, say so clearly.

If preScriptSource is present, REVIEW IT WITH SPECIAL SCRUTINY:
- Pre-scripts run at document_start in MAIN world, strictly before any page
  JavaScript — they have earlier execution than the adapter and can observe
  state the adapter cannot (e.g., auth tokens in the first outbound fetch,
  early globals the page may later hide).
- Pre-scripts cannot call chrome.* APIs and have no tool runtime, but they
  CAN monkey-patch window.fetch, window.XMLHttpRequest, window.WebSocket,
  document.cookie, Request/Response headers, and any global the page exposes.
- A malicious pre-script can silently exfiltrate bearer tokens, CSRF
  nonces, session cookies, or request bodies by installing its own fetch
  wrapper that forwards to an attacker-controlled endpoint.
- Verify: (1) every set(key, value) call stashes only data the plugin
  legitimately needs, (2) no network calls escape the page's own origin
  other than those originally made by the page, (3) no data is written
  to document.cookie, localStorage, or any global the page didn't already
  expose.`;

/**
 * Handle the plugin_inspect platform tool.
 * Returns the plugin's adapter IIFE source code, metadata, and a review token.
 */
const handlePluginInspect = async (state: ServerState, args: Record<string, unknown>): Promise<ToolCallResult> => {
  const pluginName = args.plugin;
  if (typeof pluginName !== 'string' || pluginName.length === 0) {
    return {
      content: [{ type: 'text' as const, text: 'Invalid arguments: "plugin" must be a non-empty string.' }],
      isError: true,
    };
  }

  const plugin = state.registry.plugins.get(pluginName);
  if (!plugin) {
    const available = [...state.registry.plugins.keys()].join(', ') || '(none)';
    return {
      content: [
        {
          type: 'text' as const,
          text: `Plugin "${pluginName}" not found. Available plugins: ${available}`,
        },
      ],
      isError: true,
    };
  }

  // The adapter IIFE is loaded into memory during plugin discovery
  const adapterSource = plugin.iife;
  if (!adapterSource || adapterSource.length === 0) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Plugin "${pluginName}" has no adapter IIFE file. The plugin may not have been built correctly.`,
        },
      ],
      isError: true,
    };
  }

  // Read author from package.json if sourcePath is available
  let author: string | undefined;
  if (plugin.sourcePath) {
    try {
      const pkgJson = JSON.parse(await readFile(`${plugin.sourcePath}/package.json`, 'utf-8')) as Record<
        string,
        unknown
      >;
      if (typeof pkgJson.author === 'string') {
        author = pkgJson.author;
      } else if (typeof pkgJson.author === 'object' && pkgJson.author !== null) {
        const authorObj = pkgJson.author as Record<string, unknown>;
        author = typeof authorObj.name === 'string' ? authorObj.name : undefined;
      }
    } catch {
      // package.json read failure is non-fatal — author will be undefined
    }
  }

  const lineCount = adapterSource.split('\n').length;
  const byteSize = Buffer.byteLength(adapterSource, 'utf-8');
  const preScriptSource = plugin.preScript;
  const preScriptLineCount = preScriptSource ? preScriptSource.split('\n').length : undefined;
  const preScriptByteSize = preScriptSource ? Buffer.byteLength(preScriptSource, 'utf-8') : undefined;
  const reviewToken = generateReviewToken(state, pluginName, plugin.version);

  const response = {
    plugin: pluginName,
    version: plugin.version,
    ...(author ? { author } : {}),
    ...(plugin.npmPackageName ? { npmPackage: plugin.npmPackageName } : {}),
    lineCount,
    byteSize,
    ...(preScriptSource ? { preScriptSource } : {}),
    ...(preScriptLineCount !== undefined ? { preScriptLineCount } : {}),
    ...(preScriptByteSize !== undefined ? { preScriptByteSize } : {}),
    reviewToken,
    reviewGuidance: REVIEW_GUIDANCE,
    adapterSource,
  };

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
  };
};

/** Valid permission values for plugin_mark_reviewed (excludes 'off') */
const VALID_REVIEW_PERMISSIONS = new Set<string>(['ask', 'auto']);

/**
 * Handle the plugin_mark_reviewed platform tool.
 * Validates the review token, consumes it, updates plugin permission and reviewedVersion,
 * persists to config, and notifies both MCP clients and the extension.
 */
const handlePluginMarkReviewed = async (
  state: ServerState,
  args: Record<string, unknown>,
  callbacks: DispatchCallbacks,
): Promise<ToolCallResult> => {
  const pluginName = args.plugin;
  const version = args.version;
  const reviewToken = args.reviewToken;
  const permission = args.permission;

  if (typeof pluginName !== 'string' || pluginName.length === 0) {
    return {
      content: [{ type: 'text' as const, text: 'Invalid arguments: "plugin" must be a non-empty string.' }],
      isError: true,
    };
  }

  if (typeof version !== 'string' || version.length === 0) {
    return {
      content: [{ type: 'text' as const, text: 'Invalid arguments: "version" must be a non-empty string.' }],
      isError: true,
    };
  }

  if (typeof reviewToken !== 'string' || reviewToken.length === 0) {
    return {
      content: [{ type: 'text' as const, text: 'Invalid arguments: "reviewToken" must be a non-empty string.' }],
      isError: true,
    };
  }

  if (typeof permission !== 'string' || !VALID_REVIEW_PERMISSIONS.has(permission)) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Invalid arguments: "permission" must be "ask" or "auto". Setting permission to "off" after review is not supported.',
        },
      ],
      isError: true,
    };
  }

  // Verify the plugin exists
  const plugin = state.registry.plugins.get(pluginName);
  if (!plugin) {
    const available = [...state.registry.plugins.keys()].join(', ') || '(none)';
    return {
      content: [
        {
          type: 'text' as const,
          text: `Plugin "${pluginName}" not found. Available plugins: ${available}`,
        },
      ],
      isError: true,
    };
  }

  // Validate the review token
  if (!validateReviewToken(state, reviewToken, pluginName, version)) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Invalid or expired review token. You must call plugin_inspect first to get a valid review token for this plugin and version.',
        },
      ],
      isError: true,
    };
  }

  // Consume the token so it cannot be reused
  consumeReviewToken(state, reviewToken);

  // Update plugin permission and reviewedVersion
  const existing = state.pluginPermissions[pluginName] ?? {};
  const updatedConfig: PluginPermissionConfig = {
    ...existing,
    permission: permission as ToolPermission,
    reviewedVersion: version,
  };
  state.pluginPermissions[pluginName] = updatedConfig;

  // Persist to config.json
  void savePluginPermissions(state, state.pluginPermissions);

  trackEvent('plugin_reviewed', {
    session_id: getSessionId(),
    permission_set: permission as string,
    review_source: 'agent',
  });

  // Notify MCP clients that tool list changed (description prefixes update)
  callbacks.onToolConfigChanged();

  // Notify the extension so the side panel refreshes
  sendToExtension(state, {
    jsonrpc: '2.0',
    method: 'plugins.changed',
    params: { ...buildConfigStatePayload(state) },
  });

  return {
    content: [
      {
        type: 'text' as const,
        text: `Plugin "${pluginName}" v${version} has been reviewed and permission set to "${permission}".\n\nNote: This tool should only be called after the user has explicitly confirmed they want to enable the plugin following your code review.`,
      },
    ],
  };
};

export type { DispatchCallbacks, RequestHandlerExtra, ToolCallResult };
export {
  formatStructuredError,
  formatZodError,
  handleBrowserToolCall,
  handlePluginInspect,
  handlePluginMarkReviewed,
  handlePluginToolCall,
  REVIEW_GUIDANCE,
  sanitizeOutput,
};
