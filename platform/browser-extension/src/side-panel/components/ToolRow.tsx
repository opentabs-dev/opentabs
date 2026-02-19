import { Switch } from './retro/Switch.js';
import { Tooltip } from './retro/Tooltip.js';
import { ToolIcon } from './ToolIcon.js';

const ToolRow = ({
  name,
  description,
  enabled,
  active,
  onToggle,
}: {
  name: string;
  description: string;
  enabled: boolean;
  active: boolean;
  onToggle: () => void;
}) => (
  <div
    className={`border-border hover:bg-muted/10 flex items-center gap-2 border-b px-3 py-2 transition-colors last:border-b-0 ${active ? 'border-primary border-l-2' : ''}`}>
    <ToolIcon toolName={name} />
    <div className="min-w-0 flex-1">
      <div className="text-foreground truncate text-xs font-medium">{name}</div>
      <Tooltip.Provider>
        <Tooltip>
          <Tooltip.Trigger asChild>
            <div className="text-muted-foreground truncate text-[11px]">{description}</div>
          </Tooltip.Trigger>
          <Tooltip.Content>{description}</Tooltip.Content>
        </Tooltip>
      </Tooltip.Provider>
    </div>
    <div className="flex shrink-0 items-center gap-2">
      {active && <div className="border-muted border-t-primary h-3 w-3 animate-spin rounded-full border-2" />}
      <Switch
        checked={enabled}
        onCheckedChange={() => onToggle()}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        aria-label={`Toggle ${name} tool`}
      />
    </div>
  </div>
);

export { ToolRow };
