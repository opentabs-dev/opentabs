import type { ConfigSchema } from '@opentabs-dev/shared';
import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { expect, within } from 'storybook/test';
import { ConfigDialog } from './ConfigDialog';
import { Button } from './retro/Button';
import { ThemeGrid } from './storybook-helpers';

const meta: Meta<typeof ConfigDialog> = {
  title: 'Components/ConfigDialog',
  component: ConfigDialog,
};

type Story = StoryObj<typeof ConfigDialog>;

const Wrapper = ({
  schema,
  resolved,
  displayName = 'SQLPad',
}: {
  schema: ConfigSchema;
  resolved?: Record<string, unknown>;
  displayName?: string;
}) => {
  const [open, setOpen] = useState(true);
  return (
    <div className="w-80">
      <Button size="sm" onClick={() => setOpen(true)}>
        Open Settings
      </Button>
      <ConfigDialog
        open={open}
        onOpenChange={setOpen}
        pluginName="sqlpad"
        displayName={displayName}
        configSchema={schema}
        resolvedSettings={resolved}
      />
    </div>
  );
};

const urlSchema: ConfigSchema = {
  instanceUrl: {
    type: 'url',
    label: 'Instance URL',
    description: 'The URL of your self-hosted instance',
    required: true,
    placeholder: 'https://sqlpad.example.com',
  },
};

const UrlField: Story = {
  render: () => <Wrapper schema={urlSchema} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Instance URL')).toBeVisible();
    await expect(canvas.getByText('*')).toBeVisible();
  },
};

const stringSchema: ConfigSchema = {
  apiToken: {
    type: 'string',
    label: 'API Token',
    description: 'Your personal API token for authentication',
    required: false,
    placeholder: 'sk-...',
  },
};

const StringField: Story = {
  render: () => <Wrapper schema={stringSchema} />,
};

const numberSchema: ConfigSchema = {
  maxResults: {
    type: 'number',
    label: 'Max Results',
    description: 'Maximum number of results to return per query',
    required: false,
    placeholder: '100',
  },
};

const NumberField: Story = {
  render: () => <Wrapper schema={numberSchema} />,
};

const booleanSchema: ConfigSchema = {
  enableNotifications: {
    type: 'boolean',
    label: 'Enable Notifications',
    description: 'Show desktop notifications for new events',
    required: false,
  },
};

const BooleanField: Story = {
  render: () => <Wrapper schema={booleanSchema} />,
};

const selectSchema: ConfigSchema = {
  environment: {
    type: 'select',
    label: 'Environment',
    description: 'Which environment to connect to',
    required: true,
    options: ['production', 'staging', 'development'],
  },
};

const SelectField: Story = {
  render: () => <Wrapper schema={selectSchema} />,
};

const preFilledSchema: ConfigSchema = {
  instanceUrl: {
    type: 'url',
    label: 'Instance URL',
    description: 'The URL of your self-hosted instance',
    required: true,
    placeholder: 'https://sqlpad.example.com',
  },
  apiToken: {
    type: 'string',
    label: 'API Token',
    required: false,
    placeholder: 'sk-...',
  },
  maxResults: {
    type: 'number',
    label: 'Max Results',
    required: false,
  },
  enableNotifications: {
    type: 'boolean',
    label: 'Enable Notifications',
    required: false,
  },
};

const PreFilledValues: Story = {
  render: () => (
    <Wrapper
      schema={preFilledSchema}
      resolved={{
        instanceUrl: { production: 'https://sqlpad.mycompany.com', staging: 'https://sqlpad.staging.mycompany.com' },
        apiToken: 'sk-abc123',
        maxResults: 50,
        enableNotifications: true,
      }}
    />
  ),
};

const allFieldsSchema: ConfigSchema = {
  instanceUrl: {
    type: 'url',
    label: 'Instance URL',
    description: 'The URL of your self-hosted instance',
    required: true,
    placeholder: 'https://sqlpad.example.com',
  },
  apiToken: {
    type: 'string',
    label: 'API Token',
    description: 'Your personal API token',
    required: false,
    placeholder: 'sk-...',
  },
  maxResults: {
    type: 'number',
    label: 'Max Results',
    description: 'Maximum number of results to return',
    required: false,
    placeholder: '100',
  },
  enableNotifications: {
    type: 'boolean',
    label: 'Enable Notifications',
    description: 'Show desktop notifications',
    required: false,
  },
  environment: {
    type: 'select',
    label: 'Environment',
    description: 'Which environment to connect to',
    required: true,
    options: ['production', 'staging', 'development'],
  },
};

const AllFieldTypes: Story = {
  render: () => <Wrapper schema={allFieldsSchema} displayName="All Fields Demo" />,
};

const AllFieldTypesThemePair: Story = {
  render: () => (
    <ThemeGrid>
      <Wrapper schema={allFieldsSchema} displayName="Theme Demo" />
    </ThemeGrid>
  ),
};

export default meta;
export {
  UrlField,
  StringField,
  NumberField,
  BooleanField,
  SelectField,
  PreFilledValues,
  AllFieldTypes,
  AllFieldTypesThemePair,
};
