import { PluginIcon } from './PluginIcon.js';
import { Accordion } from './retro/Accordion.js';
import { Alert } from './retro/Alert.js';
import { Switch } from './retro/Switch.js';
import { Tooltip } from './retro/Tooltip.js';
import { ToolRow } from './ToolRow.js';
import { setToolEnabled, setAllToolsEnabled } from '../bridge.js';
import { ERROR_DISPLAY_DURATION_MS } from '../constants.js';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDown } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import type { PluginState } from '../bridge.js';
import type { Dispatch, SetStateAction } from 'react';

const PluginCard = ({
  plugin,
  activeTools,
  setPlugins,
  toolFilter,
}: {
  plugin: PluginState;
  activeTools: Set<string>;
  setPlugins: Dispatch<SetStateAction<PluginState[]>>;
  toolFilter?: string;
}) => {
  const [toggleError, setToggleError] = useState<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(errorTimerRef.current), []);

  const showToggleError = (message: string) => {
    clearTimeout(errorTimerRef.current);
    setToggleError(message);
    errorTimerRef.current = setTimeout(() => setToggleError(null), ERROR_DISPLAY_DURATION_MS);
  };

  const allEnabled = plugin.tools.length > 0 && plugin.tools.every(t => t.enabled);

  const handleToggleAll = (checked: boolean) => {
    const originalTools = plugin.tools;
    setPlugins(prev =>
      prev.map(p => (p.name === plugin.name ? { ...p, tools: p.tools.map(t => ({ ...t, enabled: checked })) } : p)),
    );
    void setAllToolsEnabled(plugin.name, checked).catch(() => {
      setPlugins(prev => prev.map(p => (p.name === plugin.name ? { ...p, tools: originalTools } : p)));
      showToggleError('Failed to toggle all tools');
    });
  };

  const handleToggleTool = (toolName: string, currentEnabled: boolean) => {
    const newEnabled = !currentEnabled;
    setPlugins(prev =>
      prev.map(p =>
        p.name === plugin.name
          ? { ...p, tools: p.tools.map(t => (t.name === toolName ? { ...t, enabled: newEnabled } : t)) }
          : p,
      ),
    );
    void setToolEnabled(plugin.name, toolName, newEnabled).catch(() => {
      setPlugins(prev =>
        prev.map(p =>
          p.name === plugin.name
            ? { ...p, tools: p.tools.map(t => (t.name === toolName ? { ...t, enabled: !newEnabled } : t)) }
            : p,
        ),
      );
      showToggleError(`Failed to toggle ${toolName}`);
    });
  };

  const filterLower = toolFilter?.toLowerCase() ?? '';
  const visibleTools = filterLower
    ? plugin.tools.filter(
        t =>
          t.displayName.toLowerCase().includes(filterLower) ||
          t.name.toLowerCase().includes(filterLower) ||
          t.description.toLowerCase().includes(filterLower),
      )
    : plugin.tools;

  return (
    <Accordion.Item value={plugin.name}>
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
              <span className="text-muted-foreground bg-muted inline-block rounded px-1 py-0.5 align-middle text-[9px] leading-none font-medium">
                DEV
              </span>
            )}
            {!plugin.sdkVersion && (
              <Tooltip>
                <Tooltip.Trigger asChild>
                  <span className="border-accent bg-accent/10 text-accent-foreground inline-block rounded border px-1 py-0.5 align-middle text-[9px] leading-none font-medium">
                    SDK
                  </span>
                </Tooltip.Trigger>
                <Tooltip.Content>SDK version mismatch — rebuild plugin</Tooltip.Content>
              </Tooltip>
            )}
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200" />
        </AccordionPrimitive.Trigger>
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

      <Accordion.Content className="border-border border-t">
        {toolFilter && (
          <div className="text-muted-foreground mb-1 px-3 pt-2 text-xs">
            {visibleTools.length} of {plugin.tools.length} tools
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
