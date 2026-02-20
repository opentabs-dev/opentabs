import { Empty } from './retro/Empty.js';
import { Loader } from './retro/Loader.js';
import { Unplug } from 'lucide-react';

const DisconnectedState = () => (
  <Empty>
    <Empty.Content>
      <Empty.Icon>
        <Unplug className="text-muted-foreground h-12 w-12" />
      </Empty.Icon>
      <Empty.Title>Not Connected</Empty.Title>
      <Empty.Separator />
      <Empty.Description>Start the MCP server:</Empty.Description>
      <code className="border-border bg-muted rounded border-2 px-3 py-2 font-mono text-sm">
        bun --hot platform/mcp-server/dist/index.js
      </code>
    </Empty.Content>
  </Empty>
);

const LoadingState = () => (
  <div className="flex items-center justify-center py-16">
    <Loader size="md" />
  </div>
);

const EmptyState = () => (
  <Empty>
    <Empty.Content>
      <Empty.Title>No Plugins</Empty.Title>
      <Empty.Separator />
      <Empty.Description>Add a plugin path to ~/.opentabs/config.json or install one from npm.</Empty.Description>
    </Empty.Content>
  </Empty>
);

export { DisconnectedState, LoadingState, EmptyState };
