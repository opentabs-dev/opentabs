// =============================================================================
// Plugin Manifest Schema — Zod-Based Validation
//
// Defines the canonical Zod schema for opentabs-plugin.json manifests. This
// replaces the hand-rolled validation code with a declarative schema that:
//
// 1. Validates manifests with detailed, path-aware error messages
// 2. Infers TypeScript types that stay in sync with validation
// 3. Can generate JSON Schema (via zod-to-json-schema) for IDE support
//
// The schema enforces:
// - Name format (lowercase alphanumeric with hyphens, not reserved)
// - Semver version format
// - Chrome match pattern syntax for URL patterns
// - Cross-field consistency (environments ↔ domains ↔ urlPatterns)
// - Domain coverage by network permissions
// - Health check method prefix matching plugin name
// - No overly broad URL patterns or network permissions
// =============================================================================

import { RESERVED_PLUGIN_NAMES } from '@opentabs/core';
import { z } from 'zod';
import type { PluginManifest } from '@opentabs/core';

// -----------------------------------------------------------------------------
// Reusable Patterns
// -----------------------------------------------------------------------------

/** Plugin names: lowercase alphanumeric with hyphens, starting with a letter. */
const PLUGIN_NAME_REGEX = /^[a-z][a-z0-9-]*$/;

/** Simplified semver: major.minor.patch with optional pre-release suffix. */
const SEMVER_REGEX = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;

/** Chrome extension URL match pattern: scheme://host/path */
const URL_MATCH_PATTERN_REGEX = /^(\*|https?):\/\/.+\/.*/;

/** Valid environment identifiers. */
const VALID_ENVIRONMENTS = ['production', 'staging'] as const;

/** Valid native API permission identifiers. */
const VALID_NATIVE_APIS = ['browser', 'files'] as const;

/** Valid setting types. */
const VALID_SETTING_TYPES = ['string', 'number', 'boolean', 'select'] as const;

// -----------------------------------------------------------------------------
// Sub-Schemas
// -----------------------------------------------------------------------------

const pluginNameSchema = z
  .string()
  .min(1, 'Plugin name must be non-empty')
  .regex(
    PLUGIN_NAME_REGEX,
    'Plugin name must be lowercase alphanumeric with hyphens, starting with a letter (e.g. "jira", "google-sheets")',
  )
  .refine(name => !RESERVED_PLUGIN_NAMES.includes(name), {
    message: `Plugin name must not be a reserved platform name: ${RESERVED_PLUGIN_NAMES.join(', ')}`,
  });

const semverSchema = z.string().regex(SEMVER_REGEX, 'Must be a valid semver string (e.g. "1.0.0", "2.1.0-beta.1")');

const urlMatchPatternSchema = z
  .string()
  .min(1, 'URL match pattern must be non-empty')
  .regex(URL_MATCH_PATTERN_REGEX, 'Must be a valid Chrome URL match pattern (e.g. "*://*.example.com/*")')
  .refine(p => p !== '*://*/*' && p !== '<all_urls>', {
    message: 'Overly broad URL pattern. Plugins must scope to specific domains.',
  });

const environmentSchema = z.enum(VALID_ENVIRONMENTS);

const settingOptionSchema = z.object({
  value: z.string().min(1, 'Option value must be non-empty'),
  label: z.string().min(1, 'Option label must be non-empty'),
});

const settingDefinitionSchema = z
  .object({
    type: z.enum(VALID_SETTING_TYPES),
    label: z.string().min(1, 'Setting label must be non-empty'),
    description: z.string().optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    options: z.array(settingOptionSchema).min(1, 'Select settings must have at least one option').optional(),
    placeholder: z.string().optional(),
  })
  .refine(
    s => {
      if (s.type === 'select' && (!s.options || s.options.length === 0)) return false;
      return true;
    },
    { message: 'Select settings must have a non-empty options array', path: ['options'] },
  )
  .refine(
    s => {
      if (s.type === 'number' && s.min !== undefined && s.max !== undefined && s.min > s.max) return false;
      return true;
    },
    { message: 'min must not exceed max', path: ['min'] },
  );

