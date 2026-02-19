import { Wrench } from 'lucide-react';

interface ToolIconProps {
  toolName: string;
  className?: string;
}

const ToolIcon = ({ className = '' }: ToolIconProps) => (
  <Wrench className={`text-muted-foreground h-4 w-4 shrink-0 ${className}`} />
);

export { ToolIcon };
