# Plugin Usage Telemetry

**Date:** 2026-04-30
**Status:** Approved, ready for implementation

## Problem

We have no visibility into which plugins are actually used. Without usage data, it is impossible to decide which plugins need more engineering attention, which tools are broken for real users, and which plugins can be deprioritized. The existing PostHog telemetry captures only `server_started` — enough to count installs, but not enough to measure engagement.

## Goal

Capture an anonymous `plugin_tool_used` event for every plugin tool invocation, scoped to first-party plugins that we maintain. Use the resulting data to decide where to invest engineering effort.

## Non-Goals

- Tracking third-party plugins (not ours to improve; also a privacy concern for their authors and users).
- Tracking locally developed plugins (developer noise, not production signal).
- Tracking sensitive-category plugins (`onlyfans`, `tinder`) — users of those plugins have a heightened privacy expectation that outweighs product value.
- Capturing input arguments, tab IDs, URLs, page content, or any payload data. Event shape is metadata only.
- Adding a new opt-out mechanism. Existing opt-outs (`OPENTABS_TELEMETRY_DISABLED`, `DO_NOT_TRACK`, `telemetry: false` in config) must continue to disable all plugin usage events.

## Design

### Filter predicate

A pure function in `platform/mcp-server/src/telemetry.ts`:

```ts
const FIRST_PARTY_NPM_SCOPE = '@opentabs-dev/opentabs-plugin-';
const EXCLUDED_PLUGIN_NAMES: ReadonlySet<string> = new Set(['onlyfans', 'tinder']);

const isTrackablePlugin = (plugin: RegisteredPlugin): boolean => {
  if (plugin.source !== 'npm') return false;
  if (!plugin.npmPackageName?.startsWith(FIRST_PARTY_NPM_SCOPE)) return false;
  if (EXCLUDED_PLUGIN_NAMES.has(plugin.name)) return false;
  return true;
};
```

A plugin is tracked only when all three conditions hold:

1. **`source === 'npm'`** — excludes plugins loaded from `localPlugins` filesystem paths. Local plugins mean an active development loop, not production usage.
2. **`npmPackageName` starts with `@opentabs-dev/opentabs-plugin-`** — excludes third-party plugins published under any other npm name. Every first-party plugin in this repository is published under this scope.
3. **`plugin.name` is not in `EXCLUDED_PLUGIN_NAMES`** — excludes sensitive-category plugins regardless of how they were installed.

Any failure short-circuits to `false` and no event is sent.

### Event capture function

Exported from `telemetry.ts`:

```ts
const trackPluginToolUsage = (
  plugin: RegisteredPlugin,
  toolName: string,
  outcome: { success: boolean; errorCategory?: string; durationMs: number },
): void => {
  if (!isTrackablePlugin(plugin)) return;

  trackEvent('plugin_tool_used', {
    session_id: getSessionId(),
    plugin_name: plugin.name,
    plugin_version: plugin.version,
    tool_name: toolName,
    success: outcome.success,
    error_category: outcome.errorCategory ?? 'none',
    duration_bucket: computeDurationBucket(outcome.durationMs),
  });
};

const computeDurationBucket = (ms: number): '<100ms' | '<1s' | '<5s' | '>=5s' => {
  if (ms < 100) return '<100ms';
  if (ms < 1000) return '<1s';
  if (ms < 5000) return '<5s';
  return '>=5s';
};
```

**Event properties (all anonymous, no PII):**

| Property | Type | Example | Notes |
|---|---|---|---|
| `session_id` | string (UUID) | `7b3f...` | Per-process UUID, already used by other events |
| `plugin_name` | string | `slack` | Internal plugin short name |
| `plugin_version` | string | `0.0.82` | From `package.json`, lets us correlate issues with releases |
| `tool_name` | string | `send_message` | Base tool name without plugin prefix |
| `success` | boolean | `true` / `false` | Whether the dispatch returned without error |
| `error_category` | string | `none` / `auth` / `network` / ... | From `ToolError.category` when present, `none` on success, `unknown` otherwise |
| `duration_bucket` | string | `<100ms` | Bucketed end-to-end dispatch latency |

No raw durations, no tab IDs, no input payloads, no URLs, no user identifiers, no error messages.

### Dispatch integration

Single insertion in `platform/mcp-server/src/mcp-tool-dispatch.ts`, inside the existing `finally` block of `handlePluginToolCall`, immediately after the `appendAuditEntry` call:

