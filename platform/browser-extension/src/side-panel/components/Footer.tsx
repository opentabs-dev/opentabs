import { Badge } from './retro/Badge.js';

const Footer = ({ connected }: { connected: boolean }) => (
  <footer className="border-border bg-background text-muted-foreground sticky bottom-0 flex items-center justify-between border-t-2 px-3 py-2 text-xs">
    {connected ? (
      <Badge variant="default" size="sm">
        Connected
      </Badge>
    ) : (
      <Badge variant="outline" size="sm" className="text-destructive outline-destructive">
        Disconnected
      </Badge>
    )}
    <a
      href="https://github.com/opentabs-dev/opentabs"
      target="_blank"
      rel="noopener noreferrer"
      className="decoration-primary hover:text-foreground underline-offset-2 transition-colors hover:underline">
      Feedback
    </a>
  </footer>
);

export { Footer };
