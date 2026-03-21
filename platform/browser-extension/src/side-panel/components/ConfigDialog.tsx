import type { ConfigSchema } from '@opentabs-dev/shared';
import { useRef, useState } from 'react';
import { setPluginSettings } from '../bridge.js';
import { Alert } from './retro/Alert.js';
import { Button } from './retro/Button.js';
import { Dialog } from './retro/Dialog.js';
import { Input } from './retro/Input.js';
import { Select } from './retro/Select.js';
import { Switch } from './retro/Switch.js';

interface ConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pluginName: string;
  displayName: string;
  configSchema: ConfigSchema;
  resolvedSettings?: Record<string, unknown>;
}

interface UrlEntry {
  name: string;
  url: string;
}

const isValidUrl = (value: string): boolean => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

/** Parse resolvedSettings for a url field into an array of UrlEntry */
const parseUrlEntries = (value: unknown): UrlEntry[] => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const map = value as Record<string, string>;
    const items = Object.entries(map)
      .filter(([, v]) => typeof v === 'string')
      .map(([name, url]) => ({ name, url }));
    if (items.length > 0) return items;
  }
  return [{ name: '', url: '' }];
};

/** Build initial urlEntries state from config schema and resolved settings */
const buildInitialUrlEntries = (
  entries: [string, { type: string }][],
  resolvedSettings: Record<string, unknown> | undefined,
): Record<string, UrlEntry[]> => {
  const initial: Record<string, UrlEntry[]> = {};
  for (const [key, def] of entries) {
    if (def.type !== 'url') continue;
    initial[key] = parseUrlEntries(resolvedSettings?.[key]);
  }
  return initial;
};

