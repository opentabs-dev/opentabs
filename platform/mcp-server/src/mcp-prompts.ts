/**
 * MCP prompt definitions for the OpenTabs server.
 *
 * Prompts are pre-built templates that help AI agents accomplish specific tasks.
 * Unlike instructions (sent on every session), prompts are pull-based — clients
 * fetch them on demand via `prompts/get` when the user invokes them.
 *
 * Each prompt resolver returns messages that combine:
 *   1. A user-role text message with the workflow/task instructions
 *   2. Embedded resource content blocks for relevant guides and references
 *
 * Embedding resources directly into prompt messages ensures that MCP clients
 * automatically receive the full context they need — they do not need to
 * separately fetch resources via resources/read. This is the MCP-native
 * mechanism for composing prompts with reference material.
 *
 * Current prompts:
 *   - `build_plugin`: Full workflow for building a new OpenTabs plugin
 *   - `troubleshoot`: Guided debugging workflow for diagnosing platform issues
 *   - `setup_plugin`: Step-by-step workflow for installing and configuring a plugin
 *   - `plugin_icon`: Add or update an SVG icon for a plugin
 *   - `audit_ai_docs`: Audit and improve AI-facing documentation (instructions, resources, prompts)
 */

import { getStaticResourceContent } from './mcp-resources.js';
import { auditAiDocsPromptText } from './prompts/audit-ai-docs.js';
import { buildPluginPromptText } from './prompts/build-plugin.js';
import { contributeLearningsPromptText } from './prompts/contribute-learnings.js';
import { pluginIconPromptText } from './prompts/plugin-icon.js';
import { setupPluginPromptText } from './prompts/setup-plugin.js';
import { troubleshootPromptText } from './prompts/troubleshoot.js';

/** A single prompt argument definition */
interface PromptArgument {
  name: string;
  description: string;
  required?: boolean;
}

/** A prompt definition for MCP prompts/list */
export interface PromptDefinition {
  name: string;
  title?: string;
  description: string;
  arguments: PromptArgument[];
}

/** Text content block in a prompt message */
interface TextContent {
  type: 'text';
  text: string;
}

/** Embedded resource content block in a prompt message (MCP 2025-06-18 spec) */
interface EmbeddedResourceContent {
  type: 'resource';
  resource: {
    uri: string;
    mimeType: string;
    text: string;
  };
}

/** Content types that can appear in prompt messages */
type PromptContent = TextContent | EmbeddedResourceContent;

/** A resolved prompt message for MCP prompts/get */
export interface PromptMessage {
  role: 'user' | 'assistant';
  content: PromptContent;
}

/** Result of resolving a prompt */
export interface PromptResult {
  description: string;
  messages: PromptMessage[];
}