const healthCheckSchema = z.object({
  method: z.string().min(1, 'Health check method must be non-empty (e.g. "slack.api")'),
  params: z.record(z.string(), z.unknown()),
  evaluator: z.string().min(1).optional(),
});

const adapterConfigSchema = z.object({
  entry: z.string().min(1, 'Adapter entry must be a relative path to the compiled adapter (e.g. "./dist/adapter.js")'),
  domains: z.record(z.string(), z.string().min(1, 'Domain must be a non-empty string')),
  urlPatterns: z.record(
    z.string(),
    z.array(urlMatchPatternSchema).min(1, 'Each environment must have at least one URL pattern'),
  ),
  hostPermissions: z.array(z.string()).optional(),
  defaultUrl: z.string().min(1).optional(),
});

const serviceConfigSchema = z.object({
  timeout: z
    .number()
    .positive('Timeout must be a positive number (milliseconds)')
    .max(600000, 'Timeout must not exceed 600000ms (10 minutes)'),
  environments: z.array(environmentSchema).min(1, 'Must have at least one environment'),
  authErrorPatterns: z.array(z.string()),
  healthCheck: healthCheckSchema,
  notConnectedMessage: z.string().optional(),
  tabNotFoundMessage: z.string().optional(),
});

const toolCategorySchema = z.object({
  id: z.string().min(1, 'Category id must be non-empty'),
  label: z.string().min(1, 'Category label must be non-empty'),
  tools: z.array(z.string()).optional(),
});

const toolsConfigSchema = z.object({
  entry: z.string().min(1, 'Tools entry must be a relative path to the tools module (e.g. "./dist/tools/index.js")'),
  categories: z.array(toolCategorySchema).optional(),
});

const permissionsSchema = z.object({
  network: z
    .array(
      z
        .string()
        .min(1, 'Network domain must be non-empty')
        .refine(d => d !== '*' && d !== '*.*', {
          message: 'Overly broad network permission. Plugins must scope to specific domains.',
        }),
    )
    .min(1, 'At least one network domain is required'),
  storage: z.boolean().optional(),
  nativeApis: z.array(z.enum(VALID_NATIVE_APIS)).optional(),
});

// -----------------------------------------------------------------------------
// Top-Level Manifest Schema
// -----------------------------------------------------------------------------

/**
 * The raw Zod schema for opentabs-plugin.json. Validates structure and
 * individual field constraints, but not cross-field consistency (that's
 * handled by the refinement in `pluginManifestSchema`).
 */
const rawManifestSchema = z.object({
  $schema: z.string().optional(),
  name: pluginNameSchema,
  displayName: z.string().min(1, 'displayName must be a non-empty string'),
  version: semverSchema,
  description: z.string().min(1, 'description must be a non-empty string'),
  author: z.string().optional(),
  homepage: z.string().optional(),
  license: z.string().optional(),
  adapter: adapterConfigSchema,
  service: serviceConfigSchema,
  tools: toolsConfigSchema,
  permissions: permissionsSchema,
  settings: z.record(z.string(), settingDefinitionSchema).optional(),
  icon: z.string().min(1).optional(),
  keywords: z.array(z.string()).optional(),
});

// -----------------------------------------------------------------------------
// Cross-Field Consistency Refinements
//
// These refinements enforce relationships between fields that can't be
// expressed by individual field schemas alone.
// -----------------------------------------------------------------------------

/**
 * The complete plugin manifest schema with cross-field consistency checks.
 *
 * Validates:
 * - Each declared environment has a matching domain and URL pattern set
 * - Health check method is prefixed with the plugin name
 * - Every adapter domain is covered by a network permission
 */
