'use client';

import { Button } from './retroui';
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

const CopyableCommand = ({ command }: { command: string }) => {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(command).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group flex items-center justify-between gap-2">
      <code className="flex-1">{command}</code>
      <Button size="sm" onClick={copyToClipboard} className="hidden md:block" title="Copy to clipboard">
        {copied ? 'Copied' : 'Copy'}
      </Button>
      <Button className="md:hidden" size="icon" onClick={copyToClipboard} title="Copy to clipboard mobile">
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
};

export const CliCommand = ({
  npmCommand,
  yarnCommand,
  pnpmCommand,
  bunCommand,
}: {
  npmCommand: string;
  yarnCommand?: string;
  pnpmCommand?: string;
  bunCommand?: string;
}) => {
  const isNpx = npmCommand.includes('npx');
  const resolvedPnpm =
    pnpmCommand ?? (isNpx ? npmCommand.replace('npx', 'pnpm dlx') : npmCommand.replace('npm', 'pnpm'));
  const resolvedYarn =
    yarnCommand ?? (isNpx ? npmCommand.replace('npx', 'yarn dlx') : npmCommand.replace('npm install', 'yarn add'));
  const resolvedBun = bunCommand ?? (isNpx ? npmCommand.replace('npx', 'bunx') : npmCommand.replace('npm', 'bun'));

  return (
    <TabGroup className="bg-secondary text-secondary-foreground/90 my-2 rounded-(--radius) p-4">
      <TabList className="mb-6 flex space-x-4 text-sm">
        <Tab className="text-muted-foreground border-accent data-selected:text-secondary-foreground relative cursor-pointer bg-transparent px-2 py-1 focus:outline-hidden data-selected:border-b-2">
          npm
        </Tab>
        <Tab className="text-muted-foreground border-accent data-selected:text-secondary-foreground relative cursor-pointer bg-transparent px-2 py-1 focus:outline-hidden data-selected:border-b-2">
          pnpm
        </Tab>
        <Tab className="text-muted-foreground border-accent data-selected:text-secondary-foreground relative cursor-pointer bg-transparent px-2 py-1 focus:outline-hidden data-selected:border-b-2">
          yarn
        </Tab>
        <Tab className="text-muted-foreground border-accent data-selected:text-secondary-foreground relative cursor-pointer bg-transparent px-2 py-1 focus:outline-hidden data-selected:border-b-2">
          bun
        </Tab>
      </TabList>
      <TabPanels className="text-accent-foreground text-sm">
        <TabPanel>
          <CopyableCommand command={npmCommand} />
        </TabPanel>
        <TabPanel>
          <CopyableCommand command={resolvedPnpm} />
        </TabPanel>
        <TabPanel>
          <CopyableCommand command={resolvedYarn} />
        </TabPanel>
        <TabPanel>
          <CopyableCommand command={resolvedBun} />
        </TabPanel>
      </TabPanels>
    </TabGroup>
  );
};
