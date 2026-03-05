// PluginCard needs a custom header layout (icon + name + selector outside the trigger) that the retro Accordion wrapper does not support.

import type { ToolPermission } from '@opentabs-dev/shared';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDown, ShieldQuestionMark } from 'lucide-react';
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
import { Button } from './retro/Button.js';
import { Dialog } from './retro/Dialog.js';
import { Tooltip } from './retro/Tooltip.js';
import { PermissionSelect, ToolRow } from './ToolRow.js';

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
  transitionClass,
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
  transitionClass?: string;
}) => {
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [pendingPermission, setPendingPermission] = useState<ToolPermission | null>(null);
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

  const applyPluginPermission = (newPermission: ToolPermission, reviewedVersion?: string) => {
    const myVersion = ++toggleCounter.current;
    prePluginPermRef.current = plugin.permission;
    setPlugins(prev =>
      prev.map(p =>
        p.name === plugin.name
          ? { ...p, permission: newPermission, ...(reviewedVersion ? { reviewed: true } : {}) }
          : p,
      ),
    );
    void setPluginPermission(plugin.name, newPermission, reviewedVersion).catch(() => {
      if (toggleCounter.current === myVersion) {
        setPlugins(prev =>
          prev.map(p => (p.name === plugin.name ? { ...p, permission: prePluginPermRef.current } : p)),
        );
      }
      showToggleError('Failed to update plugin permission');
    });
  };

  const handlePluginPermissionChange = (newPermission: ToolPermission) => {
    if (!plugin.reviewed && plugin.permission === 'off' && newPermission !== 'off') {
      setPendingPermission(newPermission);
      return;
    }
    applyPluginPermission(newPermission);
  };

  const handleEnableAnyway = () => {
    if (pendingPermission) {
      applyPluginPermission(pendingPermission, plugin.version);
    }
    setPendingPermission(null);
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

  const inactive = plugin.tabState !== 'ready';

  return (
    <Accordion.Item
      value={plugin.name}
      className={
        transitionClass ??
        (removingPlugin
          ? 'pointer-events-none opacity-60 transition-opacity'
          : inactive
            ? 'opacity-70 transition-opacity'
            : undefined)
      }>
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
            <Tooltip.Content>v{plugin.version}</Tooltip.Content>
          </Tooltip>
          <div
            className={`flex min-w-0 flex-1 items-center gap-1.5 truncate font-head text-sm ${inactive ? 'text-muted-foreground' : 'text-foreground'}`}>
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
            {!plugin.reviewed && (
              <Tooltip>
                <Tooltip.Trigger asChild>
                  <ShieldQuestionMark className="inline-block h-3.5 w-3.5 align-middle text-muted-foreground" />
                </Tooltip.Trigger>
                <Tooltip.Content>This plugin version has not been reviewed</Tooltip.Content>
              </Tooltip>
            )}
          </div>
          <ChevronDown
            className={`h-4 w-4 shrink-0 transition-transform duration-200 ${inactive ? 'text-muted-foreground' : ''}`}
          />
        </AccordionPrimitive.Trigger>
        <PluginMenu
          plugin={plugin}
          onUpdate={onUpdate ?? (() => undefined)}
          onRemove={onRemove ?? (() => undefined)}
          updating={updatingPlugin ?? false}
          removing={removingPlugin ?? false}
          muted={inactive}
          className="flex shrink-0 items-center px-1"
        />
        <div className="flex shrink-0 items-center px-3">
          <PermissionSelect
            value={plugin.permission}
            onValueChange={handlePluginPermissionChange}
            disabled={false}
            muted={inactive}
            ariaLabel={`Permission for ${plugin.name} plugin`}
          />
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
                <div className="border-border border-b bg-muted/20 px-3 py-1">
                  <span className="font-head text-muted-foreground text-xs uppercase tracking-wider">{group.name}</span>
                </div>
                {group.tools.map(tool => (
                  <ToolRow
                    key={tool.name}
                    name={tool.name}
                    displayName={tool.displayName}
                    description={tool.description}
                    summary={tool.summary}
                    icon={tool.icon}
                    permission={tool.permission}
                    active={activeTools.has(`${plugin.name}:${tool.name}`)}
                    muted={inactive}
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
                summary={tool.summary}
                icon={tool.icon}
                permission={tool.permission}
                active={activeTools.has(`${plugin.name}:${tool.name}`)}
                muted={inactive}
                onPermissionChange={handleToolPermissionChange}
              />
            ))}
      </Accordion.Content>

      <Dialog open={pendingPermission !== null} onOpenChange={open => !open && setPendingPermission(null)}>
        <Dialog.Content onInteractOutside={(e: Event) => e.preventDefault()}>
          <Dialog.Header>Unreviewed Plugin</Dialog.Header>
          <Dialog.Body>
            <p className="font-mono text-foreground text-sm">
              {plugin.displayName} v{plugin.version}
            </p>
            <p className="mt-2 text-foreground text-sm">
              This plugin version has not been reviewed. You can ask your AI agent to review the adapter code by saying
              &ldquo;review the {plugin.name} plugin&rdquo; in your chat.
            </p>
            <p className="mt-2 text-muted-foreground text-xs">You can also enable it now without review.</p>
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.Close asChild>
              <Button size="sm" variant="outline">
                Cancel
              </Button>
            </Dialog.Close>
            <Button size="sm" onClick={handleEnableAnyway}>
              Enable Anyway
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>
    </Accordion.Item>
  );
};

export { PluginCard };
