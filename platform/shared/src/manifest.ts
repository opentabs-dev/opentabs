/**
 * Plugin package.json manifest types and validation.
 *
 * Defines the PluginPackageJson interface representing a plugin's package.json
 * with an `opentabs` field for plugin metadata. The parsePluginPackageJson
 * function validates a raw JSON object and returns a typed Result.
 */

import type { Result } from './result.js';
import { err, ok } from './result.js';

/** Allowed types for a config setting field */
type ConfigSettingType = 'url' | 'string' | 'number' | 'boolean' | 'select';

/** A single field definition within a plugin's configSchema */
interface ConfigSettingDefinition {
  readonly type: ConfigSettingType;
  readonly label: string;
  readonly description?: string;
  readonly required?: boolean;
  readonly placeholder?: string;
  /** Valid choices for select-type settings */
  readonly options?: readonly string[];
}

/** A plugin's full configuration schema — keys are setting names */
type ConfigSchema = Record<string, ConfigSettingDefinition>;

const VALID_SETTING_TYPES = new Set<string>(['url', 'string', 'number', 'boolean', 'select']);

/** Plugin-specific metadata in the `opentabs` field of package.json */
interface PluginOpentabsField {
  readonly displayName: string;
  readonly description: string;
  readonly urlPatterns: string[];
  readonly excludePatterns?: string[];
  readonly homepage?: string;
  readonly configSchema?: ConfigSchema;
  /**
   * Optional path to a TypeScript source file that runs at `document_start`
   * in MAIN world before any page script. Relative to the plugin root
   * (e.g., "src/pre-script.ts"). When declared, `opentabs-plugin build`
   * bundles it separately and emits `dist/pre-script.iife.js`.
   */
  readonly preScript?: string;
}

/** A plugin's package.json with the required `opentabs` field */
interface PluginPackageJson {
  readonly name: string;
  readonly version: string;
  readonly main: string;
  readonly opentabs: PluginOpentabsField;
}

/**
 * Validate that a package name matches the opentabs plugin naming convention.
 *
 * Accepts `opentabs-plugin-<name>` (unscoped) and `@scope/opentabs-plugin-<name>` (scoped).
 * The name portion after the prefix must be non-empty.
 */
const isValidPluginPackageName = (name: string): boolean => {
  if (name.startsWith('@')) {
    return /^@[^/]+\/opentabs-plugin-.+$/.test(name);
  }
  return name.startsWith('opentabs-plugin-') && name.length > 'opentabs-plugin-'.length;
};

/**
 * Parse and validate a raw JSON object as a PluginPackageJson.
 *
 * Checks that the object has a valid plugin package name, a version string,
 * a main entry point, and an opentabs field with the required metadata.
 * Returns a Result with the validated PluginPackageJson or a descriptive error.
 */
