'use client';

import { Compass, Move3d } from 'lucide-react';
import { AgentActivityFeed } from '@/components/planner/AgentActivityFeed';
import { DesignCartPanel } from '@/components/planner/DesignCartPanel';
import { FurnitureInspector } from '@/components/planner/FurnitureInspector';
import { MarketplacePanel } from '@/components/marketplace/MarketplacePanel';
import { PlannerHeader } from '@/components/planner/PlannerHeader';
import { RoomCanvas } from '@/components/three/RoomCanvas';
import { WebMcpProvider } from '@/components/WebMcpProvider';
import { useRoomStore } from '@/store/roomStore';

/**
 * Responsive composition for the living-room planner. Interactive panels own
 * their individual controls; this shell deliberately only establishes the
 * reading order and spatial hierarchy around the decorative 3D viewport.
 */
export function PlannerShell() {
  const furnitureCount = useRoomStore((state) => state.furniture.length);
  const room = useRoomStore((state) => state.room);

  const roomSummary = `${furnitureCount} ${furnitureCount === 1 ? 'piece' : 'pieces'} arranged in a ${room.dimensions.width} by ${room.dimensions.depth} metre living room.`;

  return (
    <main className="min-h-dvh bg-background text-text">
      {/* Zero-visual WebMCP registry host; exactly one mount, tools share the live store. */}
      <WebMcpProvider />

      <div className="mx-auto flex min-h-dvh w-full max-w-(--planner-max) flex-col px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        <PlannerHeader />

        <div className="mt-5 grid min-w-0 flex-1 items-start gap-6 lg:mt-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,22rem)] lg:gap-8">
          <section aria-labelledby="room-stage-heading" className="min-w-0">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-widest text-accent-strong uppercase">
                  Room in progress
                </p>
                <h2 id="room-stage-heading" className="mt-1 text-2xl font-semibold tracking-tight text-text sm:text-3xl">
                  Your living room
                </h2>
              </div>
              <p className="hidden max-w-xs text-right text-sm leading-6 text-text-muted sm:block">
                Select a piece in the room to refine its placement.
              </p>
            </div>

            <div className="relative min-h-120 overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface-muted shadow-[var(--shadow-card)] sm:min-h-136 lg:min-h-[calc(100dvh-16rem)]">
              <div className="absolute inset-0">
                <RoomCanvas />
              </div>

              <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4 sm:p-5" aria-hidden="true">
                <span className="inline-flex items-center gap-2 rounded-[var(--radius-pill)] border bg-surface-raised/90 px-3 py-2 text-xs font-semibold tracking-wider text-text-muted uppercase shadow-[var(--shadow-pop)]">
                  <Compass className="size-4 text-accent" strokeWidth={1.75} />
                  3D room view
                </span>
                <span className="hidden items-center gap-2 rounded-[var(--radius-pill)] border bg-surface-raised/90 px-3 py-2 text-xs font-medium text-text-muted shadow-[var(--shadow-pop)] sm:inline-flex">
                  <Move3d className="size-4 text-accent" strokeWidth={1.75} />
                  Orbit to explore
                </span>
              </div>

              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-surface-muted/85 to-transparent px-4 pb-4 pt-12 sm:px-5 sm:pb-5" aria-hidden="true">
                <span className="text-xs font-medium tracking-wider text-text-muted uppercase">
                  Interactive room model
                </span>
              </div>
            </div>

            <p className="mt-4 max-w-2xl text-sm leading-6 text-text-muted">
              {roomSummary} Browse the marketplace, then place pieces where they belong.
            </p>
          </section>

          <aside aria-label="Marketplace" className="min-w-0 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto lg:overscroll-contain lg:pt-1">
            <MarketplacePanel />
          </aside>
        </div>

        <section aria-labelledby="room-tools-heading" className="mt-8 border-t border-border pt-6 lg:pt-8">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <div>
              <p className="text-xs font-semibold tracking-widest text-accent-strong uppercase">Design details</p>
              <h2 id="room-tools-heading" className="mt-1 text-xl font-semibold tracking-tight text-text sm:text-2xl">
                Fine-tune your plan
              </h2>
            </div>
            <p className="hidden text-sm text-text-muted sm:block">Review one piece or your saved selections.</p>
          </div>

          <div className="grid min-w-0 gap-6 xl:grid-cols-3 xl:gap-8">
            <FurnitureInspector />
            <DesignCartPanel />
            <AgentActivityFeed />
          </div>
        </section>
      </div>
    </main>
  );
}