const ConfigDialog = ({
  open,
  onOpenChange,
  pluginName,
  displayName,
  configSchema,
  resolvedSettings,
}: ConfigDialogProps) => {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const entries = Object.entries(configSchema);

  const [urlEntries, setUrlEntries] = useState<Record<string, UrlEntry[]>>(() =>
    buildInitialUrlEntries(entries, resolvedSettings),
  );

  const updateUrlEntry = (key: string, index: number, field: 'name' | 'url', value: string) => {
    setUrlEntries(prev => {
      const list = [...(prev[key] ?? [])];
      const existing = list[index] ?? { name: '', url: '' };
      list[index] = { ...existing, [field]: value };
      return { ...prev, [key]: list };
    });
  };

  const addUrlEntry = (key: string) => {
    setUrlEntries(prev => ({
      ...prev,
      [key]: [...(prev[key] ?? []), { name: '', url: '' }],
    }));
  };

  const removeUrlEntry = (key: string, index: number) => {
    setUrlEntries(prev => {
      const list = (prev[key] ?? []).filter((_, i) => i !== index);
      return { ...prev, [key]: list };
    });
  };

  const handleSave = () => {
    const form = formRef.current;
    if (!form) return;

    const newErrors: Record<string, string> = {};
    const settings: Record<string, unknown> = {};

    for (const [key, def] of entries) {
      if (def.type === 'boolean') {
        const checkbox = form.querySelector<HTMLButtonElement>(`[data-key="${key}"]`);
        settings[key] = checkbox?.getAttribute('data-state') === 'checked';
        continue;
      }

      if (def.type === 'url') {
        const entryList = urlEntries[key] ?? [];
        const nonEmpty = entryList.filter(e => e.name.trim() || e.url.trim());

        if (def.required && nonEmpty.length === 0) {
          newErrors[key] = 'At least one instance is required';
          continue;
        }

        if (nonEmpty.length === 0) continue;

        const names = new Set<string>();
        const validationErrors: string[] = [];
        for (const entry of nonEmpty) {
          const name = entry.name.trim();
          const url = entry.url.trim();
          if (!name) {
            validationErrors.push('Instance name cannot be empty');
          } else if (names.has(name)) {
            validationErrors.push(`Duplicate instance name "${name}"`);
          } else {
            names.add(name);
          }
          if (!url) {
            validationErrors.push('URL cannot be empty');
          } else if (!isValidUrl(url)) {
            validationErrors.push(`Invalid URL "${url}"`);
          }
        }

        if (validationErrors.length > 0) {
          newErrors[key] = validationErrors[0] ?? 'Validation failed';
          continue;
        }

        const map: Record<string, string> = {};
        for (const entry of nonEmpty) {
          map[entry.name.trim()] = entry.url.trim();
        }
        settings[key] = map;
        continue;
      }

      const input = form.elements.namedItem(key) as HTMLInputElement | HTMLSelectElement | null;
      if (!input) continue;

      const rawValue = 'value' in input ? input.value : '';

      if (def.type === 'select') {
        if (def.required && !rawValue) {
          newErrors[key] = 'Required';
        } else if (rawValue) {
          settings[key] = rawValue;
        }
        continue;
      }

      const trimmed = rawValue.trim();

      if (def.required && !trimmed) {
        newErrors[key] = 'Required';
        continue;
      }

      if (!trimmed) continue;

      if (def.type === 'number') {
        const num = Number(trimmed);
        if (Number.isNaN(num)) {
          newErrors[key] = 'Must be a number';
          continue;
        }
        settings[key] = num;
        continue;
      }

      settings[key] = trimmed;
    }

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setSaving(true);
    setSaveError(null);
    void setPluginSettings(pluginName, settings)
      .then(() => {
        onOpenChange(false);
      })
      .catch((err: unknown) => {
        setSaveError(err instanceof Error ? err.message : 'Failed to save settings');
      })
      .finally(() => {
        setSaving(false);
      });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Dialog.Content>
        <Dialog.Header>Settings &mdash; {displayName}</Dialog.Header>
        <Dialog.Body>
          <form ref={formRef} onSubmit={e => e.preventDefault()} className="flex flex-col gap-3">
            {entries.map(([key, def]) => (
              <div key={key} className="flex flex-col gap-1">
                <label htmlFor={`config-${key}`} className="font-mono text-foreground text-xs">
                  {def.label}
                  {def.required && <span className="text-destructive"> *</span>}
                </label>
                {def.description && <p className="text-[11px] text-muted-foreground">{def.description}</p>}
                {def.type === 'boolean' ? (
                  <Switch id={`config-${key}`} data-key={key} defaultChecked={resolvedSettings?.[key] === true} />
                ) : def.type === 'select' && def.options ? (
                  <Select name={key} defaultValue={String(resolvedSettings?.[key] ?? '')}>
                    <Select.Trigger id={`config-${key}`} className="h-8 min-w-0 text-sm">
                      <Select.Value placeholder="Select..." />
                    </Select.Trigger>
                    <Select.Content>
                      {def.options.map(opt => (
                        <Select.Item key={opt} value={opt}>
                          {opt}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                ) : def.type === 'url' ? (
                  <InstanceUrlField
                    fieldKey={key}
                    entries={urlEntries[key] ?? [{ name: '', url: '' }]}
                    placeholder={def.placeholder}
                    required={def.required}
                    hasError={Boolean(errors[key])}
                    onUpdate={updateUrlEntry}
                    onAdd={addUrlEntry}
                    onRemove={removeUrlEntry}
                  />
                ) : (
                  <Input
                    id={`config-${key}`}
                    name={key}
                    type={def.type === 'number' ? 'number' : 'text'}
                    placeholder={def.placeholder ?? ''}
                    defaultValue={resolvedSettings?.[key] != null ? String(resolvedSettings[key]) : ''}
                    aria-invalid={Boolean(errors[key])}
                    className="py-1.5 text-sm"
                  />
                )}
                {errors[key] && <p className="text-[11px] text-destructive">{errors[key]}</p>}
              </div>
            ))}
          </form>
          {saveError && (
            <Alert status="error" className="mt-3 px-2 py-1 text-xs">
              {saveError}
            </Alert>
          )}
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.Close asChild>
            <Button size="sm" variant="outline">
              Cancel
            </Button>
          </Dialog.Close>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
};

/** Renders a list of name/URL instance rows for a url-type config field */
const InstanceUrlField = ({
  fieldKey,
  entries,
  placeholder,
  required,
  hasError,
  onUpdate,
  onAdd,
  onRemove,
}: {
  fieldKey: string;
  entries: UrlEntry[];
  placeholder?: string;
  required?: boolean;
  hasError: boolean;
  onUpdate: (key: string, index: number, field: 'name' | 'url', value: string) => void;
  onAdd: (key: string) => void;
  onRemove: (key: string, index: number) => void;
}) => {
  const canRemove = required ? entries.length > 1 : true;
  return (
    <div className="flex flex-col gap-2">
      {entries.map((entry, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            placeholder="Name"
            value={entry.name}
            onChange={e => onUpdate(fieldKey, i, 'name', e.target.value)}
            aria-invalid={hasError}
            className="w-[30%] py-1.5 text-sm"
          />
          <Input
            placeholder={placeholder ?? 'https://example.com'}
            value={entry.url}
            onChange={e => onUpdate(fieldKey, i, 'url', e.target.value)}
            aria-invalid={hasError}
            className="min-w-0 flex-1 py-1.5 text-sm"
          />
          {canRemove && (
            <button
              type="button"
              onClick={() => onRemove(fieldKey, i)}
              className="shrink-0 rounded border-2 border-border bg-card p-1 font-mono text-destructive text-xs shadow-sm transition hover:bg-muted"
              aria-label="Remove instance">
              ✕
            </button>
          )}
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={() => onAdd(fieldKey)} className="self-start">
        + Add instance
      </Button>
    </div>
  );
};

/** Returns true when a plugin has required config fields that are not yet configured */
const needsSetup = (
  configSchema: ConfigSchema | undefined,
  resolvedSettings: Record<string, unknown> | undefined,
): boolean => {
  if (!configSchema) return false;
  return Object.entries(configSchema).some(
    ([key, def]) => def.required && (resolvedSettings == null || resolvedSettings[key] == null),
  );
};

export { ConfigDialog, needsSetup };
