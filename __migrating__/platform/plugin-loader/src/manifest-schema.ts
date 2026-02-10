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
  params: z.record(z.unknown()),
  evaluator: z.string().min(1).optional(),
});

const adapterConfigSchema = z.object({
  entry: z.string().min(1, 'Adapter entry must be a relative path to the compiled adapter (e.g. "./dist/adapter.js")'),
  domains: z.record(z.string().min(1, 'Domain must be a non-empty string')),
  urlPatterns: z.record(z.array(urlMatchPatternSchema).min(1, 'Each environment must have at least one URL pattern')),
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
  settings: z.record(settingDefinitionSchema).optional(),
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
// Exports
// -----------------------------------------------------------------------------

export {
  pluginManifestSchema,
  rawManifestSchema,
  pluginNameSchema,
  validatePluginManifest,
  validateOrThrow,
  checkNameConflicts,
  zodErrorToValidationErrors,
};

export type { ValidationError, ValidationResult };