/** All registered prompts */
export const PROMPTS: PromptDefinition[] = [
  {
    name: 'build_plugin',
    title: 'Build a Plugin',
    description:
      'Step-by-step workflow for building a new OpenTabs plugin for a web application. ' +
      'Covers site analysis, auth discovery, API mapping, scaffolding, implementation, and testing. ' +
      'Use this when you want to create a plugin that gives AI agents access to a web app.',
    arguments: [
      {
        name: 'url',
        description: 'URL of the target web application (e.g., "https://app.example.com")',
        required: true,
      },
      {
        name: 'name',
        description: 'Plugin name in kebab-case (e.g., "my-app"). Derived from the URL if omitted.',
        required: false,
      },
    ],
  },
  {
    name: 'troubleshoot',
    title: 'Troubleshoot Issues',
    description:
      'Guided debugging workflow for diagnosing OpenTabs platform issues. ' +
      'Walks through extension connectivity, plugin state, tab readiness, permissions, ' +
      'and common error scenarios with specific tool calls at each step. ' +
      'Use this when tools fail, the extension is disconnected, or the platform misbehaves.',
    arguments: [
      {
        name: 'error',
        description:
          'The error message or symptom to diagnose (e.g., "Extension not connected", "Tab closed"). ' +
          'If omitted, runs a general health check workflow.',
        required: false,
      },
    ],
  },
  {
    name: 'setup_plugin',
    title: 'Set Up a Plugin',
    description:
      'Step-by-step workflow for installing, configuring, reviewing, and testing an existing ' +
      'OpenTabs plugin from npm. Covers search, install, review flow, permission configuration, ' +
      'and verification. Use this when you want to add a plugin to the platform.',
    arguments: [
      {
        name: 'name',
        description: 'Plugin name or npm package name (e.g., "slack" or "@opentabs-dev/opentabs-plugin-slack")',
        required: true,
      },
    ],
  },
  {
    name: 'plugin_icon',
    title: 'Add Plugin Icon',
    description:
      'Step-by-step workflow for adding or updating an SVG icon for an OpenTabs plugin. ' +
      'Covers obtaining the brand SVG, preparing it (square viewBox, size constraints), ' +
      'placing it, building, and verifying in the side panel.',
    arguments: [
      {
        name: 'plugin',
        description: 'Plugin name (e.g., "slack", "discord"). Used to locate the plugin directory.',
        required: true,
      },
    ],
  },
  {
    name: 'audit_ai_docs',
    title: 'Audit AI Documentation',
    description:
      'Audit and improve AI-facing documentation served by the MCP server. ' +
      'Verifies accuracy of instructions, resources, and prompts against the actual codebase. ' +
      'Identifies gaps, stale content, and drift. Use this to keep AI docs up to date.',
    arguments: [],
  },
  {
    name: 'contribute_learnings',
    title: 'Contribute Learnings',
    description:
      'Write new patterns, gotchas, and techniques back into MCP server source code after completing any task. ' +
      'Edits to these source files compile into the resources and prompts served to every future AI session, ' +
      'creating a self-improving loop. Invoke this after plugin development, troubleshooting, or any task that surfaced new knowledge.',
    arguments: [
      {
        name: 'task',
        description:
          'Brief description of the task you completed (e.g., "built a plugin for Linear", "fixed CORS issue with Notion API"). ' +
          'If omitted, reviews the entire session for learnings.',
        required: false,
      },
    ],
  },
];

/** Prompt name → definition for O(1) lookup */
const PROMPT_MAP = new Map(PROMPTS.map(p => [p.name, p]));

/**
 * Build an embedded resource content block from a resource URI.
 * Returns null if the resource content is not available (dynamic or unknown).
 */
const embedResource = (uri: string, mimeType: string): EmbeddedResourceContent | null => {
  const text = getStaticResourceContent(uri);
  if (!text) return null;
  return { type: 'resource', resource: { uri, mimeType, text } };
};

/**
 * Build prompt messages: a primary text message followed by embedded resources.
 * Resources that fail to resolve (dynamic resources, unknown URIs) are silently skipped.
 */
const buildMessages = (text: string, resourceUris: Array<{ uri: string; mimeType: string }>): PromptMessage[] => {
  const messages: PromptMessage[] = [{ role: 'user', content: { type: 'text', text } }];

  for (const { uri, mimeType } of resourceUris) {
    const embedded = embedResource(uri, mimeType);
    if (embedded) {
      messages.push({ role: 'user', content: embedded });
    }
  }

  return messages;
};

/**
 * Resolve a prompt by name with the given arguments.
 * Returns null if the prompt name is not recognized.
 */
export const resolvePrompt = (name: string, args: Record<string, string>): PromptResult | null => {
  const def = PROMPT_MAP.get(name);
  if (!def) return null;

  switch (name) {
    case 'build_plugin':
      return resolveBuildPlugin(args);
    case 'troubleshoot':
      return resolveTroubleshoot(args);
    case 'setup_plugin':
      return resolveSetupPlugin(args);
    case 'plugin_icon':
      return resolvePluginIcon(args);
    case 'audit_ai_docs':
      return resolveAuditAiDocs();
    case 'contribute_learnings':
      return resolveContributeLearnings(args);
    default:
      return null;
  }
};

