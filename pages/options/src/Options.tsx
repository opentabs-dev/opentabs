import '@src/index.css';
import { CategorySelect, RetroToast, SearchInput, ToolList } from './components';
import {
  ALL_TOOLS,
  DATADOG_CATEGORIES,
  DATADOG_TOOLS,
  LOGROCKET_CATEGORIES,
  LOGROCKET_TOOLS,
  RETOOL_CATEGORIES,
  RETOOL_TOOLS,
  SERVICE_TABS,
  SLACK_CATEGORIES,
  SLACK_TOOLS,
  SNOWFLAKE_CATEGORIES,
  SNOWFLAKE_TOOLS,
  SQLPAD_CATEGORIES,
  SQLPAD_TOOLS,
} from './tools';
import { Defaults, MessageTypes } from '@extension/shared';
import {
  cn,
  RetroButton,
  RetroCard,
  RetroCardContent,
  RetroInput,
  RetroSelect,
  RetroSelectContent,
  RetroSelectItem,
  RetroSelectTrigger,
  RetroSelectValue,
} from '@extension/ui';
import { Check, Settings } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type {
  DatadogCategoryId,
  DatadogTool,
  LogrocketCategoryId,
  LogrocketTool,
  RetoolCategoryId,
  RetoolTool,
  SlackCategoryId,
  SlackTool,
  SnowflakeCategoryId,
  SnowflakeTool,
  SqlpadCategoryId,
  SqlpadTool,
  ToolPermissions,
} from './tools';

// =============================================================================
// Constants
// =============================================================================

const TOAST_DURATION = 2000;

// =============================================================================
// Main Component
// =============================================================================

