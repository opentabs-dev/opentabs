import type { ToolPermission } from '@opentabs-dev/shared';
import { cn } from '../lib/cn.js';
import { Select } from './retro/Select.js';
import { Tooltip } from './retro/Tooltip.js';
import { ToolIcon } from './ToolIcon.js';

const PERMISSION_LABELS: Record<ToolPermission, string> = {
  off: 'Off',
  ask: 'Ask',
  auto: 'Auto',
};

const PermissionSelect = ({
  value,
  onValueChange,
  disabled,
  muted,
  ariaLabel,
}: {
  value: ToolPermission;
  onValueChange: (value: ToolPermission) => void;
  disabled: boolean;
  /** Use muted border and text colors (for inactive/disconnected plugins). */
  muted?: boolean;
  ariaLabel: string;
}) => (
  <Select value={value} onValueChange={(v: string) => onValueChange(v as ToolPermission)}>
    <Select.Trigger
      className={cn(
        'h-6 w-[4.5rem] min-w-0 px-1.5 py-0 font-mono font-semibold text-xs shadow-none focus:shadow-none',
        muted && 'border-border/50 text-muted-foreground',
      )}
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
      disabled={disabled}
      aria-label={ariaLabel}>
      <Select.Value />
    </Select.Trigger>
    <Select.Content className="font-mono font-semibold text-xs">
      {(['off', 'ask', 'auto'] as const).map(p => (
        <Select.Item
          key={p}
          value={p}
          onPointerUp={() => {
            // Radix Select's onValueChange doesn't fire when re-selecting the
            // current value. Fire the callback explicitly so that re-selecting
            // the plugin-level default clears per-tool overrides.
            if (p === value) onValueChange(p);
          }}>
          {PERMISSION_LABELS[p]}
        </Select.Item>
      ))}
    </Select.Content>
  </Select>
);

const ToolRow = ({
  name,
  displayName,
  description,
  summary,
  icon,
  permission,
  active,
  muted,
  disabled,
  onPermissionChange,
}: {
  name: string;
  displayName: string;
  description: string;
  /** Short human-readable summary for the UI. Falls back to description if omitted. */
  summary?: string;
  icon: string;
  permission: ToolPermission;
  active: boolean;
  /** Use muted text colors (for inactive/disconnected plugins). */
  muted?: boolean;
  disabled?: boolean;
  onPermissionChange: (tool: string, permission: ToolPermission) => void;
}) => {
  const enabled = permission !== 'off';
  const displayDescription = summary ?? description;
  return (
    <div
      className={cn(
        'flex items-center gap-2 border-border border-b px-3 py-1.5 transition-colors last:border-b-0 even:bg-muted/10',
        enabled ? 'hover:bg-primary/10' : 'hover:bg-muted/50',
        disabled && 'opacity-50',
      )}>
      <ToolIcon icon={icon} enabled={enabled} active={active} />
      <Tooltip>
        <Tooltip.Trigger asChild>
          <div className="min-w-0 flex-1">
            <div className={`truncate text-sm ${muted ? 'text-muted-foreground' : 'text-foreground'}`}>
              {displayName}
            </div>
            <div className="truncate text-muted-foreground text-xs">{displayDescription}</div>
          </div>
        </Tooltip.Trigger>
        <Tooltip.Content>{displayDescription}</Tooltip.Content>
      </Tooltip>
      <div className="flex shrink-0 items-center gap-2">
        <PermissionSelect
          value={permission}
          onValueChange={p => onPermissionChange(name, p)}
          disabled={disabled ?? false}
          muted={muted}
          ariaLabel={`Permission for ${name} tool`}
        />
      </div>
    </div>
  );
};

export { PermissionSelect, ToolRow };
