import { Accordion } from './retro/Accordion.js';
import { Alert } from './retro/Alert.js';
import { Badge } from './retro/Badge.js';
import { Switch } from './retro/Switch.js';
import { ToolRow } from './ToolRow.js';
import { setBrowserToolEnabled } from '../bridge.js';
import { ERROR_DISPLAY_DURATION_MS } from '../constants.js';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDown, Globe } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import type { BrowserToolState } from '../bridge.js';

/** Convert a snake_case browser tool name to a human-readable display name.
 * Removes the 'browser_' prefix and title-cases each word. */
const toDisplayName = (name: string): string =>
  name
    .replace(/^browser_/, '')
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

const BrowserToolsCard = ({
  tools,
  activeTools,
  onToolsChange,
  toolFilter,
}: {
  tools: BrowserToolState[];
  activeTools: Set<string>;
  onToolsChange: (updater: (tools: BrowserToolState[]) => BrowserToolState[]) => void;
  toolFilter?: string;
}) => {
  const [toggleError, setToggleError] = useState<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toggleCounter = useRef(0);

  useEffect(() => () => clearTimeout(errorTimerRef.current), []);

  const showToggleError = (message: string) => {
    clearTimeout(errorTimerRef.current);
    setToggleError(message);
    errorTimerRef.current = setTimeout(() => setToggleError(null), ERROR_DISPLAY_DURATION_MS);
  };

  const allEnabled = tools.length > 0 && tools.every(t => t.enabled);

  const handleToggleAll = (checked: boolean) => {
    const originalTools = tools;
    const myVersion = ++toggleCounter.current;
    onToolsChange(() => tools.map(t => ({ ...t, enabled: checked })));
    const promises = tools.filter(t => t.enabled !== checked).map(t => setBrowserToolEnabled(t.name, checked));
    void Promise.all(promises).catch(() => {
      if (toggleCounter.current === myVersion) {
        onToolsChange(() => originalTools);
      }
      showToggleError('Failed to toggle all browser tools');
    });
  };

  const handleToggleTool = (toolName: string, currentEnabled: boolean) => {
    const originalTools = tools;
    const myVersion = ++toggleCounter.current;
    const newEnabled = !currentEnabled;
    onToolsChange(prev => prev.map(t => (t.name === toolName ? { ...t, enabled: newEnabled } : t)));
    void setBrowserToolEnabled(toolName, newEnabled).catch(() => {
      if (toggleCounter.current === myVersion) {
        onToolsChange(() => originalTools);
      }
      showToggleError(`Failed to toggle ${toolName}`);
    });
  };

  const filterLower = toolFilter?.toLowerCase() ?? '';
  const visibleTools = filterLower
    ? tools.filter(
        t =>
          toDisplayName(t.name).toLowerCase().includes(filterLower) ||
          t.name.toLowerCase().includes(filterLower) ||
          t.description.toLowerCase().includes(filterLower),
      )
    : tools;

  return (
    <Accordion.Item value="browser-tools">
      <AccordionPrimitive.Header className="flex">
        <AccordionPrimitive.Trigger className="font-head flex flex-1 cursor-pointer items-center gap-2 px-3 py-2 focus:outline-hidden [&[data-state=open]>svg.chevron]:rotate-180">
          <div className="border-border bg-muted/50 flex h-8 w-8 shrink-0 items-center justify-center rounded border-2">
            <Globe className="text-muted-foreground h-4 w-4" />
          </div>
          <div className="font-head text-foreground flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm">
            Browser Tools
            <Badge variant="default" size="sm" className="align-middle">
              BUILT-IN
            </Badge>
          </div>
          <ChevronDown className="chevron h-4 w-4 shrink-0 transition-transform duration-200" />
        </AccordionPrimitive.Trigger>
        <div className="shrink-0 px-1" aria-hidden="true">
          <div className="h-6 w-6" />
        </div>
        <div
          className="flex shrink-0 items-center px-3"
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
          }}
          role="presentation">
          <Switch checked={allEnabled} onCheckedChange={handleToggleAll} aria-label="Toggle all browser tools" />
        </div>
      </AccordionPrimitive.Header>

      {toggleError && (
        <Alert status="error" className="mx-3 mb-1 px-2 py-1 text-[11px]">
          {toggleError}
        </Alert>
      )}

      <Accordion.Content className="border-border border-t">
        {toolFilter && (
          <div className="text-muted-foreground mb-1 px-3 pt-2 text-xs">
            {visibleTools.length} of {tools.length} tools
          </div>
        )}
        {visibleTools.map(tool => (
          <ToolRow
            key={tool.name}
            name={tool.name}
            displayName={toDisplayName(tool.name)}
            description={tool.description}
            icon="globe"
            enabled={tool.enabled}
            active={activeTools.has(`browser:${tool.name}`)}
            onToggle={() => handleToggleTool(tool.name, tool.enabled)}
          />
        ))}
      </Accordion.Content>
    </Accordion.Item>
  );
};

export { BrowserToolsCard, toDisplayName };
