import {
  cn,
  RetroButton,
  RetroCard,
  RetroInput,
  RetroSelect,
  RetroSelectContent,
  RetroSelectItem,
  RetroSelectTrigger,
  RetroSelectValue,
  RetroSwitch,
} from '@extension/ui';
import { Search, Settings, X } from 'lucide-react';
import type { CategoryDef, Tool, ToolPermissions } from './tools';
import type { LucideIcon } from 'lucide-react';

// =============================================================================
// CategorySelect
// =============================================================================

const CategorySelect = <T extends string>({
  categories,
  selected,
  onSelect,
}: {
  categories: Array<CategoryDef<T>>;
  selected: T | 'all';
  onSelect: (id: T | 'all') => void;
}) => {
  const selectedCategory = categories.find(c => c.id === selected) ?? categories[0];
  const Icon = selectedCategory.icon;

  return (
    <RetroSelect value={selected} onValueChange={value => onSelect(value as T | 'all')}>
      <RetroSelectTrigger className="w-44">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5" />
          <RetroSelectValue>{selectedCategory.name}</RetroSelectValue>
        </div>
      </RetroSelectTrigger>
      <RetroSelectContent>
        {categories.map(cat => (
          <RetroSelectItem key={cat.id} value={cat.id}>
            <div className="flex items-center gap-2">
              <cat.icon className="h-3.5 w-3.5" />
              {cat.name}
            </div>
          </RetroSelectItem>
        ))}
      </RetroSelectContent>
    </RetroSelect>
  );
};

// =============================================================================
// SearchInput
// =============================================================================

const SearchInput = ({
  value,
  onChange,
  onClear,
}: {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
}) => (
  <div className="relative flex-1">
    <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
    <RetroInput
      type="text"
      placeholder="Search tools..."
      value={value}
      onChange={e => onChange(e.target.value)}
      className="pr-8 pl-10"
    />
    {value && (
      <button
        onClick={onClear}
        className="text-muted-foreground hover:text-foreground hover:bg-primary hover:text-primary-foreground absolute top-1/2 right-2 -translate-y-1/2 p-1 transition-colors">
        <X className="h-4 w-4" />
      </button>
    )}
  </div>
);

// =============================================================================
// ToolItem
// =============================================================================

const ToolItem = ({
  tool,
  enabled,
  onToggle,
  categoryIcon: Icon,
}: {
  tool: Tool;
  enabled: boolean;
  onToggle: () => void;
  categoryIcon: LucideIcon;
}) => (
  <div className="hover:bg-accent/30 flex items-center gap-3 px-4 py-3 transition-colors">
    <div
      className={cn(
        'border-border flex h-10 w-10 shrink-0 items-center justify-center border-2',
        enabled ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground',
      )}>
      <Icon className="h-4 w-4" />
    </div>

    <div className="min-w-0 flex-1">
      <p className={cn('text-sm font-semibold', !enabled && 'text-muted-foreground')}>{tool.name}</p>
      <p className="text-muted-foreground mt-0.5 truncate text-xs">{tool.description}</p>
    </div>

    <RetroSwitch checked={enabled} onCheckedChange={onToggle} />
  </div>
);

// =============================================================================
// ToolList
// =============================================================================

interface ToolListProps<T extends Tool, C extends string> {
  tools: readonly T[];
  categories: Array<CategoryDef<C>>;
  permissions: ToolPermissions;
  searchQuery: string;
  selectedCategory: string;
  onToggle: (toolId: string) => void;
  onBatchToggle: (toolIds: string[], enabled: boolean) => void;
}

const ToolList = <T extends Tool, C extends string>({
  tools,
  categories,
  permissions,
  searchQuery,
  selectedCategory,
  onToggle,
  onBatchToggle,
}: ToolListProps<T, C>) => {
  const filteredTools = tools.filter(tool => {
    const matchesCategory = selectedCategory === 'all' || tool.category === selectedCategory;
    const matchesSearch =
      searchQuery === '' ||
      tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.id.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const enabledCount = filteredTools.filter(t => permissions[t.id] ?? true).length;
  const allEnabled = enabledCount === filteredTools.length;
  const allDisabled = enabledCount === 0;

  const handleEnableAll = () => {
    onBatchToggle(
      filteredTools.map(t => t.id),
      true,
    );
  };

  const handleDisableAll = () => {
    onBatchToggle(
      filteredTools.map(t => t.id),
      false,
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {filteredTools.length > 0 && (
        <div className="mb-3 flex shrink-0 items-center justify-between">
          <span className="text-muted-foreground text-xs font-semibold">
            {enabledCount}/{filteredTools.length} enabled
          </span>
          <div className="flex items-center gap-2">
            <RetroButton variant="outline" size="sm" onClick={handleEnableAll} disabled={allEnabled}>
              Enable All
            </RetroButton>
            <RetroButton variant="outline" size="sm" onClick={handleDisableAll} disabled={allDisabled}>
              Disable All
            </RetroButton>
          </div>
        </div>
      )}

      <RetroCard className="flex min-h-0 flex-1 flex-col p-0">
        {filteredTools.length === 0 ? (
          <div className="text-muted-foreground py-12 text-center">
            <Search className="mx-auto mb-2 h-8 w-8 opacity-50" />
            <p className="font-medium">No tools match your search</p>
          </div>
        ) : (
          <div className="divide-border divide-y overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
            {filteredTools.map(tool => {
              const category = categories.find(c => c.id === tool.category);
              return (
                <ToolItem
                  key={tool.id}
                  tool={tool}
                  enabled={permissions[tool.id] ?? true}
                  onToggle={() => onToggle(tool.id)}
                  categoryIcon={category?.icon ?? Settings}
                />
              );
            })}
          </div>
        )}
      </RetroCard>
    </div>
  );
};

// =============================================================================
// RetroToast
// =============================================================================

const RetroToast = ({ message, visible }: { message: string; visible: boolean }) => (
  <div
    className={cn(
      'bg-primary text-primary-foreground border-border pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 border-2 px-4 py-2 text-sm font-semibold shadow-md transition-all duration-200',
      visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
    )}>
    {message}
  </div>
);

// =============================================================================
// Exports
// =============================================================================

export { CategorySelect, RetroToast, SearchInput, ToolList };
