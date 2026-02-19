import { PluginIcon } from './PluginIcon.js';
import { Accordion } from './retro/Accordion.js';
import { Alert } from './retro/Alert.js';
import { Badge } from './retro/Badge.js';
import { Switch } from './retro/Switch.js';
import { ToolRow } from './ToolRow.js';
import { setToolEnabled, setAllToolsEnabled } from '../bridge.js';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDown } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import type { PluginState } from '../bridge.js';
import type { TrustTier } from '@opentabs-dev/shared';
import type { Dispatch, SetStateAction } from 'react';

const extractDomain = (urlPatterns: string[]): string | null => {
  for (const pattern of urlPatterns) {
    const m = pattern.match(/^(?:\*|https?|ftp):\/\/(\*\.)?(.+?)(?:\/|$)/);
    if (m?.[2] && m[2] !== '*') {
      return m[2];
    }
  }
  return null;
};

const tabStateBadgeVariant = (tabState: string) => {
  if (tabState === 'ready') return 'surface' as const;
  if (tabState === 'unavailable') return 'default' as const;
  return 'outline' as const;
};

const trustBadgeVariant = (tier: TrustTier) => {
  if (tier === 'official') return 'solid' as const;
  if (tier === 'community') return 'surface' as const;
  return 'outline' as const;
};

const TabStateHint = ({ plugin }: { plugin: PluginState }) => {
  if (plugin.tabState === 'ready') return null;

  const domain = extractDomain(plugin.urlPatterns);

  if (plugin.tabState === 'closed') {
    return (
      <div className="text-destructive px-3 pb-2 pl-[42px] text-[11px]">
        {domain ? `Open ${domain} in your browser` : 'Open a matching tab in your browser'}
      </div>
    );
  }

  return <div className="text-muted-foreground px-3 pb-2 pl-[42px] text-[11px]">Log in to {plugin.displayName}</div>;
};

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
    errorTimerRef.current = setTimeout(() => setToggleError(null), 3000);
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
        t => t.name.toLowerCase().includes(filterLower) || t.description.toLowerCase().includes(filterLower),
      )
    : plugin.tools;

  const trustLabel = plugin.trustTier.charAt(0).toUpperCase() + plugin.trustTier.slice(1);

  return (
    <Accordion.Item value={plugin.name}>
      <AccordionPrimitive.Header className="flex">
        <AccordionPrimitive.Trigger className="font-head flex flex-1 cursor-pointer items-center gap-2 px-3 py-2 focus:outline-hidden [&[data-state=open]>svg]:rotate-180">
          <PluginIcon pluginName={plugin.name} size={32} />
          <div className="min-w-0 flex-1">
            <div className="font-head text-foreground truncate text-sm">{plugin.displayName}</div>
            <div className="flex flex-wrap items-center gap-1">
              <Badge variant="outline" size="sm">
                v{plugin.version}
              </Badge>
              <Badge variant={tabStateBadgeVariant(plugin.tabState)} size="sm">
                {plugin.tabState}
              </Badge>
              <Badge variant={trustBadgeVariant(plugin.trustTier)} size="sm">
                {trustLabel}
              </Badge>
            </div>
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

      <TabStateHint plugin={plugin} />

      <Accordion.Content>
        {toolFilter && (
          <div className="text-muted-foreground mb-1 text-xs">
            {visibleTools.length} of {plugin.tools.length} tools
          </div>
        )}
        {visibleTools.map(tool => (
          <ToolRow
            key={tool.name}
            name={tool.name}
            description={tool.description}
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
