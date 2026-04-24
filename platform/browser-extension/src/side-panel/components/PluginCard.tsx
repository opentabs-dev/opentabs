// PluginCard needs a custom header layout (icon + name + selector outside the trigger) that the retro Accordion wrapper does not support.

import type { ToolPermission } from '@opentabs-dev/shared';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDown, FileCode, Settings, ShieldQuestionMark } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { PluginState, WireToolDef } from '../bridge.js';
import { matchesTool, openPluginTab, setPluginPermission, setToolPermission } from '../bridge.js';
import { ERROR_DISPLAY_DURATION_MS } from '../constants.js';
import { ConfigDialog, needsSetup } from './ConfigDialog.js';
import { PluginIcon } from './PluginIcon.js';
import { PluginMenu } from './PluginMenu.js';
import { Accordion } from './retro/Accordion.js';
import { Alert } from './retro/Alert.js';
import { Badge } from './retro/Badge.js';
import { Button } from './retro/Button.js';
import { Dialog } from './retro/Dialog.js';
import { Tooltip } from './retro/Tooltip.js';
import { PermissionSelect, ToolRow } from './ToolRow.js';
import { groupTools } from './tool-groups.js';

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
  const [configOpen, setConfigOpen] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  /** Pending unreviewed permission change awaiting user confirmation. */
  const [pendingChange, setPendingChange] = useState<{
    permission: ToolPermission;
    /** Tool name if this is a per-tool change, undefined for plugin-level. */
    tool?: string;
  } | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toggleCounter = useRef(0);
  const pendingToolRollbacks = useRef<Map<number, { toolName: string; prev: ToolPermission }>>(new Map());
  const pendingPluginRollbacks = useRef<Map<number, ToolPermission>>(new Map());

  useEffect(() => () => clearTimeout(errorTimerRef.current), []);

  const showToggleError = (message: string) => {
    clearTimeout(errorTimerRef.current);
    setToggleError(message);
    errorTimerRef.current = setTimeout(() => setToggleError(null), ERROR_DISPLAY_DURATION_MS);
  };

  const pluginTools = plugin.tools ?? [];

  const updatePluginTools = (updater: (tools: WireToolDef[]) => WireToolDef[]) =>
    setPlugins(prev => prev.map(p => (p.name === plugin.name ? { ...p, tools: updater(p.tools ?? []) } : p)));

  const applyPluginPermission = (newPermission: ToolPermission, reviewedVersion?: string) => {
    const myVersion = ++toggleCounter.current;
    pendingPluginRollbacks.current.set(myVersion, plugin.permission);
    setPlugins(prev =>
      prev.map(p =>
        p.name === plugin.name
          ? { ...p, permission: newPermission, ...(reviewedVersion ? { reviewed: true } : {}) }
          : p,
      ),
    );
    void setPluginPermission(plugin.name, newPermission, reviewedVersion)
      .catch(() => {
        const prev = pendingPluginRollbacks.current.get(myVersion);
        if (prev !== undefined) {
          setPlugins(ps => ps.map(p => (p.name === plugin.name ? { ...p, permission: prev } : p)));
        }
        showToggleError('Failed to update plugin permission');
      })
      .finally(() => {
        pendingPluginRollbacks.current.delete(myVersion);
      });
  };

  const handlePluginPermissionChange = (newPermission: ToolPermission) => {
    if (!plugin.reviewed && plugin.permission === 'off' && newPermission !== 'off') {
      setPendingChange({ permission: newPermission });
      return;
    }
    applyPluginPermission(newPermission);
  };

  const handleEnableAnyway = () => {
    if (!pendingChange) return;
    if (pendingChange.tool) {
      // Tool-level: mark plugin reviewed and apply the tool permission change
      applyPluginPermission(plugin.permission, plugin.version);
      applyToolPermission(pendingChange.tool, pendingChange.permission);
    } else {
      // Plugin-level: set permission and mark reviewed
      applyPluginPermission(pendingChange.permission, plugin.version);
    }
    setPendingChange(null);
  };

  const applyToolPermission = (toolName: string, newPermission: ToolPermission) => {
    const myVersion = ++toggleCounter.current;
    const currentPerm = pluginTools.find(t => t.name === toolName)?.permission ?? 'off';
    pendingToolRollbacks.current.set(myVersion, { toolName, prev: currentPerm });
    updatePluginTools(prev => prev.map(t => (t.name === toolName ? { ...t, permission: newPermission } : t)));
    void setToolPermission(plugin.name, toolName, newPermission)
      .catch(() => {
        const rollback = pendingToolRollbacks.current.get(myVersion);
        if (rollback) {
          updatePluginTools(prev =>
            prev.map(t => (t.name === rollback.toolName ? { ...t, permission: rollback.prev } : t)),
          );
        }
        showToggleError(`Failed to update ${toolName}`);
      })
      .finally(() => {
        pendingToolRollbacks.current.delete(myVersion);
      });
  };

  const handleToolPermissionChange = (toolName: string, newPermission: ToolPermission) => {
    if (!plugin.reviewed && newPermission !== 'off') {
      const currentToolPerm = pluginTools.find(t => t.name === toolName)?.permission ?? 'off';
      if (currentToolPerm === 'off') {
        setPendingChange({ permission: newPermission, tool: toolName });
        return;
      }
    }
    applyToolPermission(toolName, newPermission);
  };

  const filterLower = toolFilter?.toLowerCase() ?? '';
  const visibleTools = filterLower ? pluginTools.filter(t => matchesTool(t, filterLower)) : pluginTools;
  const hasActiveTool = pluginTools.some(t => activeTools.has(`${plugin.name}:${t.name}`));

  const toolGroups = groupTools(visibleTools);

  const inactive = plugin.tabState !== 'ready';
  const isUnconfigured = needsSetup(plugin.configSchema, plugin.resolvedSettings);

  const tabCount = plugin.tabs?.length ?? 0;
  const hasHomepage = Boolean(plugin.homepage);
  const hasLastSeenUrl = Boolean(plugin.hasLastSeenUrl);
  const isClickable = tabCount > 0 || hasHomepage || hasLastSeenUrl;

  const tooltipText = (() => {
    if (!isClickable) return undefined;
    if (plugin.tabState === 'closed') {
      if (hasHomepage) return `Open ${plugin.displayName} in new tab`;
      if (hasLastSeenUrl) return `Open ${plugin.displayName} (last visited)`;
      return undefined;
    }
    return tabCount > 1 ? `Open ${plugin.displayName} (${tabCount} tabs)` : `Open ${plugin.displayName}`;
  })();

  const handleOpenTab = () => {
    void openPluginTab(plugin.name);
  };

  const renderToolList = (tools: typeof pluginTools) =>
    tools.map(tool => (
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
    ));

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
        {tooltipText ? (
          <Tooltip>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                className="focus-ring flex shrink-0 cursor-pointer items-center py-2 pl-3"
                onClick={handleOpenTab}
                aria-label={tooltipText}>
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
                  className="transition-transform hover:scale-105"
                />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Content>{tooltipText}</Tooltip.Content>
          </Tooltip>
        ) : (
          <div className="flex shrink-0 items-center py-2 pl-3">
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
        )}
        <AccordionPrimitive.Trigger
          disabled={isUnconfigured}
          className={`focus-ring flex min-w-0 flex-1 items-center gap-2 py-2 pr-0 pl-2 [&[data-state=open]>svg]:rotate-180 ${isUnconfigured ? 'cursor-default' : 'cursor-pointer'}`}>
          <div
            className={`flex min-w-0 flex-1 items-center gap-1.5 truncate font-head text-sm ${inactive ? 'text-muted-foreground' : 'text-foreground'}`}>
            {plugin.displayName}
            {plugin.source === 'local' && (
              <Badge variant="default" size="sm" className="align-middle">
                DEV
              </Badge>
            )}
            {!plugin.reviewed && (
              <Tooltip>
                <Tooltip.Trigger asChild>
                  <ShieldQuestionMark className="inline-block h-3.5 w-3.5 align-middle text-muted-foreground" />
                </Tooltip.Trigger>
                <Tooltip.Content>This plugin version has not been reviewed</Tooltip.Content>
              </Tooltip>
            )}
            {plugin.hasPreScript && (
              <Tooltip>
                <Tooltip.Trigger asChild>
                  <FileCode className="inline-block h-3.5 w-3.5 align-middle text-muted-foreground" />
                </Tooltip.Trigger>
                <Tooltip.Content>This plugin runs a pre-script at document_start in MAIN world</Tooltip.Content>
              </Tooltip>
            )}
          </div>
          {!isUnconfigured && (
            <ChevronDown
              className={`h-4 w-4 shrink-0 transition-transform duration-200 ${inactive ? 'text-muted-foreground' : ''}`}
            />
          )}
        </AccordionPrimitive.Trigger>
        <PluginMenu
          plugin={plugin}
          onUpdate={onUpdate ?? (() => undefined)}
          onRemove={onRemove ?? (() => undefined)}
          updating={updatingPlugin ?? false}
          removing={removingPlugin ?? false}
          muted={inactive}
          className="flex shrink-0 items-center px-1"
          onConfigOpen={() => setConfigOpen(true)}
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
        {isUnconfigured ? (
          <div className="flex flex-col items-center gap-2 px-3 py-4">
            <p className="text-center text-muted-foreground text-xs">This plugin requires configuration before use.</p>
            <Button size="sm" onClick={() => setConfigOpen(true)}>
              <Settings className="mr-1.5 h-3.5 w-3.5" />
              Configure
            </Button>
          </div>
        ) : (
          <>
            {toolFilter && (
              <div className="mb-1 px-3 pt-2 text-muted-foreground text-xs">
                {visibleTools.length} of {pluginTools.length} tools
              </div>
            )}
            {toolGroups !== null
              ? toolGroups.map(group => (
                  <div key={group.name} className="[&:not(:first-child)]:mt-2">
                    <div className="border-border border-b border-l-2 border-l-primary bg-muted/30 px-3 py-1">
                      <span className="font-head text-muted-foreground text-xs uppercase tracking-wider">
                        {group.name}
                      </span>
                    </div>
                    {renderToolList(group.tools)}
                  </div>
                ))
              : renderToolList(visibleTools)}
          </>
        )}
      </Accordion.Content>

      {plugin.configSchema && Object.keys(plugin.configSchema).length > 0 && (
        <ConfigDialog
          open={configOpen}
          onOpenChange={setConfigOpen}
          pluginName={plugin.name}
          displayName={plugin.displayName}
          configSchema={plugin.configSchema}
          resolvedSettings={plugin.resolvedSettings}
        />
      )}

      <Dialog open={pendingChange !== null} onOpenChange={open => !open && setPendingChange(null)}>
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
