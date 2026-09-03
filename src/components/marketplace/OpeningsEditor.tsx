'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { AppWindow, DoorOpen, MoveHorizontal, Plus, Trash2 } from 'lucide-react';
import {
  openingAlongWallCenter,
  openingAlongWallLimits,
  openingAlongWallSize,
  openingDimensionLimits,
  type MoveOpeningResult,
  type OpeningDimensionPatch,
  type OpeningMutationResult,
} from '@/domain/resize';
import { isBalconyOpening } from '@/domain/validation';
import type {
  RoomDimensions,
  RoomOpening,
  RoomOpeningKind,
  SerializableResult,
  WallSide,
} from '@/domain/types';
import { useRoomStore } from '@/store/roomStore';

type Feedback = { kind: 'success' | 'error'; message: string } | null;

/** Meter formatting trimmed to two decimals, e.g. 1.4 or -0.55. */
function meters(value: number): string {
  return Number(value.toFixed(2)).toString();
}

const WALL_OPTIONS: readonly { value: WallSide; label: string }[] = [
  { value: 'north', label: 'North wall' },
  { value: 'south', label: 'South wall' },
  { value: 'east', label: 'East wall' },
  { value: 'west', label: 'West wall' },
];

/** Display name for an opening: window, doorway, or balcony door. */
function openingName(opening: RoomOpening): string {
  if (opening.kind === 'window') return 'Window';
  return isBalconyOpening(opening) ? 'Balcony door' : 'Door';
}

type MoveOpeningAction = (
  openingId: string,
  alongCenter: number,
  wall?: WallSide,
) => SerializableResult<MoveOpeningResult>;

/**
 * Doors & windows editor: add doors/windows to any wall, reposition them
 * along a wall or onto a different wall, and remove the ones no longer
 * wanted.
 *
 * Lives in the Furnish → Room size tab next to the room-shell size form so
 * walls, openings, and zones stay in one place. Every change routes through
 * the shared store action, so the 3D scene, clearance validation, and the
 * layout checks update in the same write; pieces that end up blocking a
 * moved or added opening are flagged immediately.
 */
