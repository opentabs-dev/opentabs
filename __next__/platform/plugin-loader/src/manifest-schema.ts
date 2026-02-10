import { z } from 'zod';
import type { PluginManifest } from '@opentabs/core';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Reserved plugin names that conflict with platform internals */
const RESERVED_NAMES = new Set(['browser', 'system', 'extension', 'plugin', 'opentabs']);

/** Chrome match pattern regex: scheme://host/path */
const CHROME_MATCH_PATTERN = /^(https?|\*):\/\/(\*|(\*\.)?[a-z0-9.-]+)\/(.*)?$/;

/** Overly broad URL patterns that would match too many pages */
const OVERLY_BROAD_URL_PATTERNS = new Set(['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*']);

/** Overly broad network permission patterns */
const OVERLY_BROAD_NETWORK_PATTERNS = new Set(['*', '*.*', '*.*.*']);

/** Semver regex (simplified — major.minor.patch with optional pre-release/build) */
const SEMVER_REGEX = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/;

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

const pluginNameSchema = z
  .string()
  .min(1, 'Plugin name must not be empty')
  .max(100, 'Plugin name must not exceed 100 characters')
  .regex(/^[a-z][a-z0-9-]*$/, 'Plugin name must be lowercase alphanumeric with hyphens, starting with a letter')
  .check(ctx => {
    if (RESERVED_NAMES.has(ctx.value)) {
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        message: `Plugin name "${ctx.value}" is reserved. Reserved names: ${[...RESERVED_NAMES].join(', ')}`,
      });
    }
  });

const chromeMatchPatternSchema = z.string().check(ctx => {
  if (OVERLY_BROAD_URL_PATTERNS.has(ctx.value)) {
    ctx.issues.push({
      code: 'custom',
      input: ctx.value,
      message: `URL pattern "${ctx.value}" is overly broad. Plugins must target specific domains.`,
    });
    return;
  }
  if (!CHROME_MATCH_PATTERN.test(ctx.value)) {
    ctx.issues.push({
      code: 'custom',
      input: ctx.value,
      message: `"${ctx.value}" is not a valid Chrome match pattern. Expected format: scheme://host/path (e.g., "https://app.slack.com/*")`,
    });
  }
});

const domainSchema = z
  .string()
  .min(1, 'Domain must not be empty')
  .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'Domain must be a valid domain name (e.g., "app.slack.com")');

const networkPermissionSchema = z.string().check(ctx => {
  if (OVERLY_BROAD_NETWORK_PATTERNS.has(ctx.value)) {
    ctx.issues.push({
      code: 'custom',
      input: ctx.value,
      message: `Network permission "${ctx.value}" is overly broad. Specify exact domains.`,
    });
  }
});

const adapterConfigSchema = z.object({
  domains: z.array(domainSchema).min(1, 'At least one domain is required'),
  urlPatterns: z.array(chromeMatchPatternSchema).min(1, 'At least one URL pattern is required'),
  hostPermissions: z.array(chromeMatchPatternSchema),
  defaultUrl: z.string().url('defaultUrl must be a valid URL'),
});

const healthCheckConfigSchema = z.object({
  method: z.string().min(1, 'Health check method must not be empty'),
  params: z.record(z.string(), z.unknown()).optional(),
});

const serviceConfigSchema = z.object({
  timeout: z
    .number()
    .int()
    .min(100, 'Timeout must be at least 100ms')
    .max(300_000, 'Timeout must not exceed 300 seconds'),
  environments: z.array(z.enum(['webapp', 'native'])).min(1, 'At least one environment is required'),
  authErrorPatterns: z.array(z.string()).optional(),
  healthCheck: healthCheckConfigSchema.optional(),
  notConnectedMessage: z.string().optional(),
  tabNotFoundMessage: z.string().optional(),
});

const toolCategorySchema = z.object({
  name: z.string().min(1, 'Category name must not be empty'),
  tools: z.array(z.string().min(1, 'Tool name must not be empty')),
});

const nativeApiPermissionSchema = z.enum(['browser', 'tabs', 'scripting', 'storage']);

const permissionsSchema = z.object({
  network: z.array(networkPermissionSchema).optional(),
  storage: z.array(z.string()).optional(),
  nativeApis: z.array(nativeApiPermissionSchema).optional(),
});

// ---------------------------------------------------------------------------
// Top-level manifest schema
// ---------------------------------------------------------------------------

const pluginManifestSchemaBase = z.object({
  $schema: z.string().optional(),
  name: pluginNameSchema,
  displayName: z.string().min(1, 'Display name must not be empty'),
  version: z.string().regex(SEMVER_REGEX, 'Version must be valid semver (e.g., "1.0.0")'),
  description: z.string().min(1, 'Description must not be empty'),
  author: z.string().min(1, 'Author must not be empty'),
  icon: z.string().min(1, 'Icon must not be empty'),
  adapter: adapterConfigSchema,
  service: serviceConfigSchema,
  tools: z.object({
    categories: z.array(toolCategorySchema),
  }),
  permissions: permissionsSchema,
});

/**
 * Full plugin manifest Zod schema with cross-field validation.
 * Validates opentabs-plugin.json files.
 */
