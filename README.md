# posthog-code-mode-mcp

A compact [MCP](https://modelcontextprotocol.io/) server for [PostHog](https://posthog.com/) that replaces the default ~70k token PostHog MCP server with a single tool.

Inspired by Cloudflare's [code mode](https://blog.cloudflare.com/code-mode/) pattern: instead of exposing dozens of individual tools (one per API endpoint), this server exposes a single `posthog` tool that executes JavaScript code in a sandboxed VM with a typed PostHog API client.

## Why?

The official PostHog MCP server ships ~70k tokens of tool definitions. That's a huge chunk of context window before you've even asked a question. This server achieves the same coverage with a single tool definition (~2k tokens) by letting the LLM write code against a typed client.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy the example and fill in your values:

```bash
cp .env.example .env
```

```
POSTHOG_API_KEY=phx_your_personal_api_key
POSTHOG_PROJECT_ID=12345
```

- **API Key**: Create a personal API key at https://us.posthog.com/settings/user-api-keys
- **Project ID**: Find your project ID in your PostHog project settings URL

### 3. Add to Claude Code

Add this to your Claude Code MCP config (`~/.claude/settings.json` or project-level):

```json
{
  "mcpServers": {
    "posthog-code-mode": {
      "command": "node",
      "args": ["/path/to/posthog-code-mode/index.js"],
      "env": {
        "POSTHOG_API_KEY": "phx_your_key",
        "POSTHOG_PROJECT_ID": "12345"
      }
    }
  }
}
```

Or if using a `.env` file, point to the directory and load env vars however you prefer.

## Usage

The server exposes a single `posthog` tool. The LLM writes JavaScript that runs in a sandboxed VM with a `posthog` client object available as a global.

### Examples

**Count events by type (last 7 days):**
```js
const result = await posthog.query({
  kind: "HogQLQuery",
  query: "SELECT event, count() FROM events WHERE timestamp > now() - interval 7 day GROUP BY event ORDER BY count() DESC LIMIT 20"
});
console.log(result.results);
```

**List feature flags:**
```js
const flags = await posthog.featureFlags.list({ limit: 50 });
console.log(flags.results.map(f => ({ key: f.key, active: f.active })));
```

**Use the escape hatch for any endpoint:**
```js
const result = await posthog.api("GET", "/session_recordings", { limit: 5 });
console.log(result.results);
```

## API Coverage

The `posthog` client provides typed methods for:

- **HogQL queries** — `posthog.query()`
- **Insights** — CRUD
- **Dashboards** — CRUD
- **Events** — list
- **Persons** — list, get
- **Feature Flags** — CRUD
- **Experiments** — CRUD + results
- **Cohorts** — CRUD
- **Annotations** — list, get, create
- **Actions** — CRUD
- **Surveys** — CRUD
- **Error Tracking** — list, get, update
- **Escape hatch** — `posthog.api(method, path, body)` for anything not covered above

## License

ISC