const pluginManifestSchema = rawManifestSchema.superRefine((manifest, ctx) => {
  const { name, adapter, service, permissions } = manifest;
  const environments = service.environments;

  // --- Environment ↔ adapter.domains consistency ---
  for (const env of environments) {
    if (!(env in adapter.domains)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Missing domain for environment "${env}" declared in service.environments`,
        path: ['adapter', 'domains'],
      });
    }
    if (!(env in adapter.urlPatterns)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Missing URL patterns for environment "${env}" declared in service.environments`,
        path: ['adapter', 'urlPatterns'],
      });
    }
  }

  // --- Health check method prefix ---
  const { method } = service.healthCheck;
  if (!method.startsWith(`${name}.`)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Health check method "${method}" should be prefixed with the plugin name "${name}." (e.g. "${name}.api" or "${name}.healthCheck")`,
      path: ['service', 'healthCheck', 'method'],
    });
  }

  // --- Adapter domains covered by network permissions ---
  const networkPermissions = permissions.network;
  for (const [env, domain] of Object.entries(adapter.domains)) {
    const isCovered = networkPermissions.some(netDomain => {
      if (netDomain.startsWith('*.')) {
        const suffix = netDomain.slice(1); // '.example.com'
        return domain.endsWith(suffix) || domain === netDomain.slice(2);
      }
      if (netDomain.startsWith('.')) {
        return domain.endsWith(netDomain) || domain === netDomain.slice(1);
      }
      return domain === netDomain || domain.endsWith(`.${netDomain}`);
    });

    if (!isCovered) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Adapter domain "${domain}" (env: ${env}) is not covered by any network permission. Add a matching entry to permissions.network.`,
        path: ['permissions', 'network'],
      });
    }
  }
});

// -----------------------------------------------------------------------------
// Validation Interface
//
// These functions provide the public API consumed by the plugin-loader.
// They wrap Zod's parsing with the ValidationResult/ValidationError types
// expected by the rest of the platform.
// -----------------------------------------------------------------------------

/** A single validation error with a path and message. */
interface ValidationError {
  /** Dot-delimited path to the invalid field (e.g. 'adapter.urlPatterns.production'). */
  readonly path: string;
  /** Human-readable description of what's wrong. */
  readonly message: string;
}

/** The result of validating a plugin manifest. */
interface ValidationResult {
  /** Whether the manifest passed all checks. */
  readonly valid: boolean;
  /** List of validation errors (empty when valid). */
  readonly errors: readonly ValidationError[];
  /** The validated manifest (only present when valid). */
  readonly manifest?: PluginManifest;
}

/**
 * Convert a ZodError into an array of ValidationError objects.
 * Maps Zod's issue paths to dot-delimited strings matching the
 * original validation error format.
 */
const zodErrorToValidationErrors = (zodError: z.ZodError): ValidationError[] =>
  zodError.issues.map(issue => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));

/**
 * Validate a plugin manifest against the schema.
 *
 * Returns a ValidationResult with detailed error messages for every invalid
 * field, or the validated manifest if all checks pass.
 *
 * @param raw - The parsed manifest object (from JSON.parse or a module import)
 * @returns A ValidationResult indicating whether the manifest is valid
 */
const validatePluginManifest = (raw: unknown): ValidationResult => {
  const result = pluginManifestSchema.safeParse(raw);

  if (!result.success) {
    return {
      valid: false,
      errors: zodErrorToValidationErrors(result.error),
    };
  }

  // Zod's output type is structurally compatible with PluginManifest
  return {
    valid: true,
    errors: [],
    manifest: result.data as unknown as PluginManifest,
  };
};

/**
 * Validate a manifest and throw on failure.
 *
 * @param raw - The parsed manifest object
 * @param packageName - The npm package name (for error messages)
 * @returns The validated PluginManifest
 * @throws Error with all validation errors concatenated
 */
const validateOrThrow = (raw: unknown, packageName: string): PluginManifest => {
  const result = validatePluginManifest(raw);
  if (!result.valid) {
    const errorList = result.errors.map(e => `  - ${e.path ? `${e.path}: ` : ''}${e.message}`).join('\n');
    throw new Error(`Invalid plugin manifest in "${packageName}":\n${errorList}`);
  }
  return result.manifest!;
};

/**
 * Check for naming conflicts between a set of plugin manifests.
 *
 * @param manifests - Array of validated manifests to check
 * @returns Array of conflict errors (empty if no conflicts)
 */
