'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { RotateCcw, Ruler } from 'lucide-react';
import { ROOM_SIZE_LIMITS } from '@/domain/resize';
import { isBalconyOpening } from '@/domain/validation';
import { DEFAULT_ROOM_DIMENSIONS, type RoomDimensions, type RoomOpening } from '@/domain/types';
import { useRoomStore } from '@/store/roomStore';
import { OpeningsEditor } from '@/components/marketplace/OpeningsEditor';

type Feedback = { kind: 'success' | 'error'; message: string } | null;

/** Trimmed meter formatting, e.g. 6, 4.5, 2.75. */
function meters(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/** Live draft of the three dimension inputs, kept as strings while editing. */
interface Draft {
  width: string;
  depth: string;
  height: string;
}

const LIMITS = ROOM_SIZE_LIMITS;

/** Whether every draft field parses as a finite number inside the supported ranges. */
function parseDraft(draft: Draft): RoomDimensions | null {
  const width = Number(draft.width);
  const depth = Number(draft.depth);
  const height = Number(draft.height);
  const inRange =
    Number.isFinite(width) &&
    Number.isFinite(depth) &&
    Number.isFinite(height) &&
    width >= LIMITS.width.min &&
    width <= LIMITS.width.max &&
    depth >= LIMITS.depth.min &&
    depth <= LIMITS.depth.max &&
    height >= LIMITS.height.min &&
    height <= LIMITS.height.max;
  return inRange ? { width, depth, height } : null;
}

function dimensionsEqual(a: RoomDimensions, b: RoomDimensions): boolean {
  return a.width === b.width && a.depth === b.depth && a.height === b.height;
}

/** Human label for a removed opening, e.g. "balcony door" or "window". */
function openingLabel(opening: RoomOpening): string {
  if (opening.kind === 'window') return 'window';
  return isBalconyOpening(opening) ? 'balcony door' : 'doorway';
}

/**
 * Room size editor: set the room shell to real measured dimensions.
 *
 * Mirrors the finishes panel layout: a scrollable form plus a pinned polite
 * status footer. Applying a size routes through the shared store action, so
 * the 3D scene, openings, placement zones, validation, and (for agent calls)
 * the activity feed update in the same write. Furniture is never moved;
 * anything that no longer fits is flagged as a layout error immediately.
 */
export function RoomSizePanel() {
  const dimensions = useRoomStore((state) => state.room.dimensions);
  const setRoomDimensions = useRoomStore((state) => state.setRoomDimensions);
  const [draft, setDraft] = useState<Draft>({
    width: meters(dimensions.width),
    depth: meters(dimensions.depth),
    height: meters(dimensions.height),
  });
  const [feedback, setFeedback] = useState<Feedback>(null);

  // Keep the draft in sync when the room changes externally (reset, preset,
  // saved design, agent resize) — but never while the user is mid-edit on a
  // field, so an applied commit only normalizes the just-typed values.
  useEffect(() => {
    setDraft({
      width: meters(dimensions.width),
      depth: meters(dimensions.depth),
      height: meters(dimensions.height),
    });
  }, [dimensions]);

  const parsed = parseDraft(draft);
  const changed = parsed !== null && !dimensionsEqual(parsed, dimensions);
  const atDefault = dimensionsEqual(dimensions, DEFAULT_ROOM_DIMENSIONS);

  function setField(field: keyof Draft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function applySize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = parseDraft(draft);
    if (next === null) {
      setFeedback({
        kind: 'error',
        message: `Enter width/depth between ${LIMITS.width.min} and ${LIMITS.width.max} m and a height between ${LIMITS.height.min} and ${LIMITS.height.max} m.`,
      });
      return;
    }
    const openingsBefore = useRoomStore.getState().room.openings;
    const result = setRoomDimensions(next, 'human');
    if (!result.ok) {
      setFeedback({ kind: 'error', message: result.message });
      return;
    }
    if (!result.data.changed) {
      setFeedback({ kind: 'success', message: 'The room is already this size.' });
      return;
    }
    const removed = result.data.removedOpeningIds;
    const state = useRoomStore.getState();
    const outOfBounds = new Set<string>();
    for (const issue of state.validation.issues) {
      if (issue.kind === 'out_of_bounds') {
        for (const instanceId of issue.instanceIds) outOfBounds.add(instanceId);
      }
    }
    const sizeText = `${meters(next.width)} × ${meters(next.depth)} × ${meters(next.height)} m`;
    const removedLabels = removed
      .map((id) => openingsBefore.find((opening) => opening.id === id))
      .filter((opening): opening is RoomOpening => opening !== undefined)
      .map(openingLabel);
    const removalText =
      removedLabels.length === 0
        ? ''
        : removedLabels.length === 1
          ? ` The ${removedLabels[0]} no longer fits a wall and was removed.`
          : ` ${removedLabels.length} openings no longer fit the walls and were removed.`;
    const fixText =
      outOfBounds.size === 0
        ? ''
        : outOfBounds.size === 1
          ? ' 1 piece now sits outside the room — move it in Edit.'
          : ` ${outOfBounds.size} pieces now sit outside the room — move them in Edit.`;
    setFeedback({
      kind: 'success',
      message: `Room resized to ${sizeText} (${meters(next.width * next.depth)} m²).${removalText}${fixText}`,
    });
  }

  function resetSize() {
    const result = setRoomDimensions(DEFAULT_ROOM_DIMENSIONS, 'human');
    setFeedback(
      result.ok && result.data.changed
        ? { kind: 'success', message: 'Room size reset to the demo dimensions (6 × 4.5 × 2.8 m).' }
        : result.ok
          ? { kind: 'success', message: 'The room is already at the demo size.' }
          : { kind: 'error', message: result.message },
    );
  }

  const liveArea = parsed !== null ? meters(parsed.width * parsed.depth) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
        <form onSubmit={applySize}>
          <div className="flex items-center gap-2 text-xs font-semibold tracking-widest text-accent-strong uppercase">
            <Ruler className="size-4" aria-hidden="true" />
            Room size
          </div>
          <p className="mt-2 text-sm leading-6 text-text-muted">
            Measure your room and enter its real size — width and depth along the floor,
            height up to the ceiling. Openings and placement zones follow the walls;
            furniture keeps its spot and is flagged when it no longer fits.
          </p>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <label className="grid gap-1.5 text-small font-medium text-text" htmlFor="room-size-width">
              Width (m)
              <input
                id="room-size-width"
                type="number"
                inputMode="decimal"
                step="0.05"
                min={LIMITS.width.min}
                max={LIMITS.width.max}
                value={draft.width}
                onChange={(event) => setField('width', event.target.value)}
                aria-describedby="room-size-range-hint"
                className="min-h-11 w-full rounded-control border bg-surface-raised px-2 tabular-nums text-text shadow-none outline-none transition-colors placeholder:text-text-faint focus:border-accent motion-reduce:transition-none"
              />
            </label>
            <label className="grid gap-1.5 text-small font-medium text-text" htmlFor="room-size-depth">
              Depth (m)
              <input
                id="room-size-depth"
                type="number"
                inputMode="decimal"
                step="0.05"
                min={LIMITS.depth.min}
                max={LIMITS.depth.max}
                value={draft.depth}
                onChange={(event) => setField('depth', event.target.value)}
                className="min-h-11 w-full rounded-control border bg-surface-raised px-2 tabular-nums text-text shadow-none outline-none transition-colors placeholder:text-text-faint focus:border-accent motion-reduce:transition-none"
              />
            </label>
            <label className="grid gap-1.5 text-small font-medium text-text" htmlFor="room-size-height">
              Height (m)
              <input
                id="room-size-height"
                type="number"
                inputMode="decimal"
                step="0.05"
                min={LIMITS.height.min}
                max={LIMITS.height.max}
                value={draft.height}
                onChange={(event) => setField('height', event.target.value)}
                className="min-h-11 w-full rounded-control border bg-surface-raised px-2 tabular-nums text-text shadow-none outline-none transition-colors placeholder:text-text-faint focus:border-accent motion-reduce:transition-none"
              />
            </label>
          </div>
          <p id="room-size-range-hint" className="mt-2 text-xs leading-5 text-text-muted">
            Supported: width/depth {LIMITS.width.min}–{LIMITS.width.max} m, height{' '}
            {LIMITS.height.min}–{LIMITS.height.max} m. Floor area:{' '}
            <span className="font-medium tabular-nums text-text">
              {liveArea === null ? '—' : `${liveArea} m²`}
            </span>
            .
          </p>

          <button
            type="submit"
            disabled={!changed}
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control bg-accent px-4 py-2 text-small font-semibold text-on-accent transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
          >
            <Ruler className="size-4" aria-hidden="true" />
            {changed ? 'Apply new size' : 'Current size applied'}
          </button>
        </form>

        <div className="mt-6 border-t border-border pt-4">
          <button
            type="button"
            onClick={resetSize}
            disabled={atDefault}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-border px-3 text-sm font-semibold text-text transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:text-text-faint motion-reduce:transition-none"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            Reset to demo size (6 × 4.5 × 2.8 m)
          </button>
        </div>

        <div className="mt-6 border-t border-border pt-4">
          <OpeningsEditor />
        </div>
      </div>
      <div
        role="status"
        aria-atomic="true"
        aria-live="polite"
        className="shrink-0 border-t border-border px-4 py-3 sm:px-5"
      >
        <p className={`text-sm ${feedback?.kind === 'error' ? 'text-error' : 'text-text-muted'}`}>
          {feedback?.message ?? 'Sizing updates the room shell and layout instantly.'}
        </p>
      </div>
    </div>
  );
}
