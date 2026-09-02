'use client';

import { useEffect } from 'react';

import { registerRoomTools } from '@/webmcp/registerTools';

/**
 * Zero-visual host for the WebMCP tool registry. Mounted once beside the
 * planner shell root so the read tools act on the live Zustand singleton.
 * Renders nothing, so unsupported browsers keep the planner fully intact;
 * registration only ever runs in a client effect, keeping SSR unaffected.
 */
export function WebMcpProvider() {
  useEffect(() => registerRoomTools(), []);

  return null;
}
