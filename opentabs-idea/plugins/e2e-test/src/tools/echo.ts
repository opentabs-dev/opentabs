import { z } from "zod";
import { defineTool, ToolError } from "@opentabs/plugin-sdk";

export const echo = defineTool({
  name: "echo",
  description: "Echo a message back — simplest possible tool for E2E testing",
  input: z.object({
    message: z.string().describe("The message to echo back"),
  }),
  output: z.object({
    ok: z.boolean().describe("Whether the request succeeded"),
    message: z.string().describe("The echoed message"),
  }),
  handle: async (params) => {
    const res = await fetch("/api/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: params.message }),
    });
    const data = await res.json();
    if (!data.ok) {
      throw new ToolError(
        data.error ?? "Echo failed",
        data.error ?? "echo_failed"
      );
    }
    return { ok: data.ok, message: data.message };
  },
});
