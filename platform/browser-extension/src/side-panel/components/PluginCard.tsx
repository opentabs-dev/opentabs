// PluginCard needs a custom header layout (icon + name + selector outside the trigger) that the retro Accordion wrapper does not support.

import type { ToolPermission } from '@opentabs-dev/shared';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDown } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { PluginState, WireToolDef } from '../bridge.js';
import { matchesTool, setPluginPermission, setToolPermission } from '../bridge.js';
import { ERROR_DISPLAY_DURATION_MS } from '../constants.js';
import { PluginIcon } from './PluginIcon.js';
import { PluginMenu } from './PluginMenu.js';
import { Accordion } from './retro/Accordion.js';
import { Alert } from './retro/Alert.js';
import { Badge } from './retro/Badge.js';
import { Switch } from './retro/Switch.js';
import { Tooltip } from './retro/Tooltip.js';
import { ToolRow } from './ToolRow.js';

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
  skipPermissions,
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
  skipPermissions?: boolean;
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

  const prePluginPermRef = useRef<ToolPermission>('off');

  const handlePluginPermissionChange = (newPermission: ToolPermission) => {
    const myVersion = ++toggleCounter.current;
    prePluginPermRef.current = plugin.permission;
    setPlugins(prev => prev.map(p => (p.name === plugin.name ? { ...p, permission: newPermission } : p)));
    void setPluginPermission(plugin.name, newPermission).catch(() => {
      if (toggleCounter.current === myVersion) {
        setPlugins(prev =>
          prev.map(p => (p.name === plugin.name ? { ...p, permission: prePluginPermRef.current } : p)),
        );
      }
      showToggleError('Failed to update plugin permission');
    });
  };

  const handleToolPermissionChange = (toolName: string, newPermission: ToolPermission) => {
    const myVersion = ++toggleCounter.current;
    updatePluginTools(prev => {
      preToggleRef.current = prev;
      return prev.map(t => (t.name === toolName ? { ...t, permission: newPermission } : t));
    });
    void setToolPermission(plugin.name, toolName, newPermission).catch(() => {
      if (toggleCounter.current === myVersion) {
        updatePluginTools(() => preToggleRef.current);
      }
      showToggleError(`Failed to update ${toolName}`);
    });
  };

  const handleToggleGroup = (groupTools: WireToolDef[], checked: boolean) => {
    const myVersion = ++toggleCounter.current;
    const permission: ToolPermission = checked ? 'auto' : 'off';
    const groupToolNames = new Set(groupTools.map(t => t.name));
    updatePluginTools(prev => {
      preToggleRef.current = prev;
      return prev.map(t => (groupToolNames.has(t.name) ? { ...t, permission } : t));
    });
    void Promise.all(groupTools.map(t => setToolPermission(plugin.name, t.name, permission))).catch(() => {
      if (toggleCounter.current === myVersion) {
        updatePluginTools(() => preToggleRef.current);
      }
      showToggleError('Failed to toggle group');
    });
  };

  const filterLower = toolFilter?.toLowerCase() ?? '';
  const visibleTools = filterLower ? pluginTools.filter(t => matchesTool(t, filterLower)) : pluginTools;
  const hasActiveTool = pluginTools.some(t => activeTools.has(`${plugin.name}:${t.name}`));

  // Group tools by their group field, preserving first-seen order
  const hasAnyGroup = visibleTools.some(t => t.group);
  const toolGroups: { name: string; tools: WireToolDef[] }[] = [];
  if (hasAnyGroup) {
    const groupMap = new Map<string, WireToolDef[]>();
    for (const tool of visibleTools) {
      const groupName = tool.group ?? 'Other';
      let bucket = groupMap.get(groupName);
      if (!bucket) {
        bucket = [];
        groupMap.set(groupName, bucket);
      }
      bucket.push(tool);
    }
    // Move 'Other' to the end if it exists
    const otherBucket = groupMap.get('Other');
    groupMap.delete('Other');
    for (const [name, tools] of groupMap) {
      toolGroups.push({ name, tools });
    }
    if (otherBucket) {
      toolGroups.push({ name: 'Other', tools: otherBucket });
    }
  }

  return (
    <Accordion.Item
      value={plugin.name}
      className={removingPlugin ? 'pointer-events-none opacity-60 transition-opacity' : undefined}>
      <AccordionPrimitive.Header className="flex">
        <AccordionPrimitive.Trigger className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 py-2 focus:outline-hidden [&[data-state=open]>svg]:rotate-180">
          <Tooltip>
            <Tooltip.Trigger asChild>
              <div>
                <PluginIcon
                  pluginName={plugin.name}
                  displayName={plugin.displayName}
                  tabState={plugin.tabState}
                  size={32}
                  iconSvg={plugin.iconSvg}
                  iconInactiveSvg={plugin.iconInactiveSvg}
                  iconDarkSvg={plugin.iconDarkSvg}
                  iconDarkInactiveSvg={plugin.iconDarkInactiveSvg}
                  active={hasActiveTool}
                />
              </div>
            </Tooltip.Trigger>
            <Tooltip.Content>
              v{plugin.version}
              {plugin.update && <> &middot; Update: {plugin.update.latestVersion}</>}
            </Tooltip.Content>
          </Tooltip>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 truncate font-head text-foreground text-sm">
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
                    className="border-accent bg-accent/10 align-middle text-accent-foreground">
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
          <select
            value={plugin.permission}
            onChange={e => handlePluginPermissionChange(e.target.value as ToolPermission)}
            disabled={skipPermissions}
            aria-label={`Permission for ${plugin.name} plugin`}
            className="rounded border-2 border-border bg-card px-1 py-0.5 font-mono text-xs focus:shadow-[2px_2px_0_0_var(--color-border)] focus:outline-none">
            <option value="off">Off</option>
            <option value="ask">Ask</option>
            <option value="auto">Auto</option>
          </select>
        </div>
      </AccordionPrimitive.Header>

      {toggleError && (
        <Alert status="error" className="mx-3 mb-1 px-2 py-1 text-xs">
          {toggleError}
        </Alert>
      )}
      {actionError && (
        <Alert status="error" className="mx-3 mb-1 px-2 py-1 text-xs">
          {actionError}
        </Alert>
      )}

      <Accordion.Content className="border-border border-t">
        {toolFilter && (
          <div className="mb-1 px-3 pt-2 text-muted-foreground text-xs">
            {visibleTools.length} of {pluginTools.length} tools
          </div>
        )}
        {hasAnyGroup
          ? toolGroups.map(group => (
              <div key={group.name}>
                <div className="flex items-center gap-2 border-border border-b bg-muted/20 px-3 py-1">
                  <span className="flex-1 font-head text-muted-foreground text-xs uppercase tracking-wider">
                    {group.name}
                  </span>
                  <Switch
                    checked={group.tools.every(t => t.permission !== 'off')}
                    onCheckedChange={checked => handleToggleGroup(group.tools, checked)}
                    disabled={skipPermissions}
                    aria-label={`Toggle all ${group.name} tools`}
                  />
                </div>
                {group.tools.map(tool => (
                  <ToolRow
                    key={tool.name}
                    name={tool.name}
                    displayName={tool.displayName}
                    description={tool.description}
                    icon={tool.icon}
                    permission={tool.permission}
                    active={activeTools.has(`${plugin.name}:${tool.name}`)}
                    disabled={skipPermissions}
                    onPermissionChange={handleToolPermissionChange}
                  />
                ))}
              </div>
            ))
          : visibleTools.map(tool => (
              <ToolRow
                key={tool.name}
                name={tool.name}
                displayName={tool.displayName}
                description={tool.description}
                icon={tool.icon}
                permission={tool.permission}
                active={activeTools.has(`${plugin.name}:${tool.name}`)}
                disabled={skipPermissions}
                onPermissionChange={handleToolPermissionChange}
              />
            ))}
      </Accordion.Content>
    </Accordion.Item>
  );
};

export { PluginCard };