```ts
const plugin = state.registry.plugins.get(pluginName);
if (plugin) {
  trackPluginToolUsage(plugin, toolBaseName, {
    success,
    errorCategory: errorInfo?.category,
    durationMs,
  });
}
```

All referenced variables (`success`, `errorInfo`, `durationMs`, `pluginName`, `toolBaseName`) are already in scope — no refactoring of the dispatch pipeline is needed.

**Failure isolation.** `trackEvent` already swallows all errors silently. The `trackPluginToolUsage` call runs inside the existing `finally` block, which itself is already defensive (audit append runs regardless of success/failure). A misbehaving telemetry layer cannot affect tool results.

### Opt-out behavior

No new opt-out. `trackPluginToolUsage` delegates to `trackEvent`, which is already gated by `isTelemetryEnabled()`. When users set any of `OPENTABS_TELEMETRY_DISABLED=1`, `DO_NOT_TRACK=1`, or `telemetry: false` in config.json, no `plugin_tool_used` event fires.

### Testing

New unit tests in `platform/mcp-server/src/telemetry.test.ts`:

1. **`isTrackablePlugin` — accepts first-party npm plugin**
   Input: `{ source: 'npm', name: 'slack', npmPackageName: '@opentabs-dev/opentabs-plugin-slack' }` → `true`

2. **`isTrackablePlugin` — rejects local plugin**
   Input: `{ source: 'local', name: 'slack', npmPackageName: undefined }` → `false`

3. **`isTrackablePlugin` — rejects third-party scope**
   Input: `{ source: 'npm', name: 'foo', npmPackageName: '@someone-else/opentabs-plugin-foo' }` → `false`

4. **`isTrackablePlugin` — rejects unscoped npm**
   Input: `{ source: 'npm', name: 'foo', npmPackageName: 'opentabs-plugin-foo' }` → `false`

5. **`isTrackablePlugin` — rejects excluded plugins**
   For each of `onlyfans`, `tinder` with full first-party metadata: `false`

6. **`trackPluginToolUsage` — emits event for trackable plugin in debug mode**
   With `OPENTABS_TELEMETRY_DEBUG=1`, call with a first-party plugin → stderr contains `plugin_tool_used` and the expected properties.

7. **`trackPluginToolUsage` — emits nothing for excluded plugin in debug mode**
   With `OPENTABS_TELEMETRY_DEBUG=1`, call with an excluded or non-first-party plugin → no `plugin_tool_used` line in stderr.

8. **`computeDurationBucket` — boundaries**
   `0 → '<100ms'`, `99 → '<100ms'`, `100 → '<1s'`, `999 → '<1s'`, `1000 → '<5s'`, `4999 → '<5s'`, `5000 → '>=5s'`.

No E2E tests. Matches the testing level of existing `server_started`: telemetry is fire-and-forget and not user-observable.

### Documentation

- Update `decision_telemetry_posthog.md` auto-memory note to list `plugin_tool_used` alongside `server_started`, with the filter predicate summary and exclusion list.
- No CLAUDE.md changes needed — no existing CLAUDE.md mentions telemetry.

## Files Changed

| File | Change |
|---|---|
| `platform/mcp-server/src/telemetry.ts` | Add `FIRST_PARTY_NPM_SCOPE`, `EXCLUDED_PLUGIN_NAMES`, `isTrackablePlugin`, `computeDurationBucket`, `trackPluginToolUsage`. Export `trackPluginToolUsage` and `isTrackablePlugin`. |
| `platform/mcp-server/src/telemetry.test.ts` | Add 8 test cases covering predicate and event capture. |
| `platform/mcp-server/src/mcp-tool-dispatch.ts` | Import `trackPluginToolUsage`. Add 6-line block inside existing `finally` in `handlePluginToolCall`. |

## Verification

After implementation, the following must pass:

- `npm run build` — full platform build
- `npm run type-check`
- `npm run lint`
- `npm run knip` — no unused exports
- `npm run test` — unit tests including the 8 new cases
- `npm run test:e2e` — existing E2E suite still green
- Manual: run `OPENTABS_TELEMETRY_DEBUG=1 opentabs start`, invoke a Slack tool in a dev session, confirm stderr shows `plugin_tool_used` with the expected properties. Invoke a tool on `onlyfans` (if configured) or a local plugin, confirm no `plugin_tool_used` line appears.

## Rollout

Ship in the next patch release alongside whatever else is on main at the time. No feature flag — the filter predicate is the flag. If we later decide to expand the scope (include third-party, remove exclusions), it's a code change in one file.
