import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { BrowserToolState } from '../bridge.js';
import { setAllBrowserToolsEnabled, setBrowserToolEnabled } from '../bridge.js';
import { ERROR_DISPLAY_DURATION_MS } from '../constants.js';
import { BrowserToolsMenu } from './BrowserToolsMenu.js';
import { PluginIcon } from './PluginIcon.js';
import { Accordion } from './retro/Accordion.js';
import { Alert } from './retro/Alert.js';
import { Badge } from './retro/Badge.js';
import { Switch } from './retro/Switch.js';
import { ToolRow } from './ToolRow.js';

/** Raw SVG string for the Chrome logo, rendered via PluginIcon's sanitized SVG path. */
const CHROME_ICON_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">',
  '<defs>',
  '<linearGradient id="chrome-a" x1="3.2173" y1="15" x2="44.7812" y2="15" gradientUnits="userSpaceOnUse">',
  '<stop offset="0" stop-color="#d93025"/><stop offset="1" stop-color="#ea4335"/>',
  '</linearGradient>',
  '<linearGradient id="chrome-b" x1="20.7219" y1="47.6791" x2="41.5039" y2="11.6837" gradientUnits="userSpaceOnUse">',
  '<stop offset="0" stop-color="#fcc934"/><stop offset="1" stop-color="#fbbc04"/>',
  '</linearGradient>',
  '<linearGradient id="chrome-c" x1="26.5981" y1="46.5015" x2="5.8161" y2="10.506" gradientUnits="userSpaceOnUse">',
  '<stop offset="0" stop-color="#1e8e3e"/><stop offset="1" stop-color="#34a853"/>',
  '</linearGradient>',
  '</defs>',
  '<circle cx="24" cy="23.9947" r="12" fill="#fff"/>',
  '<path d="M3.2154,36A24,24,0,1,0,12,3.2154,24,24,0,0,0,3.2154,36ZM34.3923,18A12,12,0,1,1,18,13.6077,12,12,0,0,1,34.3923,18Z" fill="none"/>',
  '<path d="M24,12H44.7812a23.9939,23.9939,0,0,0-41.5639.0029L13.6079,30l.0093-.0024A11.9852,11.9852,0,0,1,24,12Z" fill="url(#chrome-a)"/>',
  '<circle cx="24" cy="24" r="9.5" fill="#1a73e8"/>',
  '<path d="M34.3913,30.0029,24.0007,48A23.994,23.994,0,0,0,44.78,12.0031H23.9989l-.0025.0093A11.985,11.985,0,0,1,34.3913,30.0029Z" fill="url(#chrome-b)"/>',
  '<path d="M13.6086,30.0031,3.218,12.006A23.994,23.994,0,0,0,24.0025,48L34.3931,30.0029l-.0067-.0068a11.9852,11.9852,0,0,1-20.7778.007Z" fill="url(#chrome-c)"/>',
  '</svg>',
].join('');

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
  serverVersion,
}: {
  tools: BrowserToolState[];
  activeTools: Set<string>;
  onToolsChange: (updater: (tools: BrowserToolState[]) => BrowserToolState[]) => void;
  toolFilter?: string;
  serverVersion?: string;
}) => {
  const [toggleError, setToggleError] = useState<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toggleCounter = useRef(0);
  const preToggleRef = useRef<BrowserToolState[]>([]);

  useEffect(() => () => clearTimeout(errorTimerRef.current), []);

  const showToggleError = (message: string) => {
    clearTimeout(errorTimerRef.current);
    setToggleError(message);
    errorTimerRef.current = setTimeout(() => setToggleError(null), ERROR_DISPLAY_DURATION_MS);
  };

  const allEnabled = tools.length > 0 && tools.every(t => t.enabled);

  const handleToggleAll = (checked: boolean) => {
    const myVersion = ++toggleCounter.current;
    onToolsChange(prev => {
      preToggleRef.current = prev;
      return prev.map(t => ({ ...t, enabled: checked }));
    });
    void setAllBrowserToolsEnabled(checked).catch(() => {
      if (toggleCounter.current === myVersion) {
        onToolsChange(() => preToggleRef.current);
      }
      showToggleError('Failed to toggle all browser tools');
    });
  };

  const handleToggleTool = (toolName: string, currentEnabled: boolean) => {
    const myVersion = ++toggleCounter.current;
    const newEnabled = !currentEnabled;
    onToolsChange(prev => {
      preToggleRef.current = prev;
      return prev.map(t => (t.name === toolName ? { ...t, enabled: newEnabled } : t));
    });
    void setBrowserToolEnabled(toolName, newEnabled).catch(() => {
      if (toggleCounter.current === myVersion) {
        onToolsChange(() => preToggleRef.current);
      }
      showToggleError(`Failed to toggle ${toolName}`);
    });
  };

  const handleToggleGroup = (groupTools: BrowserToolState[], checked: boolean) => {
    const myVersion = ++toggleCounter.current;
    const groupToolNames = new Set(groupTools.map(t => t.name));
    onToolsChange(prev => {
      preToggleRef.current = prev;
      return prev.map(t => (groupToolNames.has(t.name) ? { ...t, enabled: checked } : t));
    });
    void Promise.all(groupTools.map(t => setBrowserToolEnabled(t.name, checked))).catch(() => {
      if (toggleCounter.current === myVersion) {
        onToolsChange(() => preToggleRef.current);
      }
      showToggleError('Failed to toggle group');
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
  const hasActiveTool = tools.some(t => activeTools.has(`browser:${t.name}`));

  // Group tools by their group field, preserving first-seen order
  const hasAnyGroup = visibleTools.some(t => t.group);
  const toolGroups: { name: string; tools: BrowserToolState[] }[] = [];
  if (hasAnyGroup) {
    const groupMap = new Map<string, BrowserToolState[]>();
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
    for (const [name, groupTools] of groupMap) {
      toolGroups.push({ name, tools: groupTools });
    }
    if (otherBucket) {
      toolGroups.push({ name: 'Other', tools: otherBucket });
    }
  }

  return (
    <Accordion.Item value="browser-tools">
      <AccordionPrimitive.Header className="flex">
        <AccordionPrimitive.Trigger className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 py-2 focus:outline-hidden [&[data-state=open]>svg.chevron]:rotate-180">
          <PluginIcon
            pluginName="browser"
            displayName="Browser"
            tabState="ready"
            size={32}
            iconSvg={CHROME_ICON_SVG}
            iconInactiveSvg={CHROME_ICON_SVG}
            active={hasActiveTool}
          />
          <div className="flex min-w-0 flex-1 items-center gap-1.5 truncate font-head text-foreground text-sm">
            Browser
            <Badge variant="default" size="sm" className="align-middle">
              CORE
            </Badge>
          </div>
          <ChevronDown className="chevron h-4 w-4 shrink-0 transition-transform duration-200" />
        </AccordionPrimitive.Trigger>
        <BrowserToolsMenu serverVersion={serverVersion} className="flex shrink-0 items-center px-1" />
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
        <Alert status="error" className="mx-3 mb-1 px-2 py-1 text-xs">
          {toggleError}
        </Alert>
      )}

      <Accordion.Content className="border-border border-t">
        {toolFilter && (
          <div className="mb-1 px-3 pt-2 text-muted-foreground text-xs">
            {visibleTools.length} of {tools.length} tools
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
                    checked={group.tools.every(t => t.enabled)}
                    onCheckedChange={checked => handleToggleGroup(group.tools, checked)}
                    aria-label={`Toggle all ${group.name} tools`}
                  />
                </div>
                {group.tools.map(tool => (
                  <ToolRow
                    key={tool.name}
                    name={tool.name}
                    displayName={toDisplayName(tool.name)}
                    description={tool.description}
                    icon={tool.icon ?? 'globe'}
                    enabled={tool.enabled}
                    active={activeTools.has(`browser:${tool.name}`)}
                    onToggle={() => handleToggleTool(tool.name, tool.enabled)}
                  />
                ))}
              </div>
            ))
          : visibleTools.map(tool => (
              <ToolRow
                key={tool.name}
                name={tool.name}
                displayName={toDisplayName(tool.name)}
                description={tool.description}
                icon={tool.icon ?? 'globe'}
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
