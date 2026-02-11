import { z } from "zod";
import { defineTool, ToolError } from "@opentabs/plugin-sdk";

export const getStatus = defineTool({
  name: "get_status",
  description:
    "Get the current status of the test server — tests zero-input tools (similar to Slack's auth.test)",
  input: z.object({}),
  output: z.object({
    ok: z.boolean().describe("Whether the server is reachable and responding"),
    authenticated: z
      .boolean()
      .describe("Whether the current session is authenticated"),
    uptime: z.number().describe("Server uptime in seconds"),
    version: z.string().describe("Server version string"),
  }),
  handle: async () => {
    const res = await fetch("/api/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!data.ok) {
      throw new ToolError(
        data.error ?? "Failed to get status",
        data.error ?? "status_failed"
      );
    }
    return {
      ok: data.ok,
      authenticated: data.authenticated,
      uptime: data.uptime,
      version: data.version,
    };
  },
});
