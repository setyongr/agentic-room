/**
 * Ambient Model Context API types for Chrome's `document.modelContext`.
 *
 * The Model Context API lets a page expose tools to the browser's on-page
 * assistant. The current official surface (Chrome docs, 2026-08-20) is:
 *
 *   await document.modelContext.registerTool(
 *     { name, description, inputSchema, execute, annotations },
 *     { signal },
 *   );
 *
 * - `registerTool` resolves once registered; aborting the optional signal
 *   unregisters the tool.
 * - `execute` receives the parsed argument object plus `{ signal }` and
 *   returns a concise string (or a promise of one).
 * - `getTools()` returns the registered tools, each carrying a host-set
 *   `origin` member and `inputSchema` as a JSON string; `executeTool` takes
 *   a tool from `getTools()` and the arguments as a JSON string (plain
 *   objects are rejected by the host) and resolves with the raw result as a
 *   JSON string of the MCP-shaped envelope (verified on Chrome 152).
 * - Feature-detect `document.modelContext` first; some experimental builds
 *   expose the same API on `navigator.modelContext` instead. Secure
 *   same-origin pages only; never expose tools cross-origin.
 *
 * These types are intentionally local: they describe only the surface this
 * app registers against, without pulling in any external dependency.
 */

/** A JSON Schema fragment used for tool input schemas. */
export interface ModelContextJsonSchema {
  /** JSON Schema type keyword; the top-level schema is always "object". */
  type: string;
  /** Human-readable description of the property (<=150 characters). */
  description?: string;
  /** Named sub-schemas for object schemas. */
  properties?: Readonly<Record<string, ModelContextJsonSchema>>;
  /** Element schema for array schemas. */
  items?: ModelContextJsonSchema;
  /** Allowed literal values for enum schemas (string or numeric). */
  enum?: readonly (string | number)[];
  /** Inclusive lower bound for number schemas. */
  minimum?: number;
  /** Required property names for object schemas. */
  required?: readonly string[];
  /** Exactly one of these schema branches must validate. */
  oneOf?: readonly ModelContextJsonSchema[];
  /** Whether extra properties are rejected; absent means the host default. */
  additionalProperties?: boolean;
}

/** Safety/permission hints the Model Context runner may consume. */
export interface ModelContextAnnotations {
  /** The tool only reads state and never mutates it. */
  readOnlyHint?: boolean;
  /** The tool's output may contain untrusted content (URLs, user text). */
  untrustedContentHint?: boolean;
  /** The tool deletes or irreversibly destroys user data. */
  destructiveHint?: boolean;
  /** The tool operates on the open web rather than the current origin. */
  openWorldHint?: boolean;
  /** Short display title for the tool. */
  title?: string;
  /** Re-running the tool with the same input is safe (no side effects). */
  idempotentHint?: boolean;
}

/** A tool registered with, or returned by, the Model Context API. */
export interface ModelContextTool {
  /** Stable tool name (snake_case), unique per page. */
  name: string;
  /** Concise description of what the tool does (<=500 characters). */
  description: string;
  /**
   * Object schema at registration time; `getTools()` returns the same
   * schema as a JSON string, so both forms are part of the contract.
   */
  inputSchema: ModelContextJsonSchema | string;
  /** Optional safety hints. */
  annotations?: ModelContextAnnotations;
  /**
   * Run the tool with the parsed argument object and an abort signal.
   * Returns the result as a concise JSON string (or a promise of one);
   * aborting the signal cancels a pending invocation.
   */
  execute: (
    input: Record<string, unknown>,
    context: { signal: AbortSignal },
  ) => string | Promise<string>;
  /**
   * Present on tools returned by `getTools()`; assigned by the host, never
   * by the registering page. The tool object passed to `executeTool` must
   * come from `getTools()` for this reason.
   */
  origin?: unknown;
}

/** One content block of a Model Context tool result. */
export interface ModelContextContentBlock {
  /** Content type; "text" for string results. */
  type: string;
  /** The text payload (the tool's JSON result). */
  text: string;
}

/**
 * Parsed MCP result envelope: the shape `executeTool`'s raw JSON string
 * resolves to once parsed. Kept for consumers that parse the raw response
 * (`JSON.parse(raw)`); `executeTool` itself resolves with the raw string.
 */
export interface ModelContextResult {
  content: readonly ModelContextContentBlock[];
  /** True when the tool reported a failure. */
  isError?: boolean;
}

/**
 * The host Model Context API surface, as exposed on `document.modelContext`
 * (and `navigator.modelContext` on experimental builds). Only the members
 * this app uses are declared.
 */
export interface ModelContextApi {
  /**
   * Register a tool; resolves once registered. Aborting the optional
   * signal unregisters the tool. May reject on invalid tool input.
   */
  registerTool(tool: ModelContextTool, options?: { signal?: AbortSignal }): Promise<void>;
  /** List the tools currently registered on the page (host-normalized). */
  getTools(): Promise<readonly ModelContextTool[]>;
  /**
   * Execute a tool obtained from `getTools()`. Arguments are passed as a
   * JSON string; plain objects are rejected by the host. Resolves with the
   * raw result as a JSON string of the MCP-shaped envelope (verified on
   * Chrome 152); parse it to obtain the `ModelContextResult` shape.
   */
  executeTool(tool: ModelContextTool, argsJson: string): Promise<string>;
}

declare global {
  interface Document {
    /** Chrome Model Context API; absent on unsupported builds. */
    modelContext?: ModelContextApi;
  }
  interface Navigator {
    /** Experimental builds may expose the API on navigator instead. */
    modelContext?: ModelContextApi;
  }
}
