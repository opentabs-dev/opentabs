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

const isValidUrl = (value: string): boolean => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
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

      if (def.type === 'url' && !isValidUrl(trimmed)) {
        newErrors[key] = 'Must be a valid URL';
        continue;
      }

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
