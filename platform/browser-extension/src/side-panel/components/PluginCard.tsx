import { PluginIcon } from './PluginIcon.js';
import { PluginMenu } from './PluginMenu.js';
import { Accordion } from './retro/Accordion.js';
import { Alert } from './retro/Alert.js';
import { Badge } from './retro/Badge.js';
import { Switch } from './retro/Switch.js';
import { Tooltip } from './retro/Tooltip.js';
import { ToolRow } from './ToolRow.js';
import { matchesTool, setToolEnabled, setAllToolsEnabled } from '../bridge.js';
import { ERROR_DISPLAY_DURATION_MS } from '../constants.js';
// PluginCard needs a custom header layout (icon + name + switch outside the trigger) that the retro Accordion wrapper does not support.
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDown } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import type { PluginState, WireToolDef } from '../bridge.js';
import type { Dispatch, SetStateAction } from 'react';

const PluginCard = ({
  plugin,
  activeTools,
  setPlugins,
  toolFilter,
  onUpdate,
  onRemove,
  updatingPlugin,
  removingPlugin,
  actionError,
}: {
  plugin: PluginState;
  activeTools: Set<string>;
  setPlugins: Dispatch<SetStateAction<PluginState[]>>;
  toolFilter?: string;
  onUpdate?: () => void;
  onRemove?: () => void;
  updatingPlugin?: boolean;
  removingPlugin?: boolean;
  actionError?: string | null;
}) => {
  const [toggleError, setToggleError] = useState<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toggleCounter = useRef(0);
  const preToggleRef = useRef<WireToolDef[]>([]);

  useEffect(() => () => clearTimeout(errorTimerRef.current), []);

  const showToggleError = (message: string) => {
    clearTimeout(errorTimerRef.current);
    setToggleError(message);
    errorTimerRef.current = setTimeout(() => setToggleError(null), ERROR_DISPLAY_DURATION_MS);
  };

  const pluginTools = plugin.tools ?? [];

  const updatePluginTools = (updater: (tools: WireToolDef[]) => WireToolDef[]) =>
    setPlugins(prev => prev.map(p => (p.name === plugin.name ? { ...p, tools: updater(p.tools ?? []) } : p)));

  const allEnabled = pluginTools.length > 0 && pluginTools.every(t => t.enabled);

  const handleToggleAll = (checked: boolean) => {
    const myVersion = ++toggleCounter.current;
    updatePluginTools(prev => {
      preToggleRef.current = prev;
      return prev.map(t => ({ ...t, enabled: checked }));
    });
    void setAllToolsEnabled(plugin.name, checked).catch(() => {
      if (toggleCounter.current === myVersion) {
        updatePluginTools(() => preToggleRef.current);
      }
      showToggleError('Failed to toggle all tools');
    });
  };

  const handleToggleTool = (toolName: string, currentEnabled: boolean) => {
    const myVersion = ++toggleCounter.current;
    const newEnabled = !currentEnabled;
    updatePluginTools(prev => {
      preToggleRef.current = prev;
      return prev.map(t => (t.name === toolName ? { ...t, enabled: newEnabled } : t));
    });
    void setToolEnabled(plugin.name, toolName, newEnabled).catch(() => {
      if (toggleCounter.current === myVersion) {
        updatePluginTools(() => preToggleRef.current);
      }
      showToggleError(`Failed to toggle ${toolName}`);
    });
  };

  const filterLower = toolFilter?.toLowerCase() ?? '';
  const visibleTools = filterLower ? pluginTools.filter(t => matchesTool(t, filterLower)) : pluginTools;

  return (
    <Accordion.Item
      value={plugin.name}
      className={removingPlugin ? 'pointer-events-none opacity-60 transition-opacity' : undefined}>
      <AccordionPrimitive.Header className="flex">
        <AccordionPrimitive.Trigger className="font-head flex flex-1 cursor-pointer items-center gap-2 px-3 py-2 focus:outline-hidden [&[data-state=open]>svg]:rotate-180">
          <Tooltip>
            <Tooltip.Trigger asChild>
              <div>
                <PluginIcon
                  pluginName={plugin.name}
                  displayName={plugin.displayName}
                  tabState={plugin.tabState}
                  hasUpdate={!!plugin.update}
                  size={32}
                  iconSvg={plugin.iconSvg}
                  iconInactiveSvg={plugin.iconInactiveSvg}
                />
              </div>
            </Tooltip.Trigger>
            <Tooltip.Content>
              v{plugin.version} &middot; {plugin.trustTier}
              {plugin.update && <> &middot; Update: {plugin.update.latestVersion}</>}
            </Tooltip.Content>
          </Tooltip>
          <div className="font-head text-foreground flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm">
            {plugin.displayName}
            {plugin.source === 'local' && (
              <Badge variant="default" size="sm" className="align-middle">
                DEV
              </Badge>
            )}
            {!plugin.sdkVersion && (
              <Tooltip>
                <Tooltip.Trigger asChild>
                  <Badge
                    variant="outline"
                    size="sm"
                    className="border-accent bg-accent/10 text-accent-foreground align-middle">
                    SDK
                  </Badge>
                </Tooltip.Trigger>
                <Tooltip.Content>SDK version mismatch — rebuild plugin</Tooltip.Content>
              </Tooltip>
            )}
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200" />
        </AccordionPrimitive.Trigger>
        <PluginMenu
          plugin={plugin}
          onUpdate={onUpdate ?? (() => undefined)}
          onRemove={onRemove ?? (() => undefined)}
          updating={updatingPlugin ?? false}
          removing={removingPlugin ?? false}
          className="flex shrink-0 items-center px-1"
        />
        <div
          className="flex shrink-0 items-center px-3"
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
          }}
          role="presentation">
          <Switch
            checked={allEnabled}
            onCheckedChange={handleToggleAll}
            aria-label={`Toggle all tools for ${plugin.name}`}
          />
        </div>
      </AccordionPrimitive.Header>

      {toggleError && (
        <Alert status="error" className="mx-3 mb-1 px-2 py-1 text-[11px]">
          {toggleError}
        </Alert>
      )}
      {actionError && (
        <Alert status="error" className="mx-3 mb-1 px-2 py-1 text-[11px]">
          {actionError}
        </Alert>
      )}

      <Accordion.Content className="border-border border-t">
        {toolFilter && (
          <div className="text-muted-foreground mb-1 px-3 pt-2 text-xs">
            {visibleTools.length} of {pluginTools.length} tools
          </div>
        )}
        {visibleTools.map(tool => (
          <ToolRow
            key={tool.name}
            name={tool.name}
            displayName={tool.displayName}
            description={tool.description}
            icon={tool.icon}
            enabled={tool.enabled}
            active={activeTools.has(`${plugin.name}:${tool.name}`)}
            onToggle={() => handleToggleTool(tool.name, tool.enabled)}
          />
        ))}
      </Accordion.Content>
    </Accordion.Item>
  );
};

export { PluginCard };
