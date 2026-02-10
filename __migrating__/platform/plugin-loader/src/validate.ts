// =============================================================================
// Plugin Manifest Validation
//
// Validates opentabs-plugin.json manifests against the platform's requirements.
// Called during plugin discovery (build time) and plugin loading (runtime).
//
// Validation is intentionally strict — a malformed manifest is rejected early
// rather than causing cryptic failures later in the adapter injection or tool
// registration pipeline.
// =============================================================================

import {
  RESERVED_PLUGIN_NAMES,
  checkReservedName,
} from '@opentabs/core';

import type {
  PluginManifest,
  PluginAdapterConfig,
  PluginServiceConfig,
  PluginToolsConfig,
  PluginPermissions,
  PluginHealthCheckConfig,
  PluginSettingDefinition,
  PluginToolCategory,
} from '@opentabs/core';

// -----------------------------------------------------------------------------
// Validation Result
// -----------------------------------------------------------------------------

/** A single validation error with a JSONPath-like location and message. */
export interface ValidationError {
  /** Dot-delimited path to the invalid field (e.g. 'adapter.urlPatterns.production'). */
  readonly path: string;
  /** Human-readable description of what's wrong. */
  readonly message: string;
}

/** The result of validating a plugin manifest. */
export interface ValidationResult {
  /** Whether the manifest passed all checks. */
  readonly valid: boolean;
  /** List of validation errors (empty when valid). */
  readonly errors: readonly ValidationError[];
  /** The validated manifest (only present when valid). */
  readonly manifest?: PluginManifest;
}

// -----------------------------------------------------------------------------
// Name Pattern
// -----------------------------------------------------------------------------

/**
 * Plugin names must be lowercase alphanumeric with hyphens.
 * Must start with a letter. No underscores, dots, or uppercase.
 */
const PLUGIN_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Semver pattern (simplified — allows major.minor.patch with optional pre-release).
 */
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;

/**
 * Chrome extension URL match pattern.
 * Must start with a scheme (*://, http://, https://) and contain a path.
 */
const URL_PATTERN_REGEX = /^(\*|https?):\/\/.+\/.*/;

// -----------------------------------------------------------------------------
// Validation Helpers
// -----------------------------------------------------------------------------

type ErrorCollector = ValidationError[];

