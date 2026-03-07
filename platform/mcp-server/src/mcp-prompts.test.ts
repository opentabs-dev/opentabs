import { describe, expect, test } from 'vitest';
import { PROMPTS, type PromptMessage, resolvePrompt } from './mcp-prompts.js';

/** Extract the text from the first message (always a text content block). */
const firstMessageText = (messages: PromptMessage[] | undefined): string => {
  const msg = messages?.[0];
  if (!msg || msg.content.type !== 'text') return '';
  return msg.content.text;
};

/** Extract embedded resource URIs from prompt messages. */
const embeddedResourceUris = (messages: PromptMessage[]): string[] =>
  messages
    .filter((m): m is PromptMessage & { content: { type: 'resource' } } => m.content.type === 'resource')
    .map(m => {
      const content = m.content as { type: 'resource'; resource: { uri: string } };
      return content.resource.uri;
    });

describe('PROMPTS — prompt definitions', () => {
  test('contains build_plugin prompt', () => {
    const names = PROMPTS.map(p => p.name);
    expect(names).toContain('build_plugin');
  });

  test('build_plugin has a non-empty description', () => {
    const prompt = PROMPTS.find(p => p.name === 'build_plugin');
    expect(prompt).toBeDefined();
    expect(prompt?.description.length).toBeGreaterThan(0);
  });

  test('build_plugin has url argument marked as required', () => {
    const prompt = PROMPTS.find(p => p.name === 'build_plugin');
    const urlArg = prompt?.arguments.find(a => a.name === 'url');
    expect(urlArg).toBeDefined();
    expect(urlArg?.required).toBe(true);
  });

  test('build_plugin has name argument marked as optional', () => {
    const prompt = PROMPTS.find(p => p.name === 'build_plugin');
    const nameArg = prompt?.arguments.find(a => a.name === 'name');
    expect(nameArg).toBeDefined();
    expect(nameArg?.required).toBe(false);
  });

  test('all prompts have unique names', () => {
    const names = PROMPTS.map(p => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('all prompt arguments have descriptions', () => {
    for (const prompt of PROMPTS) {
      for (const arg of prompt.arguments) {
        expect(arg.description.length, `${prompt.name}.${arg.name} missing description`).toBeGreaterThan(0);
      }
    }
  });
});

describe('resolvePrompt — build_plugin', () => {
  test('returns result with url substituted into messages', () => {
    const result = resolvePrompt('build_plugin', { url: 'https://app.slack.com' });
    expect(result).not.toBeNull();
    expect(result?.description).toContain('https://app.slack.com');
    // First message is the workflow text, subsequent messages are embedded resources
    expect(result?.messages.length).toBeGreaterThanOrEqual(1);
    const msg = result?.messages[0];
    expect(msg?.role).toBe('user');
    expect(msg?.content.type).toBe('text');
    expect(firstMessageText(result?.messages)).toContain('https://app.slack.com');
  });

  test('includes plugin name in output when name argument is provided', () => {
    const result = resolvePrompt('build_plugin', { url: 'https://slack.com', name: 'slack' });
    expect(firstMessageText(result?.messages)).toContain('`slack`');
  });

  test('omits name clause when name argument is empty', () => {
    const result = resolvePrompt('build_plugin', { url: 'https://slack.com' });
    const text = firstMessageText(result?.messages);
    expect(text).not.toContain('The plugin name should be');
  });

  test('uses default url when url argument is missing', () => {
    const result = resolvePrompt('build_plugin', {});
    expect(firstMessageText(result?.messages)).toContain('https://example.com');
  });

  test('includes key workflow phases', () => {
    const result = resolvePrompt('build_plugin', { url: 'https://example.com' });
    const text = firstMessageText(result?.messages);
    expect(text).toContain('Phase 1');
    expect(text).toContain('Phase 2');
    expect(text).toContain('Phase 3');
    expect(text).toContain('Phase 4');
    expect(text).toContain('Phase 5');
  });

  test('includes plugin_analyze_site tool reference with provided URL', () => {
    const result = resolvePrompt('build_plugin', { url: 'https://linear.app' });
    const text = firstMessageText(result?.messages);
    expect(text).toContain('plugin_analyze_site');
    expect(text).toContain('https://linear.app');
  });

  test('includes SDK references and code patterns', () => {
    const result = resolvePrompt('build_plugin', { url: 'https://example.com' });
    const text = firstMessageText(result?.messages);
    expect(text).toContain('OpenTabsPlugin');
    expect(text).toContain('defineTool');
    expect(text).toContain('ToolError');
    expect(text).toContain('isReady');
  });

  test('includes common gotchas', () => {
    const result = resolvePrompt('build_plugin', { url: 'https://example.com' });
    const text = firstMessageText(result?.messages);
    expect(text).toContain('Common Gotchas');
    expect(text).toContain('credentials');
  });

  test('description reflects the target URL', () => {
    const result = resolvePrompt('build_plugin', { url: 'https://my-app.io' });
    expect(result?.description).toBe('Build an OpenTabs plugin for https://my-app.io');
  });

  test('embeds plugin-development and sdk-api resources', () => {
    const result = resolvePrompt('build_plugin', { url: 'https://example.com' });
    expect(result).not.toBeNull();
    const uris = embeddedResourceUris(result?.messages ?? []);
    expect(uris).toHaveLength(2);
    expect(uris).toContain('opentabs://guide/plugin-development');
    expect(uris).toContain('opentabs://reference/sdk-api');
  });
});

describe('resolvePrompt — troubleshoot', () => {
  test('embeds troubleshooting resource', () => {
    const result = resolvePrompt('troubleshoot', {});
    expect(result).not.toBeNull();
    const uris = embeddedResourceUris(result?.messages ?? []);
    expect(uris).toHaveLength(1);
    expect(uris).toContain('opentabs://guide/troubleshooting');
  });
});

describe('resolvePrompt — setup_plugin', () => {
  test('embeds quick-start resource', () => {
    const result = resolvePrompt('setup_plugin', { name: 'slack' });
    expect(result).not.toBeNull();
    const uris = embeddedResourceUris(result?.messages ?? []);
    expect(uris).toHaveLength(1);
    expect(uris).toContain('opentabs://guide/quick-start');
  });
});

describe('resolvePrompt — audit_ai_docs', () => {
  test('embeds all static resources', () => {
    const result = resolvePrompt('audit_ai_docs', {});
    expect(result).not.toBeNull();
    const uris = embeddedResourceUris(result?.messages ?? []);
    // All 7 static resources (excludes dynamic opentabs://status)
    expect(uris).toHaveLength(7);
  });
});

describe('resolvePrompt — contribute_learnings', () => {
  test('returns result with task substituted', () => {
    const result = resolvePrompt('contribute_learnings', { task: 'built a Slack plugin' });
    expect(result).not.toBeNull();
    expect(result?.description).toContain('built a Slack plugin');
    expect(firstMessageText(result?.messages)).toContain('built a Slack plugin');
  });

  test('works without task argument', () => {
    const result = resolvePrompt('contribute_learnings', {});
    expect(result).not.toBeNull();
    expect(result?.description).toContain('recent session');
    expect(firstMessageText(result?.messages)).toContain('Review your recent session');
  });

  test('embeds self-improvement, plugin-development, and troubleshooting resources', () => {
    const result = resolvePrompt('contribute_learnings', {});
    expect(result).not.toBeNull();
    const uris = embeddedResourceUris(result?.messages ?? []);
    expect(uris).toHaveLength(3);
    expect(uris).toContain('opentabs://guide/self-improvement');
    expect(uris).toContain('opentabs://guide/plugin-development');
    expect(uris).toContain('opentabs://guide/troubleshooting');
  });

  test('includes contribution workflow steps', () => {
    const result = resolvePrompt('contribute_learnings', {});
    const text = firstMessageText(result?.messages);
    expect(text).toContain('Step 1');
    expect(text).toContain('Step 2');
    expect(text).toContain('Step 3');
  });

  test('references the self-improvement resource', () => {
    const result = resolvePrompt('contribute_learnings', {});
    const text = firstMessageText(result?.messages);
    expect(text).toContain('opentabs://guide/self-improvement');
  });
});

describe('resolvePrompt — unknown prompts', () => {
  test('returns null for unknown prompt name', () => {
    expect(resolvePrompt('nonexistent', {})).toBeNull();
  });

  test('returns null for empty prompt name', () => {
    expect(resolvePrompt('', {})).toBeNull();
  });
});
