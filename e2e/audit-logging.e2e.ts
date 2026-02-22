/**
 * Audit logging E2E tests — verifies the audit log pipeline:
 *   - Tool invocations (success and failure) are recorded in the audit log
 *   - GET /audit returns entries with correct fields and ordering
 *   - GET /audit supports filtering by plugin, tool, success, and limit
 *   - GET /audit supports combined tool+plugin filters
 *   - GET /health includes auditSummary with aggregate stats
 *   - GET /audit without auth returns 401
 *
 * All tests use dynamic ports and are safe for parallel execution.
 */

import { test, expect } from './fixtures.js';
import { setupToolTest, callToolExpectSuccess } from './helpers.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuditEntry {
  timestamp: string;
  tool: string;
  plugin: string;
  success: boolean;
  durationMs: number;
  error?: { code: string; message: string; category?: string };
}

interface AuditSummary {
  totalInvocations: number;
  successCount: number;
  failureCount: number;
  last24h: { total: number; success: number; failure: number };
  avgDurationMs: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fetchAudit = async (
  port: number,
  secret: string | undefined,
  params?: Record<string, string>,
): Promise<{ status: number; entries: AuditEntry[] }> => {
  const url = new URL(`http://localhost:${port}/audit`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const headers: Record<string, string> = {};
  if (secret) headers['Authorization'] = `Bearer ${secret}`;

  const res = await fetch(url.toString(), {
    headers,
    signal: AbortSignal.timeout(5_000),
  });

  if (!res.ok) return { status: res.status, entries: [] };
  const entries = (await res.json()) as AuditEntry[];
  return { status: res.status, entries };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Audit logging', () => {
  test('records successful and failed tool invocations with correct fields and ordering', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Invoke a successful tool
    await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', { message: 'audit-test' });

    // Invoke a tool that fails
    const failResult = await mcpClient.callTool('e2e-test_failing_tool', {});
    expect(failResult.isError).toBe(true);

    // Fetch audit log
    const { status, entries } = await fetchAudit(mcpServer.port, mcpServer.secret);
    expect(status).toBe(200);
    expect(entries.length).toBeGreaterThanOrEqual(2);

    // Verify entries have required fields
    for (const entry of entries) {
      expect(typeof entry.timestamp).toBe('string');
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601
      expect(typeof entry.tool).toBe('string');
      expect(typeof entry.plugin).toBe('string');
      expect(typeof entry.success).toBe('boolean');
      expect(typeof entry.durationMs).toBe('number');
    }

    // Verify newest-first ordering
    for (let i = 1; i < entries.length; i++) {
      const current = entries[i];
      const previous = entries[i - 1];
      if (!current || !previous) throw new Error(`Missing entry at index ${i}`);
      expect(new Date(previous.timestamp).getTime()).toBeGreaterThanOrEqual(new Date(current.timestamp).getTime());
    }

    // Verify we have both success and failure entries
    const successes = entries.filter(e => e.success);
    const failures = entries.filter(e => !e.success);
    expect(successes.length).toBeGreaterThanOrEqual(1);
    expect(failures.length).toBeGreaterThanOrEqual(1);

    // Verify the failed entry has an error object
    const failedEntry = failures[0];
    if (!failedEntry) throw new Error('No failed entry found');
    expect(failedEntry.error).toBeDefined();
    if (!failedEntry.error) throw new Error('Failed entry has no error');
    expect(typeof failedEntry.error.code).toBe('string');
    expect(typeof failedEntry.error.message).toBe('string');

    await page.close();
  });

  test('GET /audit?plugin=e2e-test filters by plugin name', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Invoke a tool to create audit entries
    await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', { message: 'plugin-filter' });

    // Filter by plugin
    const { entries } = await fetchAudit(mcpServer.port, mcpServer.secret, { plugin: 'e2e-test' });
    expect(entries.length).toBeGreaterThanOrEqual(1);
    for (const entry of entries) {
      expect(entry.plugin).toBe('e2e-test');
    }

    // Filter by a non-existent plugin
    const { entries: empty } = await fetchAudit(mcpServer.port, mcpServer.secret, { plugin: 'nonexistent-plugin' });
    expect(empty).toEqual([]);

    await page.close();
  });

