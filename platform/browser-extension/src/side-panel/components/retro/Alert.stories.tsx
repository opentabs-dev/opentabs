import type { Meta, StoryObj } from '@storybook/react';
import { ThemeGrid } from '../storybook-helpers';
import { Alert } from './Alert';

const meta: Meta<typeof Alert> = { title: 'Retro/Alert', component: Alert };

type Story = StoryObj<typeof Alert>;

const ErrorStory: Story = {
  render: () => (
    <Alert status="error">
      <Alert.Title>Error</Alert.Title>
      <Alert.Description>Something went wrong.</Alert.Description>
    </Alert>
  ),
};

const Success: Story = {
  render: () => (
    <Alert status="success">
      <Alert.Title>Success</Alert.Title>
      <Alert.Description>Done.</Alert.Description>
    </Alert>
  ),
};

const Warning: Story = {
  render: () => (
    <Alert status="warning">
      <Alert.Title>Warning</Alert.Title>
      <Alert.Description>Attention needed.</Alert.Description>
    </Alert>
  ),
};

const Info: Story = {
  render: () => (
    <Alert status="info">
      <Alert.Title>Info</Alert.Title>
      <Alert.Description>Additional info.</Alert.Description>
    </Alert>
  ),
};

const AllStatuses: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-3">
      {(['error', 'success', 'warning', 'info'] as const).map(status => (
        <Alert key={status} status={status}>
          <Alert.Title>{status.charAt(0).toUpperCase() + status.slice(1)}</Alert.Title>
          <Alert.Description>This is a {status} alert.</Alert.Description>
        </Alert>
      ))}
    </div>
  ),
};

const ThemePair: Story = {
  render: () => (
    <ThemeGrid>
      <div className="flex flex-col gap-3">
        <Alert status="error">
          <Alert.Title>Error</Alert.Title>
          <Alert.Description>Something went wrong.</Alert.Description>
        </Alert>
        <Alert status="success">
          <Alert.Title>Success</Alert.Title>
          <Alert.Description>Done.</Alert.Description>
        </Alert>
      </div>
    </ThemeGrid>
  ),
};

export default meta;
export { ErrorStory, Success, Warning, Info, AllStatuses, ThemePair };
