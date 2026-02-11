import { z } from "zod";
import { defineTool, ToolError } from "@opentabs/plugin-sdk";

export const listItems = defineTool({
  name: "list_items",
  description:
    "List items from the test server with optional pagination — mirrors patterns like Slack's conversations.list",
  input: z.object({
    limit: z
      .number()
      .optional()
      .describe("Maximum number of items to return (default 10, max 100)"),
    offset: z
      .number()
      .optional()
      .describe("Offset for pagination (default 0)"),
  }),
  output: z.object({
    ok: z.boolean().describe("Whether the request succeeded"),
    items: z
      .array(
        z.object({
          id: z.string().describe("Unique item identifier"),
          name: z.string().describe("Item name"),
        })
      )
      .describe("Array of items"),
    total: z.number().describe("Total number of items available"),
  }),
  handle: async (params) => {
    const body: Record<string, unknown> = {
      limit: params.limit ?? 10,
      offset: params.offset ?? 0,
    };
    const res = await fetch("/api/list-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) {
      throw new ToolError(
        data.error ?? "Failed to list items",
        data.error ?? "list_items_failed"
      );
    }
    return { ok: data.ok, items: data.items, total: data.total };
  },
});
