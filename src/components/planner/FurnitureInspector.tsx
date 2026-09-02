'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Box,
  LockKeyhole,
  MoveHorizontal,
  RotateCw,
  Trash2,
  UnlockKeyhole,
} from 'lucide-react';

import { selectSelectedItem, selectSelectedProduct } from '@/store/selectors';
import { useRoomStore } from '@/store/roomStore';

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function coordinate(value: number): string {
  return Number(value.toFixed(2)).toString();
}


/** Inspect, select, and edit furniture placed in the room. */
export function FurnitureInspector() {
  const furniture = useRoomStore((state) => state.furniture);
  const selectedItem = useRoomStore(selectSelectedItem);
  const selectedProduct = useRoomStore(selectSelectedProduct);
  const getProductById = useRoomStore((state) => state.getProductById);
  const validationIssues = useRoomStore((state) => state.validation.issues);
  const selectItem = useRoomStore((state) => state.selectItem);
  const moveProduct = useRoomStore((state) => state.moveProduct);
  const rotateProduct = useRoomStore((state) => state.rotateProduct);
  const removeProduct = useRoomStore((state) => state.removeProduct);
  const setItemLocked = useRoomStore((state) => state.setItemLocked);
  const [x, setX] = useState('');
  const [z, setZ] = useState('');
  const [message, setMessage] = useState('');
  const [messageKind, setMessageKind] = useState<'success' | 'error'>('success');

  useEffect(() => {
    if (!selectedItem) {
      setX('');
      setZ('');
      return;
    }

    setX(coordinate(selectedItem.position.x));
    setZ(coordinate(selectedItem.position.z));
  }, [selectedItem]);

  const announce = (nextMessage: string, kind: 'success' | 'error') => {
    setMessageKind(kind);
    setMessage(nextMessage);
  };

  const applyMove = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedItem) return;
    const nextX = Number(x);
    const nextZ = Number(z);

    if (x.trim() === '' || z.trim() === '' || !Number.isFinite(nextX) || !Number.isFinite(nextZ)) {
      announce('Enter valid numeric X and Z coordinates before applying the move.', 'error');
      return;
    }

    const result = moveProduct(selectedItem.instanceId, nextX, nextZ, 'human');
    if (!result.ok) {
      announce(result.message, 'error');
      return;
    }

    announce(`Moved ${selectedProduct?.name ?? 'item'} to X ${coordinate(nextX)}, Z ${coordinate(nextZ)}.`, 'success');
  };

  const rotate = (degrees: number) => {
    if (!selectedItem) return;

    const rotation = selectedItem.rotation + degrees;
    const result = rotateProduct(selectedItem.instanceId, rotation, 'human');
    if (!result.ok) {
      announce(result.message, 'error');
      return;
    }

    announce(
      `Rotated ${selectedProduct?.name ?? 'item'} to ${coordinate(result.data.item.rotation)} degrees.`,
      'success',
    );
  };

  const toggleLock = () => {
    if (!selectedItem) return;

    const locked = !selectedItem.locked;
    const result = setItemLocked(selectedItem.instanceId, locked, 'human');
    if (!result.ok) {
      announce(result.message, 'error');
      return;
    }

    announce(`${locked ? 'Locked' : 'Unlocked'} ${selectedProduct?.name ?? 'item'}.`, 'success');
  };

  const remove = () => {
    if (!selectedItem) return;

    const result = removeProduct(selectedItem.instanceId, 'human');
    if (!result.ok) {
      announce(result.message, 'error');
      return;
    }

    announce(`Removed ${selectedProduct?.name ?? 'item'} from the room.`, 'success');
  };

  const selectedIssues = selectedItem
    ? validationIssues.filter(
        (issue) => issue.instanceIds.length === 0 || issue.instanceIds.includes(selectedItem.instanceId),
      )
    : [];
  return (
    <aside
      className="flex min-h-0 flex-col overflow-hidden rounded-card border bg-surface shadow-card"
      aria-labelledby="furniture-inspector-title"
    >
      <div className="border-b bg-surface-raised px-4 py-4 sm:px-5">
        <div className="flex items-center gap-2">
          <Box className="size-4 text-accent" aria-hidden="true" />
          <h2 id="furniture-inspector-title" className="font-semibold tracking-tight text-text">
            Room pieces
          </h2>
        </div>
        <p className="mt-1 text-small text-text-muted">Select a piece to position, rotate, or secure it.</p>
      </div>

      <div className="min-h-0 overflow-y-auto">
        <section className="border-b px-4 py-3 sm:px-5" aria-labelledby="placed-items-title">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h3 id="placed-items-title" className="text-small font-semibold text-text">
              Placed items
            </h3>
            <span className="text-small tabular-nums text-text-muted">{furniture.length}</span>
          </div>
          {furniture.length === 0 ? (
            <p className="rounded-control bg-surface-muted px-3 py-3 text-small text-text-muted">
              Add a marketplace piece to begin arranging your room.
            </p>
          ) : (
            <ul className="space-y-1" aria-label="Placed furniture">
              {furniture.map((item) => {
                const product = getProductById(item.productId);
                const selected = item.instanceId === selectedItem?.instanceId;
                return (
                  <li key={item.instanceId}>
                    <button
                      type="button"
                      onClick={() => {
                        selectItem(item.instanceId);
                        setMessage(`Selected ${product?.name ?? 'an item'}.`);
                        setMessageKind('success');
                      }}
                      aria-current={selected ? 'true' : undefined}
                      className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-control px-3 py-2 text-left text-small transition-colors motion-reduce:transition-none ${
                        selected
                          ? 'bg-accent-soft text-accent-strong'
                          : 'text-text hover:bg-surface-muted'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{product?.name ?? item.productId}</span>
                        <span className="block text-xs text-text-muted">
                          {item.source === 'existing' ? 'Existing in room' : 'Marketplace item'}
                        </span>
                      </span>
                      {item.locked ? (
                        <LockKeyhole className="size-4 shrink-0 text-text-muted" aria-label="Locked" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {selectedItem ? (
          <section className="space-y-5 px-4 py-5 sm:px-5" aria-labelledby="selected-piece-title">
            <div>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Selected piece</p>
                  <h3 id="selected-piece-title" className="mt-1 text-subheading font-semibold tracking-tight text-text">
                    {selectedProduct?.name ?? selectedItem.productId}
                  </h3>
                </div>
                <span
                  className={`shrink-0 rounded-pill px-2.5 py-1 text-xs font-semibold ${
                    selectedItem.locked ? 'bg-warning-soft text-warning' : 'bg-surface-muted text-text-muted'
                  }`}
                >
                  {selectedItem.locked ? 'Locked' : 'Unlocked'}
                </span>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-small">
                <div>
                  <dt className="text-text-muted">Source</dt>
                  <dd className="mt-0.5 font-medium text-text">
                    {selectedItem.source === 'existing' ? 'Existing in room' : 'Marketplace item'}
                  </dd>
                </div>
                <div>
                  <dt className="text-text-muted">Cost</dt>
                  <dd className="mt-0.5 font-medium tabular-nums text-text">
                    {selectedItem.source === 'existing'
                      ? '$0 toward budget'
                      : selectedProduct
                        ? `${currency.format(selectedProduct.price)} new cost`
                        : 'Unavailable'}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-text-muted">Dimensions</dt>
                  <dd className="mt-0.5 font-medium tabular-nums text-text">
                    {selectedProduct
                      ? `${coordinate(selectedProduct.width)} W × ${coordinate(selectedProduct.depth)} D × ${coordinate(selectedProduct.height)} H m`
                      : 'Product details unavailable'}
                  </dd>
                </div>
                <div>
                  <dt className="text-text-muted">X / Z</dt>
                  <dd className="mt-0.5 font-medium tabular-nums text-text">
                    {coordinate(selectedItem.position.x)} / {coordinate(selectedItem.position.z)} m
                  </dd>
                </div>
                <div>
                  <dt className="text-text-muted">Rotation</dt>
                  <dd className="mt-0.5 font-medium tabular-nums text-text">{coordinate(selectedItem.rotation)}°</dd>
                </div>
              </dl>
            </div>

            <form onSubmit={applyMove} className="border-t pt-4" aria-labelledby="position-controls-title">
              <h4 id="position-controls-title" className="text-small font-semibold text-text">Position</h4>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="grid gap-1.5 text-small font-medium text-text" htmlFor="furniture-x-coordinate">
                  X coordinate (m)
                  <input
                    id="furniture-x-coordinate"
                    type="number"
                    inputMode="decimal"
                    step="0.05"
                    value={x}
                    onChange={(event) => setX(event.target.value)}
                    className="min-h-11 rounded-control border bg-surface-raised px-3 tabular-nums text-text shadow-none outline-none transition-colors placeholder:text-text-faint focus:border-accent motion-reduce:transition-none"
                  />
                </label>
                <label className="grid gap-1.5 text-small font-medium text-text" htmlFor="furniture-z-coordinate">
                  Z coordinate (m)
                  <input
                    id="furniture-z-coordinate"
                    type="number"
                    inputMode="decimal"
                    step="0.05"
                    value={z}
                    onChange={(event) => setZ(event.target.value)}
                    className="min-h-11 rounded-control border bg-surface-raised px-3 tabular-nums text-text shadow-none outline-none transition-colors placeholder:text-text-faint focus:border-accent motion-reduce:transition-none"
                  />
                </label>
              </div>
              <button
                type="submit"
                className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control bg-accent px-4 py-2 text-small font-semibold text-on-accent transition-colors hover:bg-accent-strong motion-reduce:transition-none"
              >
                <MoveHorizontal className="size-4" aria-hidden="true" />
                Apply move
              </button>
            </form>

            <section className="border-t pt-4" aria-labelledby="rotation-controls-title">
              <h4 id="rotation-controls-title" className="text-small font-semibold text-text">Rotation</h4>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[-15, 15, 90].map((degrees) => (
                  <button
                    key={degrees}
                    type="button"
                    onClick={() => rotate(degrees)}
                    className="inline-flex min-h-11 items-center justify-center gap-1 rounded-control border bg-surface-raised px-2 text-small font-semibold text-text transition-colors hover:bg-surface-muted motion-reduce:transition-none"
                  >
                    <RotateCw className={`size-3.5 ${degrees < 0 ? '-scale-x-100' : ''}`} aria-hidden="true" />
                    {degrees > 0 ? '+' : ''}{degrees}°
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-2 border-t pt-4" aria-label="Furniture actions">
              <button
                type="button"
                onClick={toggleLock}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control border bg-surface-raised px-4 py-2 text-small font-semibold text-text transition-colors hover:bg-surface-muted motion-reduce:transition-none"
              >
                {selectedItem.locked ? <UnlockKeyhole className="size-4" aria-hidden="true" /> : <LockKeyhole className="size-4" aria-hidden="true" />}
                {selectedItem.locked ? 'Unlock item' : 'Lock item'}
              </button>
              {!selectedItem.locked ? (
                <button
                  type="button"
                  onClick={remove}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control border border-error bg-error-soft px-4 py-2 text-small font-semibold text-error transition-colors hover:bg-error-soft motion-reduce:transition-none"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  Remove item
                </button>
              ) : (
                <p className="rounded-control bg-surface-muted px-3 py-2 text-xs leading-5 text-text-muted">
                  Locked items can still move and rotate, but must be unlocked before removal.
                </p>
              )}
            </section>

            <section className="border-t pt-4" aria-labelledby="validation-title">
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
                <h4 id="validation-title" className="text-small font-semibold text-text">Layout checks</h4>
              </div>
              {selectedIssues.length === 0 ? (
                <p className="mt-2 text-small text-text-muted">No validation issues for this item.</p>
              ) : (
                <ul className="mt-2 space-y-2" aria-label="Validation issues for selected item">
                  {selectedIssues.map((issue, index) => (
                    <li
                      key={`${issue.kind}-${issue.refId ?? index}`}
                      className={`rounded-control px-3 py-2 text-small ${
                        issue.severity === 'error' ? 'bg-error-soft text-error' : 'bg-warning-soft text-warning'
                      }`}
                    >
                      {issue.message}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </section>
        ) : (
          <section className="px-4 py-6 sm:px-5" aria-live="polite">
            <p className="text-small font-medium text-text">Choose a room piece to inspect it.</p>
            <p className="mt-1 text-small text-text-muted">Its dimensions, placement, and controls will appear here.</p>
          </section>
        )}
      </div>

      <p
        className={`border-t px-4 py-3 text-small sm:px-5 ${messageKind === 'error' ? 'bg-error-soft text-error' : 'bg-success-soft text-success'}`}
        aria-live="polite"
        aria-atomic="true"
      >
        {message || 'Select an item to make changes.'}
      </p>
    </aside>
  );
}
