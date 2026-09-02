'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Compass, Move3d, PackageSearch, PencilRuler, X } from 'lucide-react';
import { AgentActivityFeed } from '@/components/planner/AgentActivityFeed';
import { DesignCartPanel } from '@/components/planner/DesignCartPanel';
import { FurnitureInspector } from '@/components/planner/FurnitureInspector';
import { PlannerHeader, RoomCameraControls } from '@/components/planner/PlannerHeader';
import { WorkspaceDrawer } from '@/components/planner/WorkspaceDrawer';
import { type SidebarMode, WorkspaceStatusBar } from '@/components/planner/WorkspaceStatusBar';
import { MarketplacePanel } from '@/components/marketplace/MarketplacePanel';
import { RoomCanvas } from '@/components/three/RoomCanvas';
import { WebMcpProvider } from '@/components/WebMcpProvider';
import { useRoomStore } from '@/store/roomStore';

type Drawer = 'activity' | 'cart' | 'designs' | null;

const DESKTOP_MEDIA_QUERY = '(min-width: 64rem)';
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/** One viewport-sized room planning workspace with focused secondary surfaces. */
export function PlannerShell() {
  const selectedInstanceId = useRoomStore((state) => state.selectedInstanceId);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('catalog');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [activeDrawer, setActiveDrawer] = useState<Drawer>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const sidebarCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const sidebarTriggerRef = useRef<HTMLElement | null>(null);

  /* Track the lg breakpoint that turns the sidebar into the persistent rail. */
  useEffect(() => {
    const media = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (selectedInstanceId !== null) setSidebarMode('edit');
  }, [selectedInstanceId]);

  const closeSidebar = useCallback(() => {
    setMobileSidebarOpen(false);
  }, []);

  function openSidebar(mode: SidebarMode) {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && active.isConnected) {
      sidebarTriggerRef.current = active;
    }
    setSidebarMode(mode);
    setMobileSidebarOpen(true);
  }

  /* Open mobile sheet: focus the close control, trap Tab, close on Escape. */
  useEffect(() => {
    if (isDesktop || !mobileSidebarOpen) return;

    sidebarCloseButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSidebar();
        return;
      }
      if (event.key !== 'Tab') return;
      const container = sidebarRef.current;
      const active = document.activeElement;
      if (container === null) return;
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !container.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeSidebar, isDesktop, mobileSidebarOpen]);

  /* Closed mobile sheet: restore focus to whichever control opened it. */
  useEffect(() => {
    if (isDesktop || mobileSidebarOpen) return;
    const trigger = sidebarTriggerRef.current;
    sidebarTriggerRef.current = null;
    if (trigger !== null && trigger.isConnected) trigger.focus();
  }, [isDesktop, mobileSidebarOpen]);

  const closeDrawer = useCallback(() => setActiveDrawer(null), []);
  const drawerTitle = activeDrawer === 'activity'
    ? 'Agent activity'
    : activeDrawer === 'cart'
      ? 'Cart'
      : 'Designs';

  const mobileSheetOpen = !isDesktop && mobileSidebarOpen;
  const mobileSheetClosed = !isDesktop && !mobileSidebarOpen;

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-text">
      {/* Zero-visual registry host; this workspace mounts the live tool provider once. */}
      <WebMcpProvider />

      <PlannerHeader
        onOpenCart={() => setActiveDrawer('cart')}
        onOpenDesigns={() => setActiveDrawer('designs')}
      />

      <div className="relative min-h-0 flex-1">
        {mobileSheetOpen ? (
          <div
            role="presentation"
            aria-hidden="true"
            onClick={closeSidebar}
            className="fixed inset-0 z-30 cursor-default bg-slate-950/30"
          />
        ) : null}

        <aside
          ref={sidebarRef}
          aria-label="Workspace tools"
          aria-modal={mobileSheetOpen ? true : undefined}
          role={mobileSheetOpen ? 'dialog' : undefined}
          inert={mobileSheetClosed}
          className={`fixed inset-x-0 bottom-0 z-40 flex max-h-[min(78dvh,42rem)] min-h-0 flex-col border-t border-border bg-surface transition-transform duration-200 ease-out motion-reduce:transition-none lg:absolute lg:inset-y-0 lg:left-0 lg:right-auto lg:z-10 lg:w-80 lg:max-h-none lg:translate-y-0 lg:border-t-0 lg:border-r ${
            mobileSidebarOpen ? 'translate-y-0' : 'translate-y-full'
          }`}
        >
          <div className="flex min-h-16 shrink-0 items-center justify-between border-b border-border px-4">
            <div className="flex rounded-control bg-surface-muted p-1" role="group" aria-label="Workspace mode">
              <button
                type="button"
                aria-pressed={sidebarMode === 'catalog'}
                onClick={() => setSidebarMode('catalog')}
                className={`inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none ${sidebarMode === 'catalog' ? 'bg-surface text-text' : 'text-text-muted hover:text-text'}`}
              >
                <PackageSearch className="size-4" aria-hidden="true" />
                Furnish
              </button>
              <button
                type="button"
                aria-pressed={sidebarMode === 'edit'}
                onClick={() => setSidebarMode('edit')}
                className={`inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none ${sidebarMode === 'edit' ? 'bg-surface text-text' : 'text-text-muted hover:text-text'}`}
              >
                <PencilRuler className="size-4" aria-hidden="true" />
                Edit
              </button>
            </div>
            <button
              ref={sidebarCloseButtonRef}
              type="button"
              aria-label="Close workspace sidebar"
              onClick={closeSidebar}
              className="inline-flex size-11 items-center justify-center rounded-control text-text-muted hover:bg-surface-muted hover:text-text lg:hidden"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain lg:overflow-hidden">
            {sidebarMode === 'catalog' ? <MarketplacePanel /> : <FurnitureInspector />}
          </div>
        </aside>

        <section aria-labelledby="room-stage-heading" className="absolute inset-0 min-w-0 lg:left-80">
          <div className="relative h-full overflow-hidden bg-surface-muted">
            <div className="absolute inset-0">
              <RoomCanvas />
            </div>
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-3 sm:p-4">
              <div className="rounded-control border border-border bg-surface/90 px-3 py-2">
                <p className="flex items-center gap-2 text-xs font-semibold tracking-wider text-text-muted uppercase">
                  <Compass className="size-4 text-accent" aria-hidden="true" />
                  <span id="room-stage-heading">3D room view</span>
                </p>
              </div>
              <div className="pointer-events-auto">
                <RoomCameraControls />
              </div>
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between px-4 pb-4 pt-16">
              <p className="hidden items-center gap-2 rounded-control border border-border bg-surface/90 px-3 py-2 text-xs font-medium tracking-wider text-text-muted uppercase sm:flex">
                <Move3d className="size-4 text-accent" aria-hidden="true" />
                Select a piece to refine it
              </p>
            </div>
          </div>
        </section>
      </div>

      <WorkspaceStatusBar
        sidebarMode={sidebarMode}
        onOpenActivity={() => setActiveDrawer('activity')}
        onOpenSidebar={openSidebar}
      />

      <WorkspaceDrawer
        open={activeDrawer !== null}
        title={drawerTitle}
        onClose={closeDrawer}
      >
        {activeDrawer === 'activity' ? <AgentActivityFeed /> : null}
        {activeDrawer === 'cart' ? <DesignCartPanel view="cart" /> : null}
        {activeDrawer === 'designs' ? <DesignCartPanel view="designs" /> : null}
      </WorkspaceDrawer>
    </main>
  );
}
