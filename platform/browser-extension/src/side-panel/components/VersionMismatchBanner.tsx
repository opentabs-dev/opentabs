import { Alert } from './retro/Alert.js';

const VersionMismatchBanner = () => (
  <Alert status="warning">
    <Alert.Title>Version Mismatch</Alert.Title>
    <Alert.Description>Restart the MCP server for best results.</Alert.Description>
  </Alert>
);

export { VersionMismatchBanner };
