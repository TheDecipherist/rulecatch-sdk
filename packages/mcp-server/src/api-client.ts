/**
 * HTTP client for the Rulecatch MCP API.
 * Reads config from ~/.claude/rulecatch/config.json.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface RulecatchConfig {
  apiKey: string;
  region: 'us' | 'eu';
  mcpEndpoint?: string;
  endpoint?: string;
}

const CONFIG_PATH = join(homedir(), '.claude', 'rulecatch', 'config.json');

const MCP_ENDPOINTS: Record<string, string> = {
  us: 'https://mcp.rulecatch.ai',
  eu: 'https://mcp-eu.rulecatch.ai',
};

function loadConfig(): RulecatchConfig {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(
      'Rulecatch not configured. Run `npx @rulecatch/ai-pooler init` to set up.'
    );
  }

  const raw = readFileSync(CONFIG_PATH, 'utf-8');
  const config = JSON.parse(raw) as RulecatchConfig;

  if (!config.apiKey) {
    throw new Error(
      'API key missing from config. Run `npx @rulecatch/ai-pooler init` to reconfigure.'
    );
  }

  return config;
}

function getBaseUrl(config: RulecatchConfig): string {
  // Priority: mcpEndpoint > derive from region
  if (config.mcpEndpoint) return config.mcpEndpoint;
  return MCP_ENDPOINTS[config.region] || MCP_ENDPOINTS.us;
}

export class ApiClient {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    const config = loadConfig();
    this.apiKey = config.apiKey;
    this.baseUrl = getBaseUrl(config);
  }

  async request<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`/api/v1/mcp${path}`, this.baseUrl);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '') {
          url.searchParams.set(key, value);
        }
      }
    }

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
        },
      });
    } catch (err) {
      throw new Error(
        'Cannot reach Rulecatch API. Check your internet connection.'
      );
    }

    if (response.status === 401) {
      throw new Error(
        'Invalid API key. Run `npx @rulecatch/ai-pooler init` to configure.'
      );
    }

    if (response.status === 403) {
      const body = await response.json().catch(() => ({ error: '' })) as { error?: string; requiredPlans?: string[] };
      if (body.requiredPlans) {
        throw new Error(
          `MCP tools require a Pro or Enterprise plan. Upgrade at dashboard.rulecatch.ai/billing.`
        );
      }
      throw new Error(
        body.error || 'Subscription inactive. Visit dashboard.rulecatch.ai/billing.'
      );
    }

    if (response.status === 429) {
      throw new Error('Rate limited. Try again in a moment.');
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`API error (${response.status}): ${body}`);
    }

    return (await response.json()) as T;
  }
}