const checkNameConflicts = (manifests: readonly PluginManifest[]): readonly ValidationError[] => {
  const errors: ValidationError[] = [];
  const seen = new Map<string, string>(); // name → first display name that claimed it

  for (const manifest of manifests) {
    const existing = seen.get(manifest.name);
    if (existing) {
      errors.push({
        path: 'name',
        message: `Plugin name "${manifest.name}" is already claimed by "${existing}". Each plugin must have a unique name.`,
      });
    } else {
      seen.set(manifest.name, manifest.displayName);
    }
  }

  return errors;
};

// -----------------------------------------------------------------------------
// URL Pattern Overlap Detection
//
// Two plugins whose URL patterns overlap could both be injected into the same
// page, leading to adapter registration conflicts (one overwrites the other on
// window.__openTabs.adapters). This function detects overlaps and returns
// warnings so the platform can alert the user.
// -----------------------------------------------------------------------------

/**
 * Extract the host portion from a Chrome match pattern.
 * E.g. "*://*.slack.com/*" → "*.slack.com"
 *      "*://app.example.com/*" → "app.example.com"
 * Returns undefined for patterns that can't be parsed.
 */
const extractHostFromPattern = (pattern: string): string | undefined => {
  // Chrome match pattern format: <scheme>://<host>/<path>
  const match = pattern.match(/^(?:\*|https?):\/\/([^/]+)\/.*/);
  return match?.[1];
};

/**
 * Check whether two host patterns could match the same hostname.
 *
 * Rules:
 * - "*.example.com" overlaps with "*.example.com" (identical)
 * - "*.example.com" overlaps with "sub.example.com" (wildcard covers exact)
 * - "app.example.com" overlaps with "app.example.com" (identical)
 * - "*.example.com" overlaps with "*.sub.example.com" (parent wildcard covers child)
 * - "*.slack.com" does NOT overlap with "*.jira.com" (different base domains)
 */
const hostsOverlap = (hostA: string, hostB: string): boolean => {
  if (hostA === hostB) return true;

  // Normalize: "*.example.com" → suffix ".example.com"
  const suffixA = hostA.startsWith('*.') ? hostA.slice(1) : null;
  const suffixB = hostB.startsWith('*.') ? hostB.slice(1) : null;

  // Both wildcards: check if one suffix contains the other
  if (suffixA && suffixB) {
    return suffixA.endsWith(suffixB) || suffixB.endsWith(suffixA);
  }

  // One wildcard, one exact: check if exact host falls under the wildcard
  if (suffixA) {
    return hostB.endsWith(suffixA) || hostB === suffixA.slice(1);
  }
  if (suffixB) {
    return hostA.endsWith(suffixB) || hostA === suffixB.slice(1);
  }

  // Both exact — already handled by the identity check above
  return false;
};

/**
 * Check for URL pattern overlaps between plugin manifests.
 *
 * Two plugins whose URL patterns overlap could both be injected into the same
 * page, causing adapter registration conflicts. Returns warnings (not errors)
 * because some overlaps may be intentional in advanced setups.
 *
 * @param manifests - Array of validated manifests to check
 * @returns Array of overlap warnings (empty if no overlaps)
 */
const checkUrlPatternOverlaps = (manifests: readonly PluginManifest[]): readonly ValidationError[] => {
  const warnings: ValidationError[] = [];

  // Collect all hosts per plugin
  const pluginHosts = manifests.map(manifest => {
    const hosts: string[] = [];
    for (const patterns of Object.values(manifest.adapter.urlPatterns)) {
      for (const pattern of patterns) {
        const host = extractHostFromPattern(pattern);
        if (host) hosts.push(host);
      }
    }
    return { name: manifest.name, displayName: manifest.displayName, hosts };
  });

  // Compare every pair of plugins
  for (let i = 0; i < pluginHosts.length; i++) {
    for (let j = i + 1; j < pluginHosts.length; j++) {
      const a = pluginHosts[i]!;
      const b = pluginHosts[j]!;

      for (const hostA of a.hosts) {
        for (const hostB of b.hosts) {
          if (hostsOverlap(hostA, hostB)) {
            warnings.push({
              path: 'adapter.urlPatterns',
              message:
                `URL pattern overlap: plugin "${a.name}" (host: ${hostA}) and ` +
                `plugin "${b.name}" (host: ${hostB}) may match the same pages. ` +
                `This could cause adapter registration conflicts.`,
            });
          }
        }
      }
    }
  }

  return warnings;
};