// ---------------------------------------------------------------------------
// build_plugin prompt
// ---------------------------------------------------------------------------

const resolveBuildPlugin = (args: Record<string, string>): PromptResult => {
  const url = args.url ?? 'https://example.com';
  const name = args.name ?? '';

  return {
    description: `Build an OpenTabs plugin for ${url}`,
    messages: buildMessages(buildPluginPromptText(url, name), [
      { uri: 'opentabs://guide/plugin-development', mimeType: 'text/markdown' },
      { uri: 'opentabs://reference/sdk-api', mimeType: 'text/markdown' },
    ]),
  };
};

// ---------------------------------------------------------------------------
// troubleshoot prompt
// ---------------------------------------------------------------------------

const resolveTroubleshoot = (args: Record<string, string>): PromptResult => {
  const error = args.error ?? '';

  return {
    description: error ? `Troubleshoot OpenTabs issue: ${error}` : 'Run a general OpenTabs health check',
    messages: buildMessages(troubleshootPromptText(error), [
      { uri: 'opentabs://guide/troubleshooting', mimeType: 'text/markdown' },
    ]),
  };
};

// ---------------------------------------------------------------------------
// setup_plugin prompt
// ---------------------------------------------------------------------------

const resolveSetupPlugin = (args: Record<string, string>): PromptResult => {
  const name = args.name ?? 'my-plugin';

  return {
    description: `Set up the ${name} OpenTabs plugin`,
    messages: buildMessages(setupPluginPromptText(name), [
      { uri: 'opentabs://guide/quick-start', mimeType: 'text/markdown' },
    ]),
  };
};

// ---------------------------------------------------------------------------
// plugin_icon prompt
// ---------------------------------------------------------------------------

const resolvePluginIcon = (args: Record<string, string>): PromptResult => {
  const plugin = args.plugin ?? 'my-plugin';

  return {
    description: `Add or update icon for the ${plugin} plugin`,
    messages: buildMessages(pluginIconPromptText(plugin), []),
  };
};

// ---------------------------------------------------------------------------
// audit_ai_docs prompt
// ---------------------------------------------------------------------------

const resolveAuditAiDocs = (): PromptResult => ({
  description: 'Audit and improve AI-facing documentation',
  messages: buildMessages(auditAiDocsPromptText(), [
    { uri: 'opentabs://guide/quick-start', mimeType: 'text/markdown' },
    { uri: 'opentabs://guide/plugin-development', mimeType: 'text/markdown' },
    { uri: 'opentabs://guide/troubleshooting', mimeType: 'text/markdown' },
    { uri: 'opentabs://guide/self-improvement', mimeType: 'text/markdown' },
    { uri: 'opentabs://reference/sdk-api', mimeType: 'text/markdown' },
    { uri: 'opentabs://reference/cli', mimeType: 'text/markdown' },
    { uri: 'opentabs://reference/browser-tools', mimeType: 'text/markdown' },
  ]),
});

// ---------------------------------------------------------------------------
// contribute_learnings prompt
// ---------------------------------------------------------------------------

const resolveContributeLearnings = (args: Record<string, string>): PromptResult => {
  const task = args.task ?? '';

  return {
    description: task ? `Contribute learnings from: ${task}` : 'Contribute learnings from recent session',
    messages: buildMessages(contributeLearningsPromptText(task), [
      { uri: 'opentabs://guide/self-improvement', mimeType: 'text/markdown' },
      { uri: 'opentabs://guide/plugin-development', mimeType: 'text/markdown' },
      { uri: 'opentabs://guide/troubleshooting', mimeType: 'text/markdown' },
    ]),
  };
};
