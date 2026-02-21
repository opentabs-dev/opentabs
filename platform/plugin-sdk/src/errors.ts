// ---------------------------------------------------------------------------
// Shared error types for the SDK
// ---------------------------------------------------------------------------

/**
 * Typed error for tool handlers — the platform catches these
 * and returns structured MCP error responses.
 */
export class ToolError extends Error {
  constructor(
    message: string,
    /** Machine-readable error code (e.g., 'CHANNEL_NOT_FOUND') */
    public readonly code: string,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}