const Options = () => {
  const [loading, setLoading] = useState(true);
  const [port, setPort] = useState(String(Defaults.WS_PORT));
  const [savedPort, setSavedPort] = useState(String(Defaults.WS_PORT));
  const [portSaved, setPortSaved] = useState(false);
  const [portError, setPortError] = useState('');
  const [permissions, setPermissions] = useState<ToolPermissions>(() => {
    const defaults: ToolPermissions = {};
    for (const tool of ALL_TOOLS) {
      defaults[tool.id] = true;
    }
    return defaults;
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [activeService, setActiveService] = useState('slack');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const handleServiceChange = (service: string) => {
    setActiveService(service);
    setSelectedCategory('all');
  };

  const activeCategories =
    activeService === 'slack'
      ? SLACK_CATEGORIES
      : activeService === 'datadog'
        ? DATADOG_CATEGORIES
        : activeService === 'sqlpad'
          ? SQLPAD_CATEGORIES
          : activeService === 'logrocket'
            ? LOGROCKET_CATEGORIES
            : activeService === 'retool'
              ? RETOOL_CATEGORIES
              : SNOWFLAKE_CATEGORIES;

  const [toastMessage, setToastMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const showToast = (message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    setToastVisible(true);
    toastTimerRef.current = setTimeout(() => setToastVisible(false), TOAST_DURATION);
  };

  useEffect(() => {
    chrome.storage.sync.get(['wsPort', 'toolPermissions'], result => {
      if (chrome.runtime.lastError) {
        console.error('Failed to load settings:', chrome.runtime.lastError.message);
        setLoading(false);
        return;
      }
      if (result.wsPort) {
        setPort(String(result.wsPort));
        setSavedPort(String(result.wsPort));
      }
      if (result.toolPermissions) {
        setPermissions(prev => ({ ...prev, ...(result.toolPermissions as ToolPermissions) }));
      }
      setLoading(false);
    });
  }, []);

  const portChanged = port !== savedPort;

  const validatePort = (value: string): string => {
    const portNum = parseInt(value, 10);
    if (value === '' || isNaN(portNum)) return 'Enter a valid number';
    if (portNum < 1 || portNum > 65535) return 'Port must be 1\u201365535';
    return '';
  };

  const handlePortChange = (value: string) => {
    setPort(value);
    setPortError(validatePort(value));
  };

  const handlePortSave = () => {
    const error = validatePort(port);
    if (error) {
      setPortError(error);
      return;
    }
    const portNum = parseInt(port, 10);
    chrome.storage.sync.set({ wsPort: portNum }, () => {
      if (chrome.runtime.lastError) {
        console.error('Failed to save port:', chrome.runtime.lastError.message);
        return;
      }
      setSavedPort(port);
      setPortSaved(true);
      setPortError('');
      setTimeout(() => setPortSaved(false), 2000);
      chrome.runtime.sendMessage({ type: MessageTypes.SET_PORT, port: portNum });
    });
  };

  const toggleTool = (toolId: string) => {
    const newPermissions = { ...permissions, [toolId]: !permissions[toolId] };
    setPermissions(newPermissions);
    chrome.storage.sync.set({ toolPermissions: newPermissions }, () => {
      if (chrome.runtime.lastError) {
        console.error('Failed to save tool permissions:', chrome.runtime.lastError.message);
        return;
      }
      const toolName = ALL_TOOLS.find(t => t.id === toolId)?.name ?? toolId;
      showToast(`${toolName} ${newPermissions[toolId] ? 'enabled' : 'disabled'}`);
    });
  };

  const batchToggleTools = (toolIds: string[], enabled: boolean) => {
    const updates: ToolPermissions = {};
    for (const id of toolIds) {
      updates[id] = enabled;
    }
    const newPermissions = { ...permissions, ...updates };
    setPermissions(newPermissions);
    chrome.storage.sync.set({ toolPermissions: newPermissions }, () => {
      if (chrome.runtime.lastError) {
        console.error('Failed to save tool permissions:', chrome.runtime.lastError.message);
        return;
      }
      showToast(`${toolIds.length} tools ${enabled ? 'enabled' : 'disabled'}`);
    });
  };

  const activeTab = SERVICE_TABS.find(t => t.id === activeService) ?? SERVICE_TABS[0];

  const servicePickerNode = (
    <RetroSelect value={activeService} onValueChange={handleServiceChange}>
      <RetroSelectTrigger className="w-44">
        <div className="flex items-center gap-2">
          <img src={chrome.runtime.getURL(activeTab.icon)} alt={activeTab.label} className="h-4 w-4" />
          <RetroSelectValue>{activeTab.label}</RetroSelectValue>
        </div>
      </RetroSelectTrigger>
      <RetroSelectContent>
        {SERVICE_TABS.map(tab => (
          <RetroSelectItem key={tab.id} value={tab.id}>
            <div className="flex items-center gap-2">
              <img src={chrome.runtime.getURL(tab.icon)} alt={tab.label} className="h-4 w-4" />
              <span>{tab.label}</span>
            </div>
          </RetroSelectItem>
        ))}
      </RetroSelectContent>
    </RetroSelect>
  );

  return (
    <div className="bg-background flex h-screen flex-col overflow-hidden">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col overflow-hidden p-6">
        {/* Header */}
        <div className="mb-8 flex items-center gap-4">
          <div className="bg-primary border-border flex h-14 w-14 items-center justify-center border-2 shadow-md">
            <Settings className="text-primary-foreground h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
            <p className="text-muted-foreground text-sm">Configure your OpenTabs preferences</p>
          </div>
        </div>

        {/* Content */}
        <div className={cn('flex min-h-0 flex-1 flex-col space-y-8 transition-opacity', loading && 'opacity-0')}>
          {/* Connection Settings */}
          <section className="shrink-0">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
              <span className="bg-primary text-primary-foreground border-border border-2 px-2 py-0.5 shadow-sm">
                Connection
              </span>
            </h2>
            <RetroCard>
              <RetroCardContent className="flex items-center justify-between py-4">
                <div>
                  <p className="font-semibold">WebSocket Port</p>
                  <p className="text-muted-foreground text-sm">Default: {Defaults.WS_PORT}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="flex items-center gap-3">
                    <RetroInput
                      type="number"
                      value={port}
                      onChange={e => handlePortChange(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handlePortSave()}
                      min={1}
                      max={65535}
                      className="w-28"
                      aria-invalid={portError ? true : undefined}
                    />
                    <RetroButton
                      onClick={handlePortSave}
                      disabled={!portChanged || !!portError}
                      variant={portSaved ? 'ghost' : 'default'}
                      className={cn(portSaved && 'border-green-600 bg-green-500 text-white')}>
                      {portSaved ? <Check className="h-4 w-4" /> : 'Save'}
                    </RetroButton>
                  </div>
                  {portError && portChanged && (
                    <span className="text-destructive text-xs font-semibold">{portError}</span>
                  )}
                </div>
              </RetroCardContent>
            </RetroCard>
          </section>

          {/* Tool Permissions */}
          <section className="flex min-h-0 flex-1 flex-col">
            <h2 className="mb-4 flex shrink-0 items-center gap-2 text-lg font-bold">
              <span className="bg-primary text-primary-foreground border-border border-2 px-2 py-0.5 shadow-sm">
                Tool Permissions
              </span>
            </h2>

            {/* Toolbar: service picker + search (outside Activity so always visible) */}
            <div className="mb-4 flex shrink-0 flex-wrap items-center gap-3">
              {servicePickerNode}
              <SearchInput value={searchQuery} onChange={setSearchQuery} onClear={() => setSearchQuery('')} />
              <CategorySelect
                categories={activeCategories}
                selected={selectedCategory}
                onSelect={setSelectedCategory}
              />
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              {activeService === 'slack' && (
                <ToolList<SlackTool, SlackCategoryId>
                  tools={SLACK_TOOLS}
                  categories={SLACK_CATEGORIES}
                  permissions={permissions}
                  searchQuery={searchQuery}
                  selectedCategory={selectedCategory}
                  onToggle={toggleTool}
                  onBatchToggle={batchToggleTools}
                />
              )}
              {activeService === 'datadog' && (
                <ToolList<DatadogTool, DatadogCategoryId>
                  tools={DATADOG_TOOLS}
                  categories={DATADOG_CATEGORIES}
                  permissions={permissions}
                  searchQuery={searchQuery}
                  selectedCategory={selectedCategory}
                  onToggle={toggleTool}
                  onBatchToggle={batchToggleTools}
                />
              )}
              {activeService === 'sqlpad' && (
                <ToolList<SqlpadTool, SqlpadCategoryId>
                  tools={SQLPAD_TOOLS}
                  categories={SQLPAD_CATEGORIES}
                  permissions={permissions}
                  searchQuery={searchQuery}
                  selectedCategory={selectedCategory}
                  onToggle={toggleTool}
                  onBatchToggle={batchToggleTools}
                />
              )}
              {activeService === 'logrocket' && (
                <ToolList<LogrocketTool, LogrocketCategoryId>
                  tools={LOGROCKET_TOOLS}
                  categories={LOGROCKET_CATEGORIES}
                  permissions={permissions}
                  searchQuery={searchQuery}
                  selectedCategory={selectedCategory}
                  onToggle={toggleTool}
                  onBatchToggle={batchToggleTools}
                />
              )}
              {activeService === 'retool' && (
                <ToolList<RetoolTool, RetoolCategoryId>
                  tools={RETOOL_TOOLS}
                  categories={RETOOL_CATEGORIES}
                  permissions={permissions}
                  searchQuery={searchQuery}
                  selectedCategory={selectedCategory}
                  onToggle={toggleTool}
                  onBatchToggle={batchToggleTools}
                />
              )}
              {activeService === 'snowflake' && (
                <ToolList<SnowflakeTool, SnowflakeCategoryId>
                  tools={SNOWFLAKE_TOOLS}
                  categories={SNOWFLAKE_CATEGORIES}
                  permissions={permissions}
                  searchQuery={searchQuery}
                  selectedCategory={selectedCategory}
                  onToggle={toggleTool}
                  onBatchToggle={batchToggleTools}
                />
              )}
            </div>
          </section>
        </div>
      </div>

      <RetroToast message={toastMessage} visible={toastVisible} />
    </div>
  );
};

export default Options;
