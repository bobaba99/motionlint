import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const BIN = resolve("dist/index.js");

interface RpcResponse { id: number; result?: { tools?: Array<{ name: string }>; resources?: Array<{ uri: string }> } & Record<string, unknown>; error?: unknown }

function rpcExchange(messages: object[], timeoutMs = 5_000): Promise<RpcResponse[]> {
  return new Promise((resolveP, reject) => {
    const child = spawn("node", [BIN, "mcp"], { stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    const out: RpcResponse[] = [];
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      child.kill();
      err ? reject(err) : resolveP(out);
    };
    const timer = setTimeout(() => finish(new Error("MCP smoke test timed out")), timeoutMs);
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          out.push(JSON.parse(line) as RpcResponse);
          if (out.length >= messages.length) {
            clearTimeout(timer);
            finish();
          }
        } catch { /* ignore non-json */ }
      }
    });
    child.on("error", finish);
    for (const m of messages) child.stdin.write(JSON.stringify(m) + "\n");
  });
}

describe("MCP server smoke test", () => {
  it("initializes, lists tools, and exposes the expected tool surface", async () => {
    const responses = await rpcExchange([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "resources/list" },
    ]);
    assert.equal(responses.length, 3);
    const init = responses.find((r) => r.id === 1);
    assert.ok(init?.result, "initialize must return a result");
    const tools = responses.find((r) => r.id === 2)?.result?.tools as Array<{ name: string }> | undefined;
    assert.ok(tools, "tools/list must return a tools array");
    const names = tools!.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "get_latest_report",
      "review_flow",
      "review_routes",
      "review_url",
      "tune_animations",
    ], `expected the full tool surface, got: ${names.join(", ")}`);
    const resources = responses.find((r) => r.id === 3)?.result?.resources as Array<{ uri: string }> | undefined;
    assert.ok(resources?.some((r) => r.uri === "motionlint://reports/latest"), "latest-report resource missing");

    const schemas = tools as Array<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }>;
    for (const tool of ["review_url", "review_routes"]) {
      const props = schemas.find((t) => t.name === tool)?.inputSchema?.properties ?? {};
      assert.ok("max_pr_annotations" in props, `${tool} must expose max_pr_annotations`);
    }
  });
});
