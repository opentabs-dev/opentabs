import { Text } from './Text';
import { cn } from '../../lib/utils';
import { Ghost } from 'lucide-react';
import type { HTMLAttributes } from 'react';

interface IEmptyProps extends HTMLAttributes<HTMLDivElement> {
  className?: string;
}

const Empty = ({ className, ...props }: IEmptyProps) => (
  <div
    className={cn(
      'bg-card flex flex-col items-center justify-center rounded border-2 p-4 text-center shadow-md transition-all hover:shadow-none md:p-8',
      className,
    )}
    {...props}
  />
);
Empty.displayName = 'Empty';

const EmptyContent = ({ className, ...props }: IEmptyProps) => (
  <div className={cn('flex flex-col items-center gap-3', className)} {...props} />
);
EmptyContent.displayName = 'Empty.Content';

const EmptyIcon = ({ children, className, ...props }: IEmptyProps) => (
  <div className={cn(className)} {...props}>
    {children || <Ghost className="h-full w-full" />}
  </div>
);
EmptyIcon.displayName = 'Empty.Icon';

const EmptyTitle = ({ className, ...props }: IEmptyProps) => (
  <Text as="h3" className={cn('text-lg font-bold md:text-2xl', className)} {...props} />
);
EmptyTitle.displayName = 'Empty.Title';

const EmptySeparator = ({ className, ...props }: IEmptyProps) => (
  <div role="separator" className={cn('bg-primary h-1 w-full', className)} {...props} />
);
EmptySeparator.displayName = 'Empty.Separator';

const EmptyDescription = ({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn('text-muted-foreground max-w-[320px]', className)} {...props} />
);
EmptyDescription.displayName = 'Empty.Description';

const EmptyComponent = Object.assign(Empty, {
  Content: EmptyContent,
  Icon: EmptyIcon,
  Title: EmptyTitle,
  Separator: EmptySeparator,
  Description: EmptyDescription,
});

export { EmptyComponent as Empty };