// -----------------------------------------------------------------------------
// JSON Schema Generation
//
// Generates a JSON Schema from the Zod schema for IDE support. Plugin authors
// who use JSON manifests (opentabs-plugin.json) can reference this schema via
// the "$schema" field for autocompletion and inline validation in VS Code,
// WebStorm, and other editors that support JSON Schema.
//
// The generated schema covers structural validation (field types, required
// fields, patterns, enumerations) but NOT cross-field consistency checks
// (those are enforced by the Zod superRefine at runtime).
// -----------------------------------------------------------------------------

/**
 * Generate a JSON Schema object from the raw manifest Zod schema.
 *
 * Uses the raw (pre-superRefine) schema because JSON Schema cannot express
 * cross-field validation rules. The generated schema covers:
 * - Required and optional fields
 * - String patterns (plugin name, semver, URL match patterns)
 * - Enumerated values (environments, setting types, native APIs)
 * - Nested object structure (adapter, service, tools, permissions)
 * - Array item types
 *
 * Cross-field validation (environment↔domain consistency, health check method
 * prefix, network permission coverage) is handled at runtime by the Zod
 * superRefine layer and cannot be expressed in JSON Schema.
 *
 * @returns A JSON Schema object suitable for writing to a .json file or
 *   serving via HTTP for `$schema` references
 *
 * @example
 * ```ts
 * import { generateJsonSchema } from '@opentabs/plugin-loader/manifest-schema';
 * import { writeFileSync } from 'node:fs';
 *
 * const schema = generateJsonSchema();
 * writeFileSync('plugin-v1.schema.json', JSON.stringify(schema, null, 2));
 * ```
 */
