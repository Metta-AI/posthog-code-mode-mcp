const vm = require("node:vm");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

const API_KEY = process.env.POSTHOG_API_KEY;
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID;
const BASE_URL = `https://us.posthog.com/api/projects/${PROJECT_ID}`;

if (!API_KEY || !PROJECT_ID) {
  console.error(
    "POSTHOG_API_KEY and POSTHOG_PROJECT_ID environment variables are required"
  );
  process.exit(1);
}

// --- PostHog API Client ---

async function phFetch(method, path, body, params) {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url.toString(), opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PostHog API ${method} ${path}: ${res.status} ${text}`);
  }
  return res.json();
}

function crudResource(basePath) {
  return {
    list: (params) => phFetch("GET", basePath, null, params),
    get: (id) => phFetch("GET", `${basePath}/${id}`),
    create: (data) => phFetch("POST", basePath, data),
    update: (id, data) => phFetch("PATCH", `${basePath}/${id}`, data),
    delete: (id) => phFetch("DELETE", `${basePath}/${id}`),
  };
}

const posthogClient = {
  query: (query) => phFetch("POST", "/query", { query }),

  insights: crudResource("/insights"),
  dashboards: crudResource("/dashboards"),
  events: { list: (params) => phFetch("GET", "/events", null, params) },
  persons: {
    list: (params) => phFetch("GET", "/persons", null, params),
    get: (id) => phFetch("GET", `/persons/${id}`),
  },
  featureFlags: crudResource("/feature_flags"),
  experiments: {
    ...crudResource("/experiments"),
    results: (id) => phFetch("GET", `/experiments/${id}/results`),
  },
  cohorts: crudResource("/cohorts"),
  annotations: {
    list: (params) => phFetch("GET", "/annotations", null, params),
    get: (id) => phFetch("GET", `/annotations/${id}`),
    create: (data) => phFetch("POST", "/annotations", data),
  },
  actions: crudResource("/actions"),
  surveys: crudResource("/surveys"),
  errorTracking: {
    list: (params) =>
      phFetch("GET", "/error_tracking/issues", null, params),
    get: (id) => phFetch("GET", `/error_tracking/issues/${id}`),
    update: (id, data) =>
      phFetch("PATCH", `/error_tracking/issues/${id}`, data),
  },

  // Escape hatch
  api: (method, path, body) => phFetch(method, path, body),
};

// --- VM Sandbox Execution ---

async function executeCode(code) {
  const logs = [];
  const fakeConsole = {
    log: (...args) => {
      logs.push(
        args
          .map((a) => (typeof a === "string" ? a : JSON.stringify(a, null, 2)))
          .join(" ")
      );
    },
    error: (...args) => {
      logs.push(
        "[ERROR] " +
          args
            .map((a) =>
              typeof a === "string" ? a : JSON.stringify(a, null, 2)
            )
            .join(" ")
      );
    },
    warn: (...args) => {
      logs.push(
        "[WARN] " +
          args
            .map((a) =>
              typeof a === "string" ? a : JSON.stringify(a, null, 2)
            )
            .join(" ")
      );
    },
  };

  const sandbox = {
    posthog: posthogClient,
    console: fakeConsole,
    setTimeout,
    clearTimeout,
    Promise,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Date,
    Math,
    RegExp,
    Error,
    Map,
    Set,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
  };

  const wrappedCode = `(async () => {\n${code}\n})()`;

  const context = vm.createContext(sandbox);
  const script = new vm.Script(wrappedCode, { timeout: 30000 });
  const result = await script.runInContext(context, { timeout: 30000 });

  // If code returned something but didn't console.log, include it
  if (result !== undefined && logs.length === 0) {
    logs.push(
      typeof result === "string" ? result : JSON.stringify(result, null, 2)
    );
  }

  return logs.join("\n") || "(no output)";
}

// --- Type definitions for the LLM ---

const TYPE_DEFS = `
interface PostHogClient {
  /** Run a HogQL query — the most powerful method. Can query events, persons, sessions, and more. */
  query(query: {
    kind: "HogQLQuery";
    query: string; // HogQL SQL string
  }): Promise<{ results: any[][]; columns: string[]; types: string[] }>;

  insights: {
    list(params?: { limit?: number; offset?: number; search?: string }): Promise<{ results: any[] }>;
    get(id: number): Promise<any>;
    create(data: any): Promise<any>;
    update(id: number, data: any): Promise<any>;
    delete(id: number): Promise<void>;
  };

  dashboards: {
    list(params?: { limit?: number; offset?: number; search?: string }): Promise<{ results: any[] }>;
    get(id: number): Promise<any>;
    create(data: any): Promise<any>;
    update(id: number, data: any): Promise<any>;
    delete(id: number): Promise<void>;
  };

  events: {
    list(params?: { limit?: number; event?: string; person_id?: string; after?: string; before?: string }): Promise<{ results: any[] }>;
  };

  persons: {
    list(params?: { limit?: number; offset?: number; search?: string }): Promise<{ results: any[] }>;
    get(id: number): Promise<any>;
  };

  featureFlags: {
    list(params?: { limit?: number; offset?: number; search?: string }): Promise<{ results: any[] }>;
    get(id: number): Promise<any>;
    create(data: { key: string; name?: string; filters?: any; active?: boolean }): Promise<any>;
    update(id: number, data: any): Promise<any>;
    delete(id: number): Promise<void>;
  };

  experiments: {
    list(params?: { limit?: number; offset?: number }): Promise<{ results: any[] }>;
    get(id: number): Promise<any>;
    create(data: any): Promise<any>;
    update(id: number, data: any): Promise<any>;
    delete(id: number): Promise<void>;
    results(id: number): Promise<any>;
  };

  cohorts: {
    list(params?: { limit?: number; offset?: number; search?: string }): Promise<{ results: any[] }>;
    get(id: number): Promise<any>;
    create(data: any): Promise<any>;
    update(id: number, data: any): Promise<any>;
  };

  annotations: {
    list(params?: { limit?: number; offset?: number; search?: string }): Promise<{ results: any[] }>;
    get(id: number): Promise<any>;
    create(data: { content: string; date_marker?: string; scope?: string }): Promise<any>;
  };

  actions: {
    list(params?: { limit?: number; offset?: number; search?: string }): Promise<{ results: any[] }>;
    get(id: number): Promise<any>;
    create(data: any): Promise<any>;
    update(id: number, data: any): Promise<any>;
  };

  surveys: {
    list(params?: { limit?: number; offset?: number }): Promise<{ results: any[] }>;
    get(id: number): Promise<any>;
    create(data: any): Promise<any>;
    update(id: number, data: any): Promise<any>;
  };

  errorTracking: {
    list(params?: { limit?: number; offset?: number }): Promise<{ results: any[] }>;
    get(id: string): Promise<any>;
    update(id: string, data: any): Promise<any>;
  };

  /** Escape hatch: call any PostHog API endpoint directly. */
  api(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: any): Promise<any>;
}

/** The \`posthog\` global is an instance of PostHogClient. */
declare const posthog: PostHogClient;
`;

// --- MCP Server ---

const server = new McpServer({
  name: "posthog-code-mode",
  version: "1.0.0",
});

server.tool(
  "posthog",
  `Execute JavaScript code against the PostHog API. A \`posthog\` client object is available as a global.

Use console.log() to output results. Code runs in an async context so you can use await directly.

## TypeScript API Reference
${TYPE_DEFS}

## Examples

### Count events by type (last 7 days)
\`\`\`js
const result = await posthog.query({
  kind: "HogQLQuery",
  query: "SELECT event, count() FROM events WHERE timestamp > now() - interval 7 day GROUP BY event ORDER BY count() DESC LIMIT 20"
});
console.log(result.results);
\`\`\`

### List feature flags
\`\`\`js
const flags = await posthog.featureFlags.list({ limit: 50 });
console.log(flags.results.map(f => ({ key: f.key, active: f.active })));
\`\`\`

### Get a specific dashboard
\`\`\`js
const dashboard = await posthog.dashboards.get(12345);
console.log(dashboard.name, dashboard.tiles.length, "tiles");
\`\`\`

### Use the escape hatch for uncovered endpoints
\`\`\`js
const result = await posthog.api("GET", "/session_recordings", { limit: 5 });
console.log(result.results);
\`\`\``,
  { code: z.string().describe("JavaScript code to execute") },
  async ({ code }) => {
    try {
      const output = await executeCode(code);
      return { content: [{ type: "text", text: output }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
