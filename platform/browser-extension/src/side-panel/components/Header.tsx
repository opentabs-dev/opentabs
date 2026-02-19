import { Badge } from './retro/Badge.js';
import { Zap } from 'lucide-react';

const Header = ({ connected }: { connected: boolean }) => (
  <header className="border-border bg-background flex items-center justify-between border-b-2 px-4 py-3 shadow-sm">
    <div className="flex items-center gap-2">
      <Zap className="text-foreground h-5 w-5" />
      <h1 className="font-head text-foreground text-base tracking-tight">OpenTabs</h1>
    </div>
    {connected ? (
      <Badge variant="surface" size="sm">
        Connected
      </Badge>
    ) : (
      <Badge variant="outline" size="sm" className="text-destructive outline-destructive">
        Disconnected
      </Badge>
    )}
  </header>
);

export { Header };
