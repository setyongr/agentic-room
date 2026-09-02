import { createMutationTools } from './tools/mutationTools';
import { createReadTools } from './tools/readTools';

import type { ModelContextApi } from './types';

/**
 * Feature-detect the Chrome Model Context API on this page. Secure
 * same-origin pages expose it as `document.modelContext`; some experimental
 * builds only advertise it as `navigator.modelContext`. Returns undefined on
 * unsupported browsers so registration can degrade silently.
 */
function getModelContextApi(): ModelContextApi | undefined {
  if (typeof document !== 'undefined' && document.modelContext) {
    return document.modelContext;
  }
  if (typeof navigator !== 'undefined' && navigator.modelContext) {
    return navigator.modelContext;
  }
  return undefined;
}

/**
 * Register every WebMCP read and mutation tool against the page's Model Context API, and
 * return a cleanup that unregisters them all by aborting the registration
 * signal (per the Chrome contract, aborting unregisters). Call once per
 * mounted provider: React Strict Mode's effect → cleanup → effect sequence
 * aborts the first pass before the second re-registers, so tools are never
 * registered twice. Unsupported browsers receive a no-op cleanup.
 */
export function registerRoomTools(): () => void {
  const api = getModelContextApi();
  if (!api) {
    return () => {};
  }

  const tools = [...createReadTools(), ...createMutationTools()];
  const controller = new AbortController();
  const { signal } = controller;

  void (async () => {
    for (const tool of tools) {
      if (signal.aborted) {
        return;
      }
      try {
        await api.registerTool(tool, { signal });
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[webmcp] failed to register tool "${tool.name}"`, error);
        }
      }
    }
  })();

  return () => controller.abort();
}