const generateJsonSchema = (): Record<string, unknown> => ({
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://opentabs.dev/schemas/plugin-v1.json',
  title: 'OpenTabs Plugin Manifest',
  description:
    'Manifest schema for OpenTabs plugins. Declares the plugin identity, ' +
    'adapter injection targets, service lifecycle configuration, MCP tool ' +
    'entry points, and permission requirements.',
  type: 'object',
  required: ['name', 'displayName', 'version', 'description', 'adapter', 'service', 'tools', 'permissions'],
  properties: {
    $schema: {
      type: 'string',
      description: 'JSON Schema reference for IDE support.',
    },
    name: {
      type: 'string',
      pattern: PLUGIN_NAME_REGEX.source,
      description:
        'Unique plugin identifier. Lowercase alphanumeric with hyphens, ' +
        'starting with a letter. Used as JSON-RPC method prefix and adapter name. ' +
        `Must not be one of: ${RESERVED_PLUGIN_NAMES.join(', ')}.`,
    },
    displayName: {
      type: 'string',
      minLength: 1,
      description: 'Human-readable display name shown in the UI.',
    },
    version: {
      type: 'string',
      pattern: SEMVER_REGEX.source,
      description: 'Plugin version following semver (e.g. "1.2.3").',
    },
    description: {
      type: 'string',
      minLength: 1,
      description: 'Short description of what the plugin does.',
    },
    author: { type: 'string', description: 'Plugin author name or organization.' },
    homepage: { type: 'string', description: 'URL to the plugin homepage or repository.' },
    license: { type: 'string', description: 'SPDX license identifier (e.g. "MIT").' },
    adapter: {
      type: 'object',
      required: ['entry', 'domains', 'urlPatterns'],
      description: 'Adapter configuration — how the plugin injects into web pages.',
      properties: {
        entry: {
          type: 'string',
          description: 'Relative path to the compiled adapter IIFE (e.g. "./dist/adapter.js").',
        },
        domains: {
          type: 'object',
          description:
            'Domain strings keyed by environment. Leading dot means any subdomain ' +
            '(e.g. ".slack.com" matches "brex.slack.com").',
          additionalProperties: { type: 'string' },
        },
        urlPatterns: {
          type: 'object',
          description: 'Chrome match patterns keyed by environment (e.g. { production: ["*://*.slack.com/*"] }).',
          additionalProperties: {
            type: 'array',
            items: {
              type: 'string',
              pattern: URL_MATCH_PATTERN_REGEX.source,
            },
          },
        },
        hostPermissions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Explicit host permission patterns for the extension manifest.',
        },
        defaultUrl: {
          type: 'string',
          description: 'Canonical URL for UI links. Needed when domain has a leading dot.',
        },
      },
    },
    service: {
      type: 'object',
      required: ['timeout', 'environments', 'authErrorPatterns', 'healthCheck'],
      description: 'Service lifecycle configuration.',
      properties: {
        timeout: {
          type: 'number',
          minimum: 1000,
          maximum: 300000,
          description: 'Request timeout in milliseconds (1000–300000).',
        },
        environments: {
          type: 'array',
          items: { type: 'string', enum: [...VALID_ENVIRONMENTS] },
          minItems: 1,
          description: 'Environments this service supports (e.g. ["production"]).',
        },
        authErrorPatterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Substrings in errors that indicate an expired session.',
        },
        healthCheck: {
          type: 'object',
          required: ['method', 'params'],
          description: 'Health check JSON-RPC request configuration.',
          properties: {
            method: {
              type: 'string',
              description: 'JSON-RPC method (must be prefixed with plugin name, e.g. "slack.api").',
            },
            params: {
              type: 'object',
              description: 'JSON-RPC params for the health check request.',
              additionalProperties: true,
            },
            evaluator: {
              type: 'string',
              description: 'Custom health evaluator name. Omit for default (!isJsonRpcError).',
            },
          },
        },
        notConnectedMessage: { type: 'string', description: 'Custom "not connected" error message.' },
        tabNotFoundMessage: { type: 'string', description: 'Custom "tab not found" error message.' },
      },
    },
    tools: {
      type: 'object',
      required: ['entry'],
      description: 'MCP tool configuration.',
      properties: {
        entry: {
          type: 'string',
          description: 'Relative path to the compiled tools entry module (e.g. "./dist/tools/index.js").',
        },
        categories: {
          type: 'array',
          description: 'Tool categories for the options page UI.',
          items: {
            type: 'object',
            required: ['id', 'label'],
            properties: {
              id: { type: 'string', description: 'Category identifier.' },
              label: { type: 'string', description: 'Human-readable category label.' },
              tools: {
                type: 'array',
                items: { type: 'string' },
                description: 'Tool IDs in this category.',
              },
            },
          },
        },
      },
    },
    permissions: {
      type: 'object',
      required: ['network'],
      description: 'Permission declarations.',
      properties: {
        network: {
          type: 'array',
          items: { type: 'string' },
          description: 'Network domains the adapter may access. Supports wildcards (e.g. "*.example.com").',
        },
        storage: {
          type: 'boolean',
          default: false,
          description: 'Whether the adapter needs localStorage/sessionStorage access.',
        },
        nativeApis: {
          type: 'array',
          items: { type: 'string', enum: [...VALID_NATIVE_APIS] },
          description: 'Platform-native API access (e.g. "browser" for tab tools).',
        },
      },
    },
    settings: {
      type: 'object',
      description: 'User-configurable settings schema.',
      additionalProperties: {
        type: 'object',
        required: ['type', 'label'],
        properties: {
          type: { type: 'string', enum: [...VALID_SETTING_TYPES] },
          label: { type: 'string' },
          description: { type: 'string' },
          default: {},
          min: { type: 'number' },
          max: { type: 'number' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              required: ['value', 'label'],
              properties: {
                value: { type: 'string' },
                label: { type: 'string' },
              },
            },
          },
          placeholder: { type: 'string' },
        },
      },
    },
    icon: {
      type: 'string',
      description: 'Relative path to the plugin icon (PNG, 48x48 recommended).',
    },
    keywords: {
      type: 'array',
      items: { type: 'string' },
      description: 'Keywords for plugin registry discovery.',
    },
  },
  additionalProperties: false,
});

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

export {
  pluginManifestSchema,
  rawManifestSchema,
  pluginNameSchema,
  validatePluginManifest,
  validateOrThrow,
  checkNameConflicts,
  checkUrlPatternOverlaps,
  zodErrorToValidationErrors,
  generateJsonSchema,
};

export type { ValidationError, ValidationResult };
