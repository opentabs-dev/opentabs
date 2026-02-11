import { z } from "zod";
import { defineTool, ToolError } from "@opentabs/plugin-sdk";

export const greet = defineTool({
  name: "greet",
  description:
    "Greet a person by name — tests input→output transformation via the server",
  input: z.object({
    name: z.string().describe("The name of the person to greet"),
  }),
  output: z.object({
    ok: z.boolean().describe("Whether the request succeeded"),
    greeting: z.string().describe("The computed greeting message"),
  }),
  handle: async (params) => {
    const res = await fetch("/api/greet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: params.name }),
    });
    const data = await res.json();
    if (!data.ok) {
      throw new ToolError(
        data.error ?? "Greet failed",
        data.error ?? "greet_failed"
      );
    }
    return { ok: data.ok, greeting: data.greeting };
  },
});
