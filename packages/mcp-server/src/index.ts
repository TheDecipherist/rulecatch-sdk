#!/usr/bin/env node

/**
 * Rulecatch MCP Server
 *
 * Runs on the customer's machine via stdio transport.
 * Provides 5 tools for querying violations, rules, and generating fix plans.
 *
 * IMPORTANT: Never write to stdout (console.log) — it corrupts JSON-RPC messages.
 * Use console.error() for logging.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ApiClient } from './api-client.js';
import { registerTools } from './tools.js';

async function main(): Promise<void> {
  const server = new McpServer({
    name: 'rulecatch',
    version: '1.0.0',
  });

  let client: ApiClient;
  try {
    client = new ApiClient();
  } catch (err) {
    console.error(`[Rulecatch MCP] Config error: ${(err as Error).message}`);
    process.exit(1);
  }

  registerTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[Rulecatch MCP] Server running on stdio');
}

main().catch((error) => {
  console.error('[Rulecatch MCP] Fatal error:', error);
  process.exit(1);
});