const addError = (
  errors: ErrorCollector,
  path: string,
  message: string,
): void => {
  errors.push({ path, message });
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string');

const isReadonlyStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string');

// -----------------------------------------------------------------------------
// Section Validators
// -----------------------------------------------------------------------------

const validateName = (
  errors: ErrorCollector,
  name: unknown,
): name is string => {
  if (!isNonEmptyString(name)) {
    addError(errors, 'name', 'Must be a non-empty string');
    return false;
  }

  if (!PLUGIN_NAME_PATTERN.test(name)) {
    addError(
      errors,
      'name',
      `Must match pattern ${PLUGIN_NAME_PATTERN.toString()} (lowercase alphanumeric with hyphens, starting with a letter). Got: "${name}"`,
    );
    return false;
  }

  const reserved = checkReservedName(name);
  if (reserved) {
    addError(
      errors,
      'name',
      `"${name}" is a reserved platform name. Reserved names: ${RESERVED_PLUGIN_NAMES.join(', ')}`,
    );
    return false;
  }

  return true;
};

const validateVersion = (
  errors: ErrorCollector,
  version: unknown,
): version is string => {
  if (!isNonEmptyString(version)) {
    addError(errors, 'version', 'Must be a non-empty string');
    return false;
  }

  if (!SEMVER_PATTERN.test(version)) {
    addError(
      errors,
      'version',
      `Must be a valid semver string (e.g. "1.0.0"). Got: "${version}"`,
    );
    return false;
  }

  return true;
};

const validateUrlPatterns = (
  errors: ErrorCollector,
  path: string,
  patterns: unknown,
  environments: readonly string[],
): boolean => {
  if (!isPlainObject(patterns)) {
    addError(errors, path, 'Must be an object keyed by environment');
    return false;
  }

  let valid = true;

  for (const env of environments) {
    const envPatterns = patterns[env];
    if (!envPatterns) {
      addError(errors, `${path}.${env}`, `Missing URL patterns for environment "${env}"`);
      valid = false;
      continue;
    }

    if (!isReadonlyStringArray(envPatterns)) {
      addError(errors, `${path}.${env}`, 'Must be an array of URL pattern strings');
      valid = false;
      continue;
    }

    if (envPatterns.length === 0) {
      addError(errors, `${path}.${env}`, 'Must contain at least one URL pattern');
      valid = false;
      continue;
    }

    for (let i = 0; i < envPatterns.length; i++) {
      const pattern = envPatterns[i]!;
      if (!URL_PATTERN_REGEX.test(pattern)) {
        addError(
          errors,
          `${path}.${env}[${i}]`,
          `Invalid URL match pattern: "${pattern}". Must match Chrome's match pattern syntax (e.g. "*://*.example.com/*")`,
        );
        valid = false;
      }

      // Reject overly broad patterns that match all URLs
      if (pattern === '*://*/*' || pattern === '<all_urls>') {
        addError(
          errors,
          `${path}.${env}[${i}]`,
          `Overly broad URL pattern: "${pattern}". Plugins must scope to specific domains.`,
        );
        valid = false;
      }
    }
  }

  return valid;
};

const validateDomains = (
  errors: ErrorCollector,
  path: string,
  domains: unknown,
  environments: readonly string[],
): boolean => {
  if (!isPlainObject(domains)) {
    addError(errors, path, 'Must be an object keyed by environment');
    return false;
  }

  let valid = true;

  for (const env of environments) {
    const domain = domains[env];
    if (!isNonEmptyString(domain)) {
      addError(errors, `${path}.${env}`, `Missing or invalid domain string for environment "${env}"`);
      valid = false;
    }
  }

  return valid;
};

const validateAdapterConfig = (
  errors: ErrorCollector,
  adapter: unknown,
  environments: readonly string[],
): adapter is PluginAdapterConfig => {
  if (!isPlainObject(adapter)) {
    addError(errors, 'adapter', 'Must be an object');
    return false;
  }

  let valid = true;

  // entry
  if (!isNonEmptyString(adapter.entry)) {
    addError(errors, 'adapter.entry', 'Must be a non-empty string (relative path to adapter entry)');
    valid = false;
  }

  // domains
  if (!validateDomains(errors, 'adapter.domains', adapter.domains, environments)) {
    valid = false;
  }

  // urlPatterns
  if (!validateUrlPatterns(errors, 'adapter.urlPatterns', adapter.urlPatterns, environments)) {
    valid = false;
  }

  // hostPermissions (optional)
  if (adapter.hostPermissions !== undefined && adapter.hostPermissions !== null) {
    if (!isReadonlyStringArray(adapter.hostPermissions)) {
      addError(errors, 'adapter.hostPermissions', 'Must be an array of strings when provided');
      valid = false;
    }
  }

  // defaultUrl (optional)
  if (adapter.defaultUrl !== undefined && adapter.defaultUrl !== null) {
    if (!isNonEmptyString(adapter.defaultUrl)) {
      addError(errors, 'adapter.defaultUrl', 'Must be a non-empty string when provided');
      valid = false;
    }
  }

  return valid;
};

const validateHealthCheck = (
  errors: ErrorCollector,
  healthCheck: unknown,
): healthCheck is PluginHealthCheckConfig => {
  if (!isPlainObject(healthCheck)) {
    addError(errors, 'service.healthCheck', 'Must be an object');
    return false;
  }

  let valid = true;

  if (!isNonEmptyString(healthCheck.method)) {
    addError(errors, 'service.healthCheck.method', 'Must be a non-empty string (e.g. "slack.api")');
    valid = false;
  }

  if (!isPlainObject(healthCheck.params)) {
    addError(errors, 'service.healthCheck.params', 'Must be an object');
    valid = false;
  }

  // evaluator (optional)
  if (healthCheck.evaluator !== undefined && healthCheck.evaluator !== null) {
    if (!isNonEmptyString(healthCheck.evaluator)) {
      addError(errors, 'service.healthCheck.evaluator', 'Must be a non-empty string when provided');
      valid = false;
    }
  }

  return valid;
};

const VALID_ENVIRONMENTS = new Set(['production', 'staging']);

const validateServiceConfig = (
  errors: ErrorCollector,
  service: unknown,
): service is PluginServiceConfig => {
  if (!isPlainObject(service)) {
    addError(errors, 'service', 'Must be an object');
    return false;
  }

  let valid = true;

  // timeout
  if (typeof service.timeout !== 'number' || service.timeout <= 0) {
    addError(errors, 'service.timeout', 'Must be a positive number (milliseconds)');
    valid = false;
  } else if (service.timeout > 600000) {
    addError(errors, 'service.timeout', 'Must not exceed 600000ms (10 minutes)');
    valid = false;
  }

  // environments
  if (!isReadonlyStringArray(service.environments) || service.environments.length === 0) {
    addError(errors, 'service.environments', 'Must be a non-empty array of environment strings ("production", "staging")');
    valid = false;
  } else {
    for (let i = 0; i < service.environments.length; i++) {
      const env = service.environments[i]!;
      if (!VALID_ENVIRONMENTS.has(env)) {
        addError(
          errors,
          `service.environments[${i}]`,
          `Invalid environment: "${env}". Must be "production" or "staging".`,
        );
        valid = false;
      }
    }
  }

  // authErrorPatterns
  if (!isReadonlyStringArray(service.authErrorPatterns)) {
    addError(errors, 'service.authErrorPatterns', 'Must be an array of strings');
    valid = false;
  }

  // healthCheck
  if (!validateHealthCheck(errors, service.healthCheck)) {
    valid = false;
  }

  // notConnectedMessage (optional)
  if (service.notConnectedMessage !== undefined && service.notConnectedMessage !== null) {
    if (typeof service.notConnectedMessage !== 'string') {
      addError(errors, 'service.notConnectedMessage', 'Must be a string when provided');
      valid = false;
    }
  }

  // tabNotFoundMessage (optional)
  if (service.tabNotFoundMessage !== undefined && service.tabNotFoundMessage !== null) {
    if (typeof service.tabNotFoundMessage !== 'string') {
      addError(errors, 'service.tabNotFoundMessage', 'Must be a string when provided');
      valid = false;
    }
  }

  return valid;
};

const validateToolsConfig = (
  errors: ErrorCollector,
  tools: unknown,
): tools is PluginToolsConfig => {
  if (!isPlainObject(tools)) {
    addError(errors, 'tools', 'Must be an object');
    return false;
  }

  let valid = true;

  if (!isNonEmptyString(tools.entry)) {
    addError(errors, 'tools.entry', 'Must be a non-empty string (relative path to tools entry module)');
    valid = false;
  }

  // categories (optional)
  if (tools.categories !== undefined && tools.categories !== null) {
    if (!Array.isArray(tools.categories)) {
      addError(errors, 'tools.categories', 'Must be an array when provided');
      valid = false;
    } else {
      for (let i = 0; i < tools.categories.length; i++) {
        const cat = tools.categories[i] as unknown;
        if (!isPlainObject(cat)) {
          addError(errors, `tools.categories[${i}]`, 'Must be an object');
          valid = false;
          continue;
        }

        if (!isNonEmptyString(cat.id)) {
          addError(errors, `tools.categories[${i}].id`, 'Must be a non-empty string');
          valid = false;
        }

        if (!isNonEmptyString(cat.label)) {
          addError(errors, `tools.categories[${i}].label`, 'Must be a non-empty string');
          valid = false;
        }

        // tools (optional array of tool IDs)
        if (cat.tools !== undefined && cat.tools !== null) {
          if (!isReadonlyStringArray(cat.tools)) {
            addError(errors, `tools.categories[${i}].tools`, 'Must be an array of strings when provided');
            valid = false;
          }
        }
      }
    }
  }

  return valid;
};

const VALID_NATIVE_APIS = new Set(['browser', 'files']);

const validatePermissions = (
  errors: ErrorCollector,
  permissions: unknown,
): permissions is PluginPermissions => {
  if (!isPlainObject(permissions)) {
    addError(errors, 'permissions', 'Must be an object');
    return false;
  }

  let valid = true;

  // network
  if (!isReadonlyStringArray(permissions.network)) {
    addError(errors, 'permissions.network', 'Must be an array of domain strings');
    valid = false;
  } else {
    for (let i = 0; i < permissions.network.length; i++) {
      const domain = permissions.network[i]!;
      if (domain.length === 0) {
        addError(errors, `permissions.network[${i}]`, 'Must be a non-empty string');
        valid = false;
      }
      // Reject overly broad network permissions
      if (domain === '*' || domain === '*.*') {
        addError(
          errors,
          `permissions.network[${i}]`,
          `Overly broad network permission: "${domain}". Plugins must scope to specific domains.`,
        );
        valid = false;
      }
    }
  }

  // storage (optional boolean)
  if (permissions.storage !== undefined && permissions.storage !== null) {
    if (typeof permissions.storage !== 'boolean') {
      addError(errors, 'permissions.storage', 'Must be a boolean when provided');
      valid = false;
    }
  }

  // nativeApis (optional)
  if (permissions.nativeApis !== undefined && permissions.nativeApis !== null) {
    if (!isReadonlyStringArray(permissions.nativeApis)) {
      addError(errors, 'permissions.nativeApis', 'Must be an array of strings when provided');
      valid = false;
    } else {
      for (let i = 0; i < permissions.nativeApis.length; i++) {
        const api = permissions.nativeApis[i]!;
        if (!VALID_NATIVE_APIS.has(api)) {
          addError(
            errors,
            `permissions.nativeApis[${i}]`,
            `Unknown native API: "${api}". Valid values: ${[...VALID_NATIVE_APIS].join(', ')}`,
          );
          valid = false;
        }
      }
    }
  }

  return valid;
};

const VALID_SETTING_TYPES = new Set(['string', 'number', 'boolean', 'select']);

const validateSettings = (
  errors: ErrorCollector,
  settings: unknown,
): settings is Record<string, PluginSettingDefinition> => {
  if (!isPlainObject(settings)) {
    addError(errors, 'settings', 'Must be an object when provided');
    return false;
  }

  let valid = true;

  for (const [key, value] of Object.entries(settings)) {
    const path = `settings.${key}`;

    if (!isPlainObject(value)) {
      addError(errors, path, 'Must be an object');
      valid = false;
      continue;
    }

    if (!isNonEmptyString(value.type) || !VALID_SETTING_TYPES.has(value.type)) {
      addError(
        errors,
        `${path}.type`,
        `Must be one of: ${[...VALID_SETTING_TYPES].join(', ')}`,
      );
      valid = false;
    }

    if (!isNonEmptyString(value.label)) {
      addError(errors, `${path}.label`, 'Must be a non-empty string');
      valid = false;
    }

    // Validate select options
    if (value.type === 'select') {
      if (!Array.isArray(value.options) || value.options.length === 0) {
        addError(errors, `${path}.options`, 'Select settings must have a non-empty options array');
        valid = false;
      } else {
        for (let i = 0; i < value.options.length; i++) {
          const opt = value.options[i] as unknown;
          if (!isPlainObject(opt) || !isNonEmptyString(opt.value) || !isNonEmptyString(opt.label)) {
            addError(errors, `${path}.options[${i}]`, 'Must be an object with "value" and "label" strings');
            valid = false;
          }
        }
      }
    }

    // Validate number constraints
    if (value.type === 'number') {
      if (value.min !== undefined && typeof value.min !== 'number') {
        addError(errors, `${path}.min`, 'Must be a number when provided');
        valid = false;
      }
      if (value.max !== undefined && typeof value.max !== 'number') {
        addError(errors, `${path}.max`, 'Must be a number when provided');
        valid = false;
      }
      if (
        typeof value.min === 'number' &&
        typeof value.max === 'number' &&
        value.min > value.max
      ) {
        addError(errors, `${path}.min`, 'min must not exceed max');
        valid = false;
      }
    }
  }

  return valid;
};

// -----------------------------------------------------------------------------
// Cross-Field Validation
//
// Checks that reference fields in the manifest are consistent with each other.
// For example, health check method should use the plugin's own service name.
// -----------------------------------------------------------------------------

const validateCrossFieldConsistency = (
  errors: ErrorCollector,
  manifest: PluginManifest,
): void => {
  // Health check method should be prefixed with the plugin name
  const { name } = manifest;
  const { method } = manifest.service.healthCheck;
  if (!method.startsWith(`${name}.`)) {
    addError(
      errors,
      'service.healthCheck.method',
      `Health check method "${method}" should be prefixed with the plugin name "${name}." (e.g. "${name}.api" or "${name}.healthCheck")`,
    );
  }

  // Adapter domains and permissions.network should be consistent
  const adapterDomainValues = Object.values(manifest.adapter.domains);
  const networkPermissions = manifest.permissions.network;

  for (const domain of adapterDomainValues) {
    // Check that each adapter domain is covered by a network permission
    const isCovered = networkPermissions.some(netDomain => {
      if (netDomain.startsWith('*.')) {
        const suffix = netDomain.slice(1);
        return domain.endsWith(suffix) || domain === netDomain.slice(2);
      }
      if (netDomain.startsWith('.')) {
        return domain.endsWith(netDomain) || domain === netDomain.slice(1);
      }
      return domain === netDomain || domain.endsWith(`.${netDomain}`);
    });

    if (!isCovered) {
      addError(
        errors,
        'permissions.network',
        `Adapter domain "${domain}" is not covered by any network permission. ` +
          `Add a matching entry to permissions.network.`,
      );
    }
  }

  // Environments in service must match environments in adapter
  const serviceEnvs = new Set(manifest.service.environments);
  const adapterDomainEnvs = new Set(Object.keys(manifest.adapter.domains));
  const adapterPatternEnvs = new Set(Object.keys(manifest.adapter.urlPatterns));

  for (const env of serviceEnvs) {
    if (!adapterDomainEnvs.has(env)) {
      addError(
        errors,
        'adapter.domains',
        `Missing domain for environment "${env}" declared in service.environments`,
      );
    }
    if (!adapterPatternEnvs.has(env)) {
      addError(
        errors,
        'adapter.urlPatterns',
        `Missing URL patterns for environment "${env}" declared in service.environments`,
      );
    }
  }
};

// -----------------------------------------------------------------------------
// Main Validation Function
// -----------------------------------------------------------------------------

/**
 * Validate a plugin manifest (parsed from opentabs-plugin.json or a
 * definePlugin() call). Returns a ValidationResult with detailed error
 * messages for every invalid field.
 *
 * @param raw - The parsed manifest object (from JSON.parse or a module import)
 * @returns A ValidationResult indicating whether the manifest is valid
 */
export const validatePluginManifest = (raw: unknown): ValidationResult => {
  const errors: ErrorCollector = [];

  if (!isPlainObject(raw)) {
    return {
      valid: false,
      errors: [{ path: '', message: 'Plugin manifest must be a JSON object' }],
    };
  }

  // Required top-level string fields
  const nameValid = validateName(errors, raw.name);

  if (!isNonEmptyString(raw.displayName)) {
    addError(errors, 'displayName', 'Must be a non-empty string');
  }

  validateVersion(errors, raw.version);

  if (!isNonEmptyString(raw.description)) {
    addError(errors, 'description', 'Must be a non-empty string');
  }

  // Optional top-level string fields
  if (raw.author !== undefined && raw.author !== null && typeof raw.author !== 'string') {
    addError(errors, 'author', 'Must be a string when provided');
  }

  if (raw.homepage !== undefined && raw.homepage !== null && typeof raw.homepage !== 'string') {
    addError(errors, 'homepage', 'Must be a string when provided');
  }

  if (raw.license !== undefined && raw.license !== null && typeof raw.license !== 'string') {
    addError(errors, 'license', 'Must be a string when provided');
  }

  // Determine environments early — needed by adapter validation
  let environments: readonly string[] = ['production'];
  if (
    isPlainObject(raw.service) &&
    isReadonlyStringArray((raw.service as Record<string, unknown>).environments) &&
    ((raw.service as Record<string, unknown>).environments as readonly string[]).length > 0
  ) {
    environments = (raw.service as Record<string, unknown>).environments as readonly string[];
  }

  // Sections
  validateAdapterConfig(errors, raw.adapter, environments);
  validateServiceConfig(errors, raw.service);
  validateToolsConfig(errors, raw.tools);
  validatePermissions(errors, raw.permissions);

  // Optional settings
  if (raw.settings !== undefined && raw.settings !== null) {
    validateSettings(errors, raw.settings);
  }

  // Optional icon
  if (raw.icon !== undefined && raw.icon !== null) {
    if (!isNonEmptyString(raw.icon)) {
      addError(errors, 'icon', 'Must be a non-empty string when provided');
    }
  }

  // Optional keywords
  if (raw.keywords !== undefined && raw.keywords !== null) {
    if (!isReadonlyStringArray(raw.keywords)) {
      addError(errors, 'keywords', 'Must be an array of strings when provided');
    }
  }

  // If basic structure is valid, run cross-field checks
  if (errors.length === 0 && nameValid) {
    validateCrossFieldConsistency(errors, raw as unknown as PluginManifest);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    manifest: raw as unknown as PluginManifest,
  };
};

/**
 * Validate a manifest and throw on failure. Convenience wrapper for contexts
 * where you want an exception rather than a result object.
 *
 * @param raw - The parsed manifest object
 * @param packageName - The npm package name (for error messages)
 * @returns The validated PluginManifest
 * @throws Error with all validation errors concatenated
 */
export const validateOrThrow = (
  raw: unknown,
  packageName: string,
): PluginManifest => {
  const result = validatePluginManifest(raw);
  if (!result.valid) {
    const errorList = result.errors
      .map(e => `  - ${e.path ? `${e.path}: ` : ''}${e.message}`)
      .join('\n');
    throw new Error(
      `Invalid plugin manifest in "${packageName}":\n${errorList}`,
    );
  }
  return result.manifest!;
};

/**
 * Check for naming conflicts between a set of plugin manifests.
 * Returns validation errors for any duplicate plugin names.
 *
 * @param manifests - Array of validated manifests to check
 * @returns Array of conflict errors (empty if no conflicts)
 */
export const checkNameConflicts = (
  manifests: readonly PluginManifest[],
): readonly ValidationError[] => {
  const errors: ValidationError[] = [];
  const seen = new Map<string, string>(); // name → first package that claimed it

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