const parsePluginPackageJson = (json: unknown, sourcePath: string): Result<PluginPackageJson, string> => {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return err(`Invalid package.json at ${sourcePath}: expected an object`);
  }

  const obj = json as Record<string, unknown>;

  // Validate name
  const name = obj.name;
  if (typeof name !== 'string' || name.length === 0) {
    return err(`Invalid package.json at ${sourcePath}: "name" must be a non-empty string`);
  }
  if (!isValidPluginPackageName(name)) {
    return err(
      `Invalid plugin package name "${name}" at ${sourcePath}: must start with "opentabs-plugin-" or be a scoped package like "@org/opentabs-plugin-foo"`,
    );
  }

  // Validate version
  const version = obj.version;
  if (typeof version !== 'string' || version.length === 0) {
    return err(`Invalid package.json at ${sourcePath}: "version" must be a non-empty string`);
  }

  // Validate main
  const main = obj.main;
  if (typeof main !== 'string' || main.length === 0) {
    return err(`Invalid package.json at ${sourcePath}: "main" must be a non-empty string`);
  }

  // Validate opentabs field
  const opentabs = obj.opentabs;
  if (typeof opentabs !== 'object' || opentabs === null || Array.isArray(opentabs)) {
    return err(`Invalid package.json at ${sourcePath}: "opentabs" field is required and must be an object`);
  }

  const ot = opentabs as Record<string, unknown>;

  const displayName = ot.displayName;
  if (typeof displayName !== 'string' || displayName.length === 0) {
    return err(`Invalid package.json at ${sourcePath}: "opentabs.displayName" must be a non-empty string`);
  }

  const description = ot.description;
  if (typeof description !== 'string' || description.length === 0) {
    return err(`Invalid package.json at ${sourcePath}: "opentabs.description" must be a non-empty string`);
  }

  // Parse configSchema (optional, but must be parsed before urlPatterns to enable relaxation)
  const rawConfigSchema = ot.configSchema;
  let parsedConfigSchema: ConfigSchema | undefined;
  if (rawConfigSchema !== undefined) {
    if (typeof rawConfigSchema !== 'object' || rawConfigSchema === null || Array.isArray(rawConfigSchema)) {
      return err(`Invalid package.json at ${sourcePath}: "opentabs.configSchema" must be an object`);
    }
    const cs = rawConfigSchema as Record<string, unknown>;
    const validated: Record<string, ConfigSettingDefinition> = {};
    for (const [key, value] of Object.entries(cs)) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return err(`Invalid package.json at ${sourcePath}: "opentabs.configSchema.${key}" must be an object`);
      }
      const field = value as Record<string, unknown>;
      if (typeof field.type !== 'string' || !VALID_SETTING_TYPES.has(field.type)) {
        return err(
          `Invalid package.json at ${sourcePath}: "opentabs.configSchema.${key}.type" must be one of: url, string, number, boolean, select`,
        );
      }
      if (typeof field.label !== 'string' || field.label.length === 0) {
        return err(
          `Invalid package.json at ${sourcePath}: "opentabs.configSchema.${key}.label" must be a non-empty string`,
        );
      }
      if (field.description !== undefined && typeof field.description !== 'string') {
        return err(
          `Invalid package.json at ${sourcePath}: "opentabs.configSchema.${key}.description" must be a string`,
        );
      }
      if (field.required !== undefined && typeof field.required !== 'boolean') {
        return err(`Invalid package.json at ${sourcePath}: "opentabs.configSchema.${key}.required" must be a boolean`);
      }
      if (field.placeholder !== undefined && typeof field.placeholder !== 'string') {
        return err(
          `Invalid package.json at ${sourcePath}: "opentabs.configSchema.${key}.placeholder" must be a string`,
        );
      }
      if (field.options !== undefined) {
        if (!Array.isArray(field.options) || field.options.length === 0) {
          return err(
            `Invalid package.json at ${sourcePath}: "opentabs.configSchema.${key}.options" must be a non-empty array of strings`,
          );
        }
        for (let i = 0; i < field.options.length; i++) {
          if (typeof field.options[i] !== 'string') {
            return err(
              `Invalid package.json at ${sourcePath}: "opentabs.configSchema.${key}.options[${i}]" must be a string`,
            );
          }
        }
      }
      validated[key] = {
        type: field.type as ConfigSettingType,
        label: field.label,
        ...(field.description !== undefined ? { description: field.description as string } : {}),
        ...(field.required !== undefined ? { required: field.required as boolean } : {}),
        ...(field.placeholder !== undefined ? { placeholder: field.placeholder as string } : {}),
        ...(field.options !== undefined ? { options: field.options as string[] } : {}),
      };
    }
    parsedConfigSchema = validated;
  }

  // Check if configSchema has at least one required url-type field (allows empty urlPatterns)
  const hasRequiredUrlSetting =
    parsedConfigSchema !== undefined &&
    Object.values(parsedConfigSchema).some(f => f.type === 'url' && f.required === true);

  const urlPatterns = ot.urlPatterns;
  if (!Array.isArray(urlPatterns) || (!hasRequiredUrlSetting && urlPatterns.length === 0)) {
    return err(`Invalid package.json at ${sourcePath}: "opentabs.urlPatterns" must be a non-empty array of strings`);
  }
  for (let i = 0; i < urlPatterns.length; i++) {
    if (typeof urlPatterns[i] !== 'string') {
      return err(`Invalid package.json at ${sourcePath}: "opentabs.urlPatterns[${i}]" must be a string`);
    }
  }

  // Parse excludePatterns (optional)
  const excludePatterns = ot.excludePatterns;
  let parsedExcludePatterns: string[] | undefined;
  if (excludePatterns !== undefined) {
    if (!Array.isArray(excludePatterns)) {
      return err(`Invalid package.json at ${sourcePath}: "opentabs.excludePatterns" must be an array of strings`);
    }
    for (let i = 0; i < excludePatterns.length; i++) {
      if (typeof excludePatterns[i] !== 'string') {
        return err(`Invalid package.json at ${sourcePath}: "opentabs.excludePatterns[${i}]" must be a string`);
      }
    }
    parsedExcludePatterns = excludePatterns as string[];
  }

  // Parse homepage (optional)
  const homepage = ot.homepage;
  let parsedHomepage: string | undefined;
  if (homepage !== undefined) {
    if (typeof homepage !== 'string' || homepage.length === 0) {
      return err(`Invalid package.json at ${sourcePath}: "opentabs.homepage" must be a non-empty string`);
    }
    parsedHomepage = homepage;
  }

  // Parse preScript (optional) — relative path to a .ts file
  const preScript = ot.preScript;
  let parsedPreScript: string | undefined;
  if (preScript !== undefined) {
    if (typeof preScript !== 'string' || preScript.length === 0) {
      return err(`Invalid package.json at ${sourcePath}: "opentabs.preScript" must be a non-empty string path`);
    }
    parsedPreScript = preScript;
  }

  return ok({
    name,
    version,
    main,
    opentabs: {
      displayName,
      description,
      urlPatterns: urlPatterns as string[],
      ...(parsedExcludePatterns ? { excludePatterns: parsedExcludePatterns } : {}),
      ...(parsedHomepage ? { homepage: parsedHomepage } : {}),
      ...(parsedConfigSchema ? { configSchema: parsedConfigSchema } : {}),
      ...(parsedPreScript ? { preScript: parsedPreScript } : {}),
    },
  });
};

export type { ConfigSchema, ConfigSettingDefinition, ConfigSettingType, PluginOpentabsField, PluginPackageJson };
export { isValidPluginPackageName, parsePluginPackageJson };
