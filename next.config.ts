import type { NextConfig } from "next";

const config: NextConfig = {
  // The ATK MCP server is spawned as a child process; keep these out of the bundle.
  serverExternalPackages: ["@modelcontextprotocol/sdk", "@okx_ai/okx-trade-mcp"],
};

export default config;
