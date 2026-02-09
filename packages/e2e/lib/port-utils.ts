import getPort from 'get-port';

/**
 * Get available ports for MCP server testing
 */
export const getAvailablePorts = async (): Promise<{
  wsPort: number;
  httpPort: number;
}> => {
  // Get two unused ports that won't conflict with each other
  const wsPort = await getPort();
  const httpPort = await getPort({ exclude: [wsPort] });

  return { wsPort, httpPort };
};