export function OpeningsEditor() {
  const room = useRoomStore((state) => state.room);
  const setOpeningPosition = useRoomStore((state) => state.setOpeningPosition);
  const addOpening = useRoomStore((state) => state.addOpening);
  const removeOpening = useRoomStore((state) => state.removeOpening);
  const setOpeningDimensions = useRoomStore((state) => state.setOpeningDimensions);
  const [feedback, setFeedback] = useState<Feedback>(null);

  return (
    <section aria-labelledby="openings-editor-title">
      <div className="flex items-center gap-2">
        <AppWindow className="size-4 text-accent" aria-hidden="true" />
        <h3 id="openings-editor-title" className="text-xs font-semibold tracking-widest text-accent-strong uppercase">
          Doors &amp; windows
        </h3>
        <span className="text-xs tabular-nums text-text-muted">{room.openings.length}</span>
      </div>

      {room.openings.length === 0 ? (
        <p className="mt-2 text-sm leading-6 text-text-muted">
          This room has no doors or windows yet — add one below.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {room.openings.map((opening) => (
            <li key={opening.id}>
              <OpeningRow
                opening={opening}
                dimensions={room.dimensions}
                moveOpening={setOpeningPosition}
                removeOpening={removeOpening}
                setOpeningDimensions={setOpeningDimensions}
                onFeedback={setFeedback}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 border-t border-border pt-3">
        <AddOpeningForm
          addOpening={addOpening}
          walls={room.openings}
          onFeedback={setFeedback}
        />
      </div>

      <p
        role="status"
        aria-atomic="true"
        aria-live="polite"
        className={`mt-3 text-sm ${feedback?.kind === 'error' ? 'text-error' : 'text-text-muted'}`}
      >
        {feedback?.message ?? 'Add, move, or remove doors and windows; blocked pieces are flagged right away.'}
      </p>
    </section>
  );
}

/** One opening row: icon, wall, along-wall position input, wall relocation, remove. */
function OpeningRow({
  opening,
  dimensions,
  moveOpening,
  removeOpening,
  setOpeningDimensions,
  onFeedback,
}: {
  opening: RoomOpening;
  dimensions: RoomDimensions;
  moveOpening: MoveOpeningAction;
  removeOpening: (openingId: string) => SerializableResult<OpeningMutationResult>;
  setOpeningDimensions: (
    openingId: string,
    patch: OpeningDimensionPatch,
  ) => SerializableResult<OpeningMutationResult>;
  onFeedback: (feedback: Feedback) => void;
}) {
  const center = openingAlongWallCenter(opening);
  const [draft, setDraft] = useState(meters(center));
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const inputId = `opening-${opening.id}-position`;
  const hintId = `opening-${opening.id}-hint`;
  const wallSelectId = `opening-${opening.id}-wall`;

  useEffect(() => {
    setDraft(meters(center));
    setConfirmingRemove(false);
  }, [center, opening.id, opening.wall]);

  const limits = openingAlongWallLimits(opening, dimensions);

  const announce = (result: { ok: boolean; message?: string }, label: string) => {
    if (!result.ok) {
      onFeedback({ kind: 'error', message: result.message ?? 'Something went wrong.' });
      return;
    }
    onFeedback({ kind: 'success', message: label });
  };

  const remove = () => {
    if (!confirmingRemove) {
      setConfirmingRemove(true);
      return;
    }
    const result = removeOpening(opening.id);
    announce(result, result.ok ? `${openingName(opening)} removed from the room.` : '');
  };

  const changeWall = (wall: WallSide) => {
    if (wall === opening.wall) return;
    const result = moveOpening(opening.id, openingAlongWallCenter(opening), wall);
    if (!result.ok) {
      onFeedback({ kind: 'error', message: result.message });
      return;
    }
    onFeedback({
      kind: 'success',
      message: `${openingName(opening)} moved to the ${wall} wall at ${meters(
        openingAlongWallCenter(result.data.opening),
      )} m along it.`,
    });
  };

  const heading = <RowHeading opening={opening} onRemove={remove} confirming={confirmingRemove} />;

  if (limits === null) {
    return (
      <div className="rounded-control border border-border bg-surface-muted/40 p-3">
        {heading}
        <p className="mt-2 text-xs leading-5 text-text-muted">
          The current wall is too short to host this {openingName(opening).toLowerCase()}; it cannot
          be repositioned here. Resize the room or move the opening to another wall.
        </p>
      </div>
    );
  }

  const minLimit = limits.min;
  const maxLimit = limits.max;
  const value = Number(draft);
  const valid =
    draft.trim() !== '' && Number.isFinite(value) && value >= minLimit && value <= maxLimit;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid) return;
    const result = moveOpening(opening.id, value);
    if (!result.ok) {
      onFeedback({ kind: 'error', message: result.message });
      return;
    }
    onFeedback({
      kind: 'success',
      message: `${openingName(opening)} moved to ${meters(
        openingAlongWallCenter(result.data.opening),
      )} m along its wall.`,
    });
  }

  function nudge(delta: number) {
    const next = Math.min(maxLimit, Math.max(minLimit, openingAlongWallCenter(opening) + delta));
    const result = moveOpening(opening.id, next);
    if (!result.ok) {
      onFeedback({ kind: 'error', message: result.message });
      return;
    }
    onFeedback({
      kind: 'success',
      message: `${openingName(opening)} moved to ${meters(
        openingAlongWallCenter(result.data.opening),
      )} m along its wall.`,
    });
  }

  return (
    <div className="rounded-control border border-border bg-surface-muted/40 p-3">
      {heading}
      <form className="mt-2" onSubmit={submit}>
        <div className="flex items-end gap-2">
          <label className="grid min-w-0 flex-1 gap-1 text-xs font-medium text-text" htmlFor={inputId}>
            Center along wall (m)
            <input
              id={inputId}
              type="number"
              inputMode="decimal"
              step="0.05"
              min={minLimit}
              max={maxLimit}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-describedby={hintId}
              className="min-h-11 w-full rounded-control border bg-surface-raised px-3 text-sm tabular-nums text-text shadow-none outline-none transition-colors placeholder:text-text-faint focus:border-accent motion-reduce:transition-none"
            />
          </label>
          <button
            type="submit"
            disabled={!valid}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control bg-accent px-3 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-faint motion-reduce:transition-none"
          >
            <MoveHorizontal className="size-4" aria-hidden="true" />
            Move
          </button>
        </div>
        <p id={hintId} className="mt-1.5 text-[11px] leading-4 text-text-muted">
          Range {meters(minLimit)} to {meters(maxLimit)} m; steps of 0.05 m. Values outside the range
          are clamped to the wall.
        </p>
        <div className="mt-2 grid grid-cols-[1fr_auto] items-end gap-2">
          <label className="grid gap-1 text-xs font-medium text-text" htmlFor={wallSelectId}>
            Move to wall
            <select
              id={wallSelectId}
              value={opening.wall}
              onChange={(event) => changeWall(event.target.value as WallSide)}
              className="min-h-11 w-full rounded-control border border-border bg-surface-raised px-2 text-sm text-text transition-colors motion-reduce:transition-none"
            >
              {WALL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => nudge(-0.5)}
              className="inline-flex min-h-11 items-center justify-center gap-1 rounded-control border border-border bg-surface-raised px-2 text-xs font-semibold text-text transition-colors hover:bg-surface-muted motion-reduce:transition-none"
            >
              −0.5 m
            </button>
            <button
              type="button"
              onClick={() => nudge(0.5)}
              className="inline-flex min-h-11 items-center justify-center gap-1 rounded-control border border-border bg-surface-raised px-2 text-xs font-semibold text-text transition-colors hover:bg-surface-muted motion-reduce:transition-none"
            >
              +0.5 m
            </button>
          </div>
        </div>
      </form>
      <OpeningSizeEditor
        opening={opening}
        dimensions={dimensions}
        setOpeningDimensions={setOpeningDimensions}
        onFeedback={onFeedback}
      />
    </div>
  );
}

function RowHeading({
  opening,
  onRemove,
  confirming,
}: {
  opening: RoomOpening;
  onRemove: () => void;
  confirming?: boolean;
}) {
  const Icon = opening.kind === 'window' ? AppWindow : DoorOpen;
  const wall = WALL_OPTIONS.find((option) => option.value === opening.wall)?.label.toLowerCase() ?? opening.wall;
  return (
    <p className="flex items-center gap-2 text-small font-semibold text-text">
      <Icon className="size-4 text-accent" aria-hidden="true" />
      <span className="capitalize">{openingName(opening)}</span>
      <span className="font-normal text-text-muted">· {wall}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`${confirming ? 'Confirm removing' : 'Remove'} ${openingName(opening)}`}
        className={`ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-control px-2.5 text-xs font-semibold transition-colors motion-reduce:transition-none ${
          confirming
            ? 'bg-error-soft text-error'
            : 'border border-border bg-surface-raised text-text-muted hover:bg-error-soft hover:text-error'
        }`}
      >
        <Trash2 className="size-3.5 shrink-0" aria-hidden="true" />
        {confirming ? 'Confirm remove' : 'Remove'}
      </button>
    </p>
  );
}

/**
 * Size editor for one opening: along-wall width, height, and (windows
 * only) sill height — the vertical placement of the opening's bottom edge.
 * Doors always sit on the floor (sill 0). Feasible ranges come from the
 * domain so out-of-range requests fail before the store is touched.
 */
function OpeningSizeEditor({
  opening,
  dimensions,
  setOpeningDimensions,
  onFeedback,
}: {
  opening: RoomOpening;
  dimensions: RoomDimensions;
  setOpeningDimensions: (
    openingId: string,
    patch: OpeningDimensionPatch,
  ) => SerializableResult<OpeningMutationResult>;
  onFeedback: (feedback: Feedback) => void;
}) {
  const isWindow = opening.kind === 'window';
  const along = openingAlongWallSize(opening);
  const [wDraft, setWDraft] = useState(meters(along));
  const [hDraft, setHDraft] = useState(meters(opening.height));
  const [sDraft, setSDraft] = useState(meters(opening.sillHeight));
  const alongId = `opening-${opening.id}-along`;
  const heightId = `opening-${opening.id}-height`;
  const sillId = `opening-${opening.id}-sill`;
  const limits = openingDimensionLimits(opening, dimensions);

  useEffect(() => {
    setWDraft(meters(along));
    setHDraft(meters(opening.height));
    setSDraft(meters(opening.sillHeight));
  }, [along, opening.height, opening.id, opening.sillHeight]);

  const numberField = (raw: string, min: number, max: number): number | null => {
    const value = Number(raw);
    return raw.trim() !== '' && Number.isFinite(value) && value >= min && value <= max
      ? value
      : null;
  };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const width = numberField(wDraft, limits.alongSize.min, limits.alongSize.max);
    const height = numberField(hDraft, limits.height.min, limits.height.max);
    const sill = isWindow
      ? numberField(sDraft, limits.sillHeight.min, limits.sillHeight.max)
      : 0;
    if (width === null || height === null || sill === null) {
      onFeedback({
        kind: 'error',
        message: isWindow
          ? `Enter a width between ${meters(limits.alongSize.min)} and ${meters(limits.alongSize.max)} m, a height between ${meters(limits.height.min)} and ${meters(limits.height.max)} m, and a sill between ${meters(limits.sillHeight.min)} and ${meters(limits.sillHeight.max)} m.`
          : `Enter a width between ${meters(limits.alongSize.min)} and ${meters(limits.alongSize.max)} m and a height between ${meters(limits.height.min)} and ${meters(limits.height.max)} m.`,
      });
      return;
    }
    const result = setOpeningDimensions(opening.id, {
      alongSize: width,
      height,
      ...(isWindow ? { sillHeight: sill } : {}),
    });
    if (!result.ok) {
      onFeedback({ kind: 'error', message: result.message });
      return;
    }
    if (!result.data.changed) {
      onFeedback({ kind: 'success', message: 'This opening already has that size.' });
      return;
    }
    onFeedback({
      kind: 'success',
      message: isWindow
        ? `Window resized to ${meters(width)} m wide × ${meters(height)} m tall, sill ${meters(sill)} m above the floor.`
        : `${openingName(opening)} resized to ${meters(width)} m wide × ${meters(height)} m tall.`,
    });
  }

  const inputClass =
    'min-h-11 w-full rounded-control border bg-surface-raised px-3 text-sm tabular-nums text-text shadow-none outline-none transition-colors placeholder:text-text-faint focus:border-accent motion-reduce:transition-none';

  return (
    <form className="mt-3 border-t border-border/60 pt-3" onSubmit={submit} aria-label={`Size of ${openingName(opening)}`}>
      <p className="text-[11px] font-semibold tracking-widest text-text-muted uppercase">Size</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <label className="grid gap-1 text-xs font-medium text-text" htmlFor={alongId}>
          Width (m)
          <input
            id={alongId}
            type="number"
            inputMode="decimal"
            step="0.05"
            min={limits.alongSize.min}
            max={limits.alongSize.max}
            value={wDraft}
            onChange={(event) => setWDraft(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-text" htmlFor={heightId}>
          Height (m)
          <input
            id={heightId}
            type="number"
            inputMode="decimal"
            step="0.05"
            min={limits.height.min}
            max={limits.height.max}
            value={hDraft}
            onChange={(event) => setHDraft(event.target.value)}
            className={inputClass}
          />
        </label>
        {isWindow ? (
          <label className="grid gap-1 text-xs font-medium text-text" htmlFor={sillId}>
            Sill height (m)
            <input
              id={sillId}
              type="number"
              inputMode="decimal"
              step="0.05"
              min={limits.sillHeight.min}
              max={limits.sillHeight.max}
              value={sDraft}
              onChange={(event) => setSDraft(event.target.value)}
              aria-describedby={`${sillId}-hint`}
              className={inputClass}
            />
          </label>
        ) : (
          <p className="grid gap-1 text-xs font-medium text-text">
            Sill height (m)
            <span className="inline-flex min-h-11 items-center rounded-control border border-border bg-surface-muted px-3 text-sm text-text-muted">
              0 · on the floor
            </span>
          </p>
        )}
      </div>
      <p className="mt-1.5 text-[11px] leading-4 text-text-muted">
        {isWindow ? (
          <>
            <span id={`${sillId}-hint`} className="sr-only">
              The sill is the opening's vertical position: 0.9 m is a typical seated height, 1.1 m a
              typical standing height.
            </span>
            Width {meters(limits.alongSize.min)}–{meters(limits.alongSize.max)} m · height{' '}
            {meters(limits.height.min)}–{meters(limits.height.max)} m · sill sets how high the
            window starts off the floor (max {meters(limits.sillHeight.max)} m). The top stays below
            the ceiling.
          </>
        ) : (
          <>
            Width {meters(limits.alongSize.min)}–{meters(limits.alongSize.max)} m · height{' '}
            {meters(limits.height.min)}–{meters(limits.height.max)} m. The top stays below the
            ceiling.
          </>
        )}
      </p>
      <button
        type="submit"
        className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-control border border-accent bg-accent-soft px-3 text-sm font-semibold text-accent-strong transition-colors hover:bg-accent motion-reduce:transition-none"
      >
        Resize {openingName(opening).toLowerCase()}
      </button>
    </form>
  );
}

/** Add form: choose a wall and a kind; the opening lands in the leftmost free span. */
function AddOpeningForm({
  addOpening,
  walls,
  onFeedback,
}: {
  addOpening: (draft: { kind: RoomOpeningKind; wall: WallSide }) => SerializableResult<OpeningMutationResult>;
  walls: readonly RoomOpening[];
  onFeedback: (feedback: Feedback) => void;
}) {
  const [kind, setKind] = useState<RoomOpeningKind>('door');
  const [wall, setWall] = useState<WallSide>('north');
  const kindId = 'add-opening-kind';
  const wallId = 'add-opening-wall';

  function add() {
    const result = addOpening({ kind, wall });
    if (!result.ok) {
      onFeedback({ kind: 'error', message: result.message });
      return;
    }
    onFeedback({
      kind: 'success',
      message: `${result.data.opening.kind === 'window' ? 'Window' : 'Door'} added on the ${wall} wall — move it along the wall to fine-tune.`,
    });
  }

  return (
    <div className="rounded-control border border-dashed border-border p-3">
      <p className="text-xs font-semibold tracking-widest text-accent-strong uppercase">Add an opening</p>
      <p className="mt-1 text-xs leading-5 text-text-muted">
        Put a standard door (0.9 m) or window (1.6 m) on any wall; it lands in the first free span
        and is flagged if furniture blocks it.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-xs font-medium text-text" htmlFor={kindId}>
          Kind
          <select
            id={kindId}
            value={kind}
            onChange={(event) => setKind(event.target.value as RoomOpeningKind)}
            className="min-h-11 w-full rounded-control border border-border bg-surface-raised px-2 text-sm text-text transition-colors motion-reduce:transition-none"
          >
            <option value="door">Door</option>
            <option value="window">Window</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-text" htmlFor={wallId}>
          Wall
          <select
            id={wallId}
            value={wall}
            onChange={(event) => setWall(event.target.value as WallSide)}
            className="min-h-11 w-full rounded-control border border-border bg-surface-raised px-2 text-sm text-text transition-colors motion-reduce:transition-none"
          >
            {WALL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        type="button"
        onClick={add}
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-control border border-accent bg-accent-soft px-3 text-sm font-semibold text-accent-strong transition-colors hover:bg-accent motion-reduce:transition-none"
      >
        <Plus className="size-4" aria-hidden="true" />
        Add {kind === 'door' ? 'door' : 'window'} on this wall
      </button>
      <p className="mt-2 text-[11px] leading-4 text-text-muted">
        {walls.length} opening{walls.length === 1 ? '' : 's'} currently in the room.
      </p>
    </div>
  );
}
