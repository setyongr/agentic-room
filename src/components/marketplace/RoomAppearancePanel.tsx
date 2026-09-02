'use client';

import { useState, type CSSProperties } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import {
  DEFAULT_ROOM_APPEARANCE,
  FLOOR_FINISHES,
  WALL_FINISHES,
  WALLPAPERS,
  floorPreviewStyle,
  wallpaperPreviewStyle,
} from '@/data/appearance';
import type { FloorFinishId, RoomAppearance, WallFinishId, WallpaperId } from '@/domain/types';
import { useRoomStore } from '@/store/roomStore';

type Feedback = { kind: 'success' | 'error'; message: string; appearance: RoomAppearance } | null;

/** Normalized finish option for rendering: stable id, label, and preview styling. */
interface FinishChoice {
  id: WallFinishId | FloorFinishId | WallpaperId;
  name: string;
  /** CSS for the swatch preview block. */
  preview: CSSProperties;
  /** Solid accent dot color under the label. */
  dot: string;
}

const WALL_CHOICES: readonly FinishChoice[] = WALL_FINISHES.map((option) => ({
  id: option.id,
  name: option.name,
  preview: { background: `linear-gradient(160deg, ${option.wall}, ${option.trim})` },
  dot: option.wall,
}));

const FLOOR_CHOICES: readonly FinishChoice[] = FLOOR_FINISHES.map((option) => ({
  id: option.id,
  name: option.name,
  preview: floorPreviewStyle(option),
  dot: option.base,
}));

const WALLPAPER_CHOICES: readonly FinishChoice[] = WALLPAPERS.map((option) => ({
  id: option.id,
  name: option.name,
  preview: wallpaperPreviewStyle(option),
  dot: option.ink ?? WALL_FINISHES[0].wall,
}));

const KIND_LABEL: Record<'wallFinishId' | 'floorFinishId' | 'wallpaperId', string> = {
  wallFinishId: 'Wall finish',
  floorFinishId: 'Floor finish',
  wallpaperId: 'Wallpaper',
};

export function RoomAppearancePanel() {
  const roomAppearance = useRoomStore((state) => state.roomAppearance);
  const setRoomAppearance = useRoomStore((state) => state.setRoomAppearance);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const currentFeedback = feedback?.appearance === roomAppearance ? feedback : null;

  const atDefaults =
    roomAppearance.wallFinishId === DEFAULT_ROOM_APPEARANCE.wallFinishId &&
    roomAppearance.floorFinishId === DEFAULT_ROOM_APPEARANCE.floorFinishId &&
    roomAppearance.wallpaperId === DEFAULT_ROOM_APPEARANCE.wallpaperId;

  function applyPatch(
    patch: Partial<RoomAppearance>,
    optionName: string,
    kind: keyof typeof KIND_LABEL,
  ) {
    const result = setRoomAppearance(patch, 'human');
    setFeedback(
      result.ok
        ? { kind: 'success', message: `${KIND_LABEL[kind]}: ${optionName}`, appearance: useRoomStore.getState().roomAppearance }
        : { kind: 'error', message: result.message, appearance: roomAppearance },
    );
  }

  function resetFinishes() {
    const result = setRoomAppearance(DEFAULT_ROOM_APPEARANCE, 'human');
    setFeedback(
      result.ok
        ? { kind: 'success', message: 'Room finishes reset to the defaults.', appearance: useRoomStore.getState().roomAppearance }
        : { kind: 'error', message: result.message, appearance: roomAppearance },
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
        <div className="space-y-6">
          <FinishGroup
            legend="Wall finish"
            kind="wallFinishId"
            options={WALL_CHOICES}
            current={roomAppearance.wallFinishId}
            onPick={(choice) =>
              applyPatch(
                { wallFinishId: choice.id as WallFinishId },
                choice.name,
                'wallFinishId',
              )
            }
          />
          <FinishGroup
            legend="Floor finish"
            kind="floorFinishId"
            options={FLOOR_CHOICES}
            current={roomAppearance.floorFinishId}
            onPick={(choice) =>
              applyPatch(
                { floorFinishId: choice.id as FloorFinishId },
                choice.name,
                'floorFinishId',
              )
            }
          />
          <FinishGroup
            legend="Wallpaper"
            kind="wallpaperId"
            options={WALLPAPER_CHOICES}
            current={roomAppearance.wallpaperId}
            onPick={(choice) =>
              applyPatch(
                { wallpaperId: choice.id as WallpaperId },
                choice.name,
                'wallpaperId',
              )
            }
          />
        </div>

        <div className="mt-6 border-t border-border pt-4">
          <button
            type="button"
            onClick={resetFinishes}
            disabled={atDefaults}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-border px-3 text-sm font-semibold text-text transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:text-text-faint motion-reduce:transition-none"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            Reset finishes
          </button>
        </div>

      </div>
      <div role="status" aria-atomic="true" aria-live="polite" className="shrink-0 border-t border-border px-4 py-3 sm:px-5">
        <p className={`text-sm ${currentFeedback?.kind === 'error' ? 'text-error' : 'text-text-muted'}`}>
          {currentFeedback?.message ?? 'Finishes update the room instantly.'}
        </p>
      </div>
    </div>
  );
}

function FinishGroup({
  legend,
  kind,
  options,
  current,
  onPick,
}: {
  legend: string;
  kind: 'wallFinishId' | 'floorFinishId' | 'wallpaperId';
  options: readonly FinishChoice[];
  current: string;
  onPick: (choice: FinishChoice) => void;
}) {
  const groupName = `finish-${kind}`;
  return (
    <fieldset>
      <legend className="text-xs font-semibold tracking-widest text-accent-strong uppercase">{legend}</legend>
      <ul className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label={`${legend} options`}>
        {options.map((option) => {
          const checked = option.id === current;
          const inputId = `${groupName}-${option.id}`;
          return (
            <li key={option.id}>
              <input
                className="peer sr-only"
                id={inputId}
                type="radio"
                name={groupName}
                value={option.id}
                checked={checked}
                onChange={() => onPick(option)}
              />
              <label
                htmlFor={inputId}
                className={`block cursor-pointer rounded-card border p-2 transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent motion-reduce:transition-none ${
                  checked ? 'border-accent bg-accent-soft' : 'border-border bg-surface-raised hover:border-accent'
                }`}
              >
                <span
                  aria-hidden="true"
                  className="relative block h-12 overflow-hidden rounded-control border border-border"
                  style={option.preview}
                >
                  {checked ? (
                    <span className="absolute inset-0 flex items-center justify-center bg-accent/15">
                      <Check className="size-5 text-accent-strong" aria-hidden="true" />
                    </span>
                  ) : null}
                </span>
                <span className="mt-2 flex min-h-6 items-center gap-1.5 text-xs font-medium text-text">
                  <span
                    aria-hidden="true"
                    className={`size-2 shrink-0 rounded-pill border border-black/10 ${checked ? 'bg-accent' : ''}`}
                    style={checked ? undefined : { background: option.dot }}
                  />
                  <span className="truncate">{option.name}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
