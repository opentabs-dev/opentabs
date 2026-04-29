import * as DialogPrimitive from '@radix-ui/react-dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { X } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = ({ className, ref, ...props }: ComponentProps<typeof DialogPrimitive.Overlay>) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 fixed inset-0 z-50 bg-black/80 font-head data-[state=closed]:animate-out data-[state=open]:animate-in',
      className,
    )}
    {...props}
  />
);

const DialogContent = ({ className, children, ref, ...props }: ComponentProps<typeof DialogPrimitive.Content>) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 fixed top-1/2 left-1/2 z-50 grid w-full max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded border-2 border-border bg-background shadow-md duration-200 data-[state=closed]:animate-out data-[state=open]:animate-in',
        className,
      )}
      {...props}>
      <VisuallyHidden>
        <DialogPrimitive.Title />
        <DialogPrimitive.Description />
      </VisuallyHidden>
      <div className="relative flex flex-col">{children}</div>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
);

const DialogHeader = ({ className, children, ref, ...props }: ComponentProps<'div'>) => (
  <div
    ref={ref}
    className={cn(
      'flex min-h-10 items-center justify-between border-border border-b-2 bg-primary px-4 text-primary-foreground',
      className,
    )}
    {...props}>
    {children}
    <DialogPrimitive.Close className="cursor-pointer outline-none" aria-label="Close">
      <X className="h-4 w-4" />
    </DialogPrimitive.Close>
  </div>
);

const DialogBody = ({ className, ref, ...props }: ComponentProps<'div'>) => (
  <div ref={ref} className={cn('px-4 py-3', className)} {...props} />
);

const DialogFooter = ({ className, ref, ...props }: ComponentProps<'div'>) => (
  <div
    ref={ref}
    className={cn('flex items-center justify-end gap-2 border-border border-t-2 px-4 py-2', className)}
    {...props}
  />
);

const DialogDescription = DialogPrimitive.Description;

const DialogObject = Object.assign(Dialog, {
  Trigger: DialogTrigger,
  Close: DialogClose,
  Content: DialogContent,
  Header: DialogHeader,
  Body: DialogBody,
  Footer: DialogFooter,
  Description: DialogDescription,
});

export { DialogObject as Dialog };
