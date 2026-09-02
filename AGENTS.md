# AGENTS.md

## Calling WebMCP servers via the browser

This session has **no native WebMCP client** — `webmcp_list` is not a registered
tool and there is no `webmcp` binary. WebMCP servers (any page that exposes
tools through Chrome's Model Context API) are reached **only through the
browser tool + OMP Browser Relay**, driving the page's own `modelContext`
object. The same method works for every WebMCP page; only the tool names and
args differ per server.

### 1. Connect the relay to the page

1. The relay (`omp browser-relay`, auto-started by the browser tool) attaches
   with `app.relay: true` — you drive the user's real Chrome tabs.
2. The relay only sees **page tabs**; extension pages (e.g. the relay's own
   settings tab) are not page targets. If `open` reports "No page targets
   available", create a real tab first, then retry:
   ```json
   {"action": "open", "url": "<webmcp page url>",
    "app": {"relay": true, "target": "<substring of page title/url>"},
    "wait_until": "domcontentloaded"}
   ```
   A successful attach reports `Opened tab "main" on relay http://127.0.0.1:9224`.

### 2. Discover and call the WebMCP API (generic pattern)

The Model Context API lives on **`document.modelContext`** or
**`navigator.modelContext`** (check both; cubecade exposes `document`, some
builds use `navigator`). It exposes `getTools()`, `executeTool(tool, args)`,
`registerTool(tool)`.

```js
// in a browser run on the page:
const mc = document.modelContext || navigator.modelContext;
const tools = await mc.getTools();                  // RegisteredTool[] — always take tools from here
const t = tools.find(x => x.name === '<tool name>');
const r = await mc.executeTool(t, '<JSON string of args>');   // args MUST be a JSON string
const result = JSON.parse(JSON.parse(r).content[0].text);     // MCP result → content[0].text
```

**Universal quirks (verified on Chrome 152):**
- `executeTool` **rejects plain objects** with `Failed to parse input
  arguments` — pass args as a **JSON string** (`'{}'`, `'{"moves":["U"]}'`).
- The tool object passed to `executeTool` must come from `getTools()` — the
  raw object you registered lacks the required `origin` member.
- `registerTool` accepts **object** schemas (`inputSchema: {type: 'object', ...}`);
  `getTools()` returns `inputSchema` as a JSON **string** — both are normal.
- Tool results are MCP-shaped: `{content: [{type: 'text', text: '<JSON>'}]}`.

### 3. Per-server specifics

Each WebMCP page advertises its own tools and endpoint (cubecade shows
`cube://model-context` on the page). Discover tools with `getTools()` and read
each tool's `description`/`inputSchema` — do not assume they match previous
servers. Logging: most pages surface agent calls in the UI; watch the page
state after `executeTool` to confirm the call landed.
