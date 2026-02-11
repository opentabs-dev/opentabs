import { OpenTabsPlugin, type ToolDefinition } from "@opentabs/plugin-sdk";
import { echo } from "./tools/echo.js";
import { greet } from "./tools/greet.js";
import { listItems } from "./tools/list-items.js";
import { getStatus } from "./tools/get-status.js";
import { createItem } from "./tools/create-item.js";
import { failingTool } from "./tools/failing-tool.js";

class E2eTestPlugin extends OpenTabsPlugin {
  readonly name = "e2e-test";
  readonly version = "0.0.1";
  readonly description =
    "Dead-simple plugin for E2E testing — relays to a local test web server";
  readonly displayName = "E2E Test";
  readonly urlPatterns = ["http://localhost/*"];
  readonly tools: ToolDefinition[] = [
    echo,
    greet,
    listItems,
    getStatus,
    createItem,
    failingTool,
  ];

  /**
   * Readiness probe — calls the test server's auth endpoint via same-origin
   * fetch, exactly like a real plugin (e.g., Slack calls /api/auth.test).
   *
   * The test server's /api/auth.check returns { ok: true } when "logged in"
   * and { ok: false } when the test harness has toggled auth off.
   */
  async isReady(): Promise<boolean> {
    try {
      const res = await fetch("/api/auth.check", { method: "POST" });
      const data = await res.json();
      return data.ok === true;
    } catch {
      return false;
    }
  }
}

export default new E2eTestPlugin();