  test('GET /audit?success=false filters to only failed invocations', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Create both success and failure entries
    await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', { message: 'success-entry' });
    await mcpClient.callTool('e2e-test_failing_tool', {});

    // Filter by success=false
    const { entries } = await fetchAudit(mcpServer.port, mcpServer.secret, { success: 'false' });
    expect(entries.length).toBeGreaterThanOrEqual(1);
    for (const entry of entries) {
      expect(entry.success).toBe(false);
    }

    await page.close();
  });

  test('GET /audit?limit=1 returns exactly 1 entry', async ({ mcpServer, testServer, extensionContext, mcpClient }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Create at least 2 entries
    await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', { message: 'limit-1' });
    await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', { message: 'limit-2' });

    const { entries } = await fetchAudit(mcpServer.port, mcpServer.secret, { limit: '1' });
    expect(entries.length).toBe(1);

    await page.close();
  });

  test('GET /health includes auditSummary with correct aggregate stats', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Invoke tools to populate audit log
    await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', { message: 'health-audit-1' });
    await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', { message: 'health-audit-2' });
    await mcpClient.callTool('e2e-test_failing_tool', {});

    // Fetch health
    const res = await fetch(`http://localhost:${mcpServer.port}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    expect(res.ok).toBe(true);
    const health = (await res.json()) as Record<string, unknown>;

    const auditSummary = health.auditSummary as AuditSummary;
    expect(auditSummary).toBeDefined();
    expect(auditSummary.totalInvocations).toBeGreaterThanOrEqual(3);
    expect(auditSummary.successCount + auditSummary.failureCount).toBe(auditSummary.totalInvocations);
    expect(auditSummary.successCount).toBeGreaterThanOrEqual(2);
    expect(auditSummary.failureCount).toBeGreaterThanOrEqual(1);
    expect(typeof auditSummary.avgDurationMs).toBe('number');
    expect(auditSummary.avgDurationMs).toBeGreaterThanOrEqual(0);

    // last24h stats should match total stats (all entries are within last 24h)
    expect(auditSummary.last24h.total).toBe(auditSummary.totalInvocations);
    expect(auditSummary.last24h.success).toBe(auditSummary.successCount);
    expect(auditSummary.last24h.failure).toBe(auditSummary.failureCount);

    await page.close();
  });

  test('GET /audit?tool=<name> filters by tool name', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Invoke two different tools to create distinct audit entries
    await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', { message: 'tool-filter' });
    await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_greet', { name: 'AuditTest' });

    // Filter by tool name — only echo entries
    const { entries: echoEntries } = await fetchAudit(mcpServer.port, mcpServer.secret, { tool: 'e2e-test_echo' });
    expect(echoEntries.length).toBeGreaterThanOrEqual(1);
    for (const entry of echoEntries) {
      expect(entry.tool).toBe('e2e-test_echo');
    }

    // Filter by tool name — only greet entries
    const { entries: greetEntries } = await fetchAudit(mcpServer.port, mcpServer.secret, { tool: 'e2e-test_greet' });
    expect(greetEntries.length).toBeGreaterThanOrEqual(1);
    for (const entry of greetEntries) {
      expect(entry.tool).toBe('e2e-test_greet');
    }

    // Filter by a non-existent tool returns empty
    const { entries: empty } = await fetchAudit(mcpServer.port, mcpServer.secret, { tool: 'nonexistent_tool' });
    expect(empty).toEqual([]);

    await page.close();
  });

  test('GET /audit?tool=<name>&plugin=<name> filters by both tool and plugin', async ({
    mcpServer,
    testServer,
    extensionContext,
    mcpClient,
  }) => {
    const page = await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Invoke tools to create audit entries
    await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_echo', { message: 'combined-filter' });
    await callToolExpectSuccess(mcpClient, mcpServer, 'e2e-test_greet', { name: 'CombinedTest' });

    // Combined filter: correct tool + correct plugin
    const { entries: matched } = await fetchAudit(mcpServer.port, mcpServer.secret, {
      tool: 'e2e-test_echo',
      plugin: 'e2e-test',
    });
    expect(matched.length).toBeGreaterThanOrEqual(1);
    for (const entry of matched) {
      expect(entry.tool).toBe('e2e-test_echo');
      expect(entry.plugin).toBe('e2e-test');
    }

    // Combined filter: correct tool + wrong plugin returns empty
    const { entries: noMatch } = await fetchAudit(mcpServer.port, mcpServer.secret, {
      tool: 'e2e-test_echo',
      plugin: 'nonexistent-plugin',
    });
    expect(noMatch).toEqual([]);

    await page.close();
  });

  test('GET /audit without Bearer auth returns 401', async ({ mcpServer, testServer, extensionContext, mcpClient }) => {
    await setupToolTest(mcpServer, testServer, extensionContext, mcpClient);

    // Fetch audit without auth
    const res = await fetch(`http://localhost:${mcpServer.port}/audit`, {
      signal: AbortSignal.timeout(5_000),
    });
    expect(res.status).toBe(401);
  });
});