const pluginManifestSchema = pluginManifestSchemaBase.check(ctx => {
  const { name, adapter, service, permissions } = ctx.value;

  // Cross-field: health check method must be prefixed with the service name
  if (service.healthCheck) {
    const expectedPrefix = `${name}.`;
    if (!service.healthCheck.method.startsWith(expectedPrefix)) {
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        path: ['service', 'healthCheck', 'method'],
        message: `Health check method "${service.healthCheck.method}" must be prefixed with the service name "${name}." (e.g., "${name}.auth.test")`,
      });
    }
  }

  // Cross-field: webapp environment requires at least one domain
  if (service.environments.includes('webapp') && adapter.domains.length === 0) {
    ctx.issues.push({
      code: 'custom',
      input: ctx.value,
      path: ['adapter', 'domains'],
      message: 'Webapp services must define at least one adapter domain',
    });
  }

  // Cross-field: network permissions should cover adapter domains
  if (permissions.network && permissions.network.length > 0) {
    for (const domain of adapter.domains) {
      const covered = permissions.network.some(perm => perm === domain || domain.endsWith(`.${perm}`));
      if (!covered) {
        ctx.issues.push({
          code: 'custom',
          input: ctx.value,
          path: ['permissions', 'network'],
          message: `Adapter domain "${domain}" is not covered by any network permission. Add "${domain}" to permissions.network.`,
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Validation result types
// ---------------------------------------------------------------------------

interface ValidationIssue {
  readonly path: readonly (string | number)[];
  readonly message: string;
}

interface ValidationSuccess {
  readonly success: true;
  readonly data: PluginManifest;
}

interface ValidationFailure {
  readonly success: false;
  readonly issues: readonly ValidationIssue[];
}

type ValidationResult = ValidationSuccess | ValidationFailure;

// ---------------------------------------------------------------------------
// Validation function
// ---------------------------------------------------------------------------

/**
 * Validates a plugin manifest (opentabs-plugin.json content) against the schema.
 * Returns a typed result with field paths and actionable error messages.
 */
const validatePluginManifest = (input: unknown): ValidationResult => {
  const result = pluginManifestSchema.safeParse(input);

  if (result.success) {
    // Strip $schema from the validated data — it's not part of PluginManifest
    const { name, displayName, version, description, author, icon, adapter, service, tools, permissions } = result.data;
    const manifest: PluginManifest = {
      name,
      displayName,
      version,
      description,
      author,
      icon,
      adapter,
      service,
      tools,
      permissions,
    };
    return { success: true, data: manifest };
  }

  const issues: ValidationIssue[] = result.error.issues.map(issue => ({
    path: (issue.path ?? []).filter((p): p is string | number => typeof p !== 'symbol'),
    message: issue.message,
  }));

  return { success: false, issues };
};

// ---------------------------------------------------------------------------
// Conflict detection across multiple plugins
// ---------------------------------------------------------------------------

interface NameConflict {
  readonly name: string;
  readonly sources: readonly string[];
}

interface UrlPatternOverlap {
  readonly pattern: string;
  readonly plugins: readonly string[];
}

interface ConflictDetectionResult {
  readonly nameConflicts: readonly NameConflict[];
  readonly urlPatternOverlaps: readonly UrlPatternOverlap[];
  readonly hasConflicts: boolean;
}

/**
 * Detects name conflicts and URL pattern overlaps across multiple plugin manifests.
 * Call this after validating individual manifests to find inter-plugin issues.
 */
const detectConflicts = (
  manifests: readonly { readonly name: string; readonly source: string; readonly manifest: PluginManifest }[],
): ConflictDetectionResult => {
  // Detect name conflicts
  const nameMap = new Map<string, string[]>();
  for (const entry of manifests) {
    const existing = nameMap.get(entry.manifest.name);
    if (existing) {
      existing.push(entry.source);
    } else {
      nameMap.set(entry.manifest.name, [entry.source]);
    }
  }

  const nameConflicts: NameConflict[] = [];
  for (const [name, sources] of nameMap) {
    if (sources.length > 1) {
      nameConflicts.push({ name, sources });
    }
  }

  // Detect URL pattern overlaps
  const patternMap = new Map<string, string[]>();
  for (const entry of manifests) {
    for (const pattern of entry.manifest.adapter.urlPatterns) {
      const existing = patternMap.get(pattern);
      if (existing) {
        existing.push(entry.manifest.name);
      } else {
        patternMap.set(pattern, [entry.manifest.name]);
      }
    }
  }

  const urlPatternOverlaps: UrlPatternOverlap[] = [];
  for (const [pattern, plugins] of patternMap) {
    if (plugins.length > 1) {
      urlPatternOverlaps.push({ pattern, plugins });
    }
  }

  const hasConflicts = nameConflicts.length > 0 || urlPatternOverlaps.length > 0;

  return { nameConflicts, urlPatternOverlaps, hasConflicts };
};

export {
  pluginManifestSchema,
  validatePluginManifest,
  detectConflicts,
  RESERVED_NAMES,
  type ValidationResult,
  type ValidationSuccess,
  type ValidationFailure,
  type ValidationIssue,
  type NameConflict,
  type UrlPatternOverlap,
  type ConflictDetectionResult,
};
