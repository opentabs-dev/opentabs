import { z } from "zod";
import { defineTool, ToolError } from "@opentabs/plugin-sdk";

export const createItem = defineTool({
  name: "create_item",
  description:
    "Create a new item on the test server — tests write operations (similar to Slack's conversations.create)",
  input: z.object({
    name: z.string().describe("Name for the new item"),
    description: z
      .string()
      .optional()
      .describe("Optional description for the item"),
  }),
  output: z.object({
    ok: z.boolean().describe("Whether the item was created successfully"),
    item: z
      .object({
        id: z.string().describe("Unique identifier of the created item"),
        name: z.string().describe("Name of the created item"),
        description: z.string().describe("Description of the created item"),
        created_at: z
          .string()
          .describe("ISO 8601 timestamp of when the item was created"),
      })
      .describe("The newly created item"),
  }),
  handle: async (params) => {
    const res = await fetch("/api/create-item", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: params.name,
        description: params.description ?? "",
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      throw new ToolError(
        data.error ?? "Failed to create item",
        data.error ?? "create_item_failed"
      );
    }
    return {
      ok: data.ok,
      item: {
        id: data.item.id,
        name: data.item.name,
        description: data.item.description ?? "",
        created_at: data.item.created_at,
      },
    };
  },
});
