import getPort from 'get-port';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';

export interface MockSlackResponse {
  ok: boolean;
  [key: string]: unknown;
}

export interface MockSlackServer {
  port: number;
  url: string;
  addMock: (method: string, response: MockSlackResponse) => void;
  clearMocks: () => void;
  getRequests: () => Array<{ method: string; params: Record<string, unknown> }>;
  stop: () => Promise<void>;
}

/**
 * Create a mock Slack API server for testing
 *
 * This allows E2E tests to verify API calls without hitting real Slack.
 * The mock server captures requests and returns configured responses.
 */
export const createMockSlackServer = async (): Promise<MockSlackServer> => {
  const port = await getPort();
  const mocks = new Map<string, MockSlackResponse>();
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Parse the request
    const url = new URL(req.url || '/', `http://localhost:${port}`);
    const pathname = url.pathname;

    // Extract method name from path (e.g., /api/conversations.list -> conversations.list)
    const method = pathname.replace(/^\/api\//, '').replace(/\/$/, '');

    // Collect body for POST requests
    let body = '';
    if (req.method === 'POST') {
      for await (const chunk of req) {
        body += chunk;
      }
    }

    // Parse params from body or URL
    let params: Record<string, unknown> = {};
    if (body) {
      try {
        if (req.headers['content-type']?.includes('application/json')) {
          params = JSON.parse(body);
        } else {
          // Form data
          const formParams = new URLSearchParams(body);
          for (const [key, value] of formParams) {
            params[key] = value;
          }
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Record the request
    requests.push({ method, params });

    // Return mock response or default error
    const mockResponse = mocks.get(method);
    if (mockResponse) {
      res.writeHead(200);
      res.end(JSON.stringify(mockResponse));
    } else {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: false, error: 'method_not_mocked' }));
    }
  };

  const server: Server = createServer(handler);

  await new Promise<void>((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    addMock: (method: string, response: MockSlackResponse) => {
      mocks.set(method, response);
    },
    clearMocks: () => {
      mocks.clear();
    },
    getRequests: () => [...requests],
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close(err => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
};
