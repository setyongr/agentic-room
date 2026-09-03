'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Box,
  LockKeyhole,
  MoveHorizontal,
  MoveVertical,
  RotateCw,
  ShoppingBag,
  Tag,
  Trash2,
  UnlockKeyhole,
} from 'lucide-react';

import { furnitureHex } from '@/data/appearance';
import type { FurnitureSource } from '@/domain/types';
import { selectSelectedItem, selectSelectedProduct } from '@/store/selectors';
import { useRoomStore } from '@/store/roomStore';
import { useModelThumbnail } from '@/components/three/modelThumbnail';

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
  const setItemSource = useRoomStore((state) => state.setItemSource);
  const setItemElevation = useRoomStore((state) => state.setItemElevation);
  const userModels = useRoomStore((state) => state.userModels);
  const selectedUserModelId = useRoomStore((state) => state.selectedUserModelId);
  const selectUserModel = useRoomStore((state) => state.selectUserModel);
  const moveUserModel = useRoomStore((state) => state.moveUserModel);
  const rotateUserModel = useRoomStore((state) => state.rotateUserModel);
  const removeUserModel = useRoomStore((state) => state.removeUserModel);
  const setUserModelLocked = useRoomStore((state) => state.setUserModelLocked);
  const selectedUserModel = userModels.find((m) => m.id === selectedUserModelId);
  const [x, setX] = useState('');
  const [z, setZ] = useState('');
  const [y, setY] = useState('');
  const [umX, setUmX] = useState('');
  const [umZ, setUmZ] = useState('');
  const [message, setMessage] = useState('');
  const [messageKind, setMessageKind] = useState<'success' | 'error'>('success');
  useEffect(() => {
    if (!selectedItem) {
      setX('');
      setZ('');
      setY('');
      return;
    }

    setX(coordinate(selectedItem.position.x));
    setZ(coordinate(selectedItem.position.z));
    setY(coordinate(selectedItem.position.y));
  }, [selectedItem]);

  // Uploaded-model state sync: mirror the selected model's coordinates into the form.
  useEffect(() => {
    const model = userModels.find((m) => m.id === selectedUserModelId);
    if (!model) {
      setUmX('');
      setUmZ('');
      return;
    }
    setUmX(coordinate(model.position.x));
    setUmZ(coordinate(model.position.z));
  }, [selectedUserModelId, userModels]);

  const applyUserModelMove = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const model = userModels.find((m) => m.id === selectedUserModelId);
    if (!model) return;
    const nextX = Number(umX);
    const nextZ = Number(umZ);
    if (umX.trim() === '' || umZ.trim() === '' || !Number.isFinite(nextX) || !Number.isFinite(nextZ)) {
      announce('Enter valid numeric X and Z coordinates before applying the move.', 'error');
      return;
    }
    const result = moveUserModel(model.id, nextX, nextZ);
    if (!result.ok) {
      announce(result.message, 'error');
      return;
    }
    announce(`Moved “${model.name}” to X ${coordinate(nextX)}, Z ${coordinate(nextZ)}.`, 'success');
  };

  const rotateUserModelBy = (degrees: number) => {
    const model = userModels.find((m) => m.id === selectedUserModelId);
    if (!model) return;
    const rotation = model.rotation + degrees;
    const result = rotateUserModel(model.id, rotation);
    if (!result.ok) {
      announce(result.message, 'error');
      return;
    }
    announce(`Rotated “${model.name}” to ${coordinate(result.data.rotation)} degrees.`, 'success');
  };

  const toggleUserModelLock = () => {
    const model = userModels.find((m) => m.id === selectedUserModelId);
    if (!model) return;
    const locked = !model.locked;
    const result = setUserModelLocked(model.id, locked);
    if (!result.ok) {
      announce(result.message, 'error');
      return;
    }
    announce(`${locked ? 'Locked' : 'Unlocked'} “${model.name}”.`, 'success');
  };

  const removeUserModelItem = () => {
    const model = userModels.find((m) => m.id === selectedUserModelId);
    if (!model) return;
    const result = removeUserModel(model.id);
    if (!result.ok) {
      announce(result.message, 'error');
      return;
    }
    announce(`Removed “${model.name}” from the room.`, 'success');
  };


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

  const setHeight = (nextY: number) => {
    if (!selectedItem) return;
    const result = setItemElevation(selectedItem.instanceId, nextY, 'human');
    if (!result.ok) {
      announce(result.message, 'error');
      return;
    }
    announce(
      `Height of ${selectedProduct?.name ?? 'item'} set to ${coordinate(nextY)} m above the floor.`,
      'success',
    );
  };

  const applyHeight = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedItem) return;
    const nextY = Number(y);
    if (y.trim() === '' || !Number.isFinite(nextY) || nextY < 0) {
      announce('Enter a height of 0 m or more before applying.', 'error');
      return;
    }
    setHeight(nextY);
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

  const changeSource = (source: FurnitureSource) => {
    if (!selectedItem) return;
    const name = selectedProduct?.name ?? 'item';
    const result = setItemSource(selectedItem.instanceId, source);
    if (!result.ok) {
      announce(result.message, 'error');
      return;
    }
    announce(
      source === 'existing'
        ? `“${name}” is now an existing owned piece — it no longer counts toward the budget.`
        : `“${name}” is now a marketplace purchase — it counts toward the budget.`,
      'success',
    );
  };

  const selectedIssues = selectedItem
    ? validationIssues.filter(
        (issue) => issue.instanceIds.length === 0 || issue.instanceIds.includes(selectedItem.instanceId),
      )
    : [];
  return (
    <aside
      className="flex h-full min-h-0 flex-col overflow-hidden bg-surface"
      aria-labelledby="furniture-inspector-title"
    >
      <header className="border-b border-border px-4 py-4 sm:px-5">
        <div className="flex items-center gap-2">
          <Box className="size-4 text-accent" aria-hidden="true" />
          <h2 id="furniture-inspector-title" className="font-semibold tracking-tight text-text">
            Room pieces
          </h2>
        </div>
        <p className="mt-1 text-small text-text-muted">Select a piece to position, rotate, or secure it.</p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <section className="border-b px-4 py-3 sm:px-5" aria-labelledby="placed-items-title">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h3 id="placed-items-title" className="text-small font-semibold text-text">
              Placed items
            </h3>
            <span className="text-small tabular-nums text-text-muted">{furniture.length}</span>
          </div>
          {furniture.length === 0 ? (
            <p className="border-l-2 border-border py-2 pl-3 text-small text-text-muted">
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

        {userModels.length > 0 ? (
          <section className="border-b px-4 py-3 sm:px-5" aria-labelledby="user-models-title">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3 id="user-models-title" className="text-small font-semibold text-text">Uploaded models</h3>
              <span className="text-small tabular-nums text-text-muted">{userModels.length}</span>
            </div>
            <ul className="space-y-1" aria-label="Uploaded models">
              {userModels.map((model) => {
                const selected = model.id === selectedUserModelId;
                return (
                  <li key={model.id}>
                    <button
                      type="button"
                      onClick={() => {
                        selectUserModel(model.id);
                        setMessage(`Selected “${model.name}”.`);
                        setMessageKind('success');
                      }}
                      aria-current={selected ? 'true' : undefined}
                      className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-control px-3 py-2 text-left text-small transition-colors motion-reduce:transition-none ${selected ? 'bg-accent-soft text-accent-strong' : 'text-text hover:bg-surface-muted'}`}
                    >
                      <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-control border border-border bg-surface-muted">
                        <UserModelThumb url={model.url} className="size-full object-cover" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{model.name}</span>
                        <span className="block text-xs text-text-muted">Uploaded model · session only</span>
                      </span>
                      {model.locked ? <LockKeyhole className="size-4 shrink-0 text-text-muted" aria-label="Locked" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

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
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className={`rounded-pill px-2.5 py-1 text-xs font-semibold ${
                      selectedItem.locked ? 'bg-warning-soft text-warning' : 'bg-surface-muted text-text-muted'
                    }`}
                  >
                    {selectedItem.locked ? 'Locked' : 'Unlocked'}
                  </span>
                  <button
                    type="button"
                    className="min-h-11 rounded-control px-2 text-xs font-semibold text-accent-strong transition-colors hover:bg-accent-soft motion-reduce:transition-none"
                    onClick={() => {
                      selectItem(null);
                      announce('Selection cleared.', 'success');
                    }}
                  >
                    Clear selection
                  </button>
                </div>
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
                <div className="col-span-2">
                  <dt className="text-text-muted">Finish</dt>
                  <dd className="mt-0.5 flex items-center gap-1.5 font-medium text-text">
                    <span
                      aria-hidden="true"
                      className="inline-block size-3 shrink-0 rounded-pill border border-border"
                      style={{ background: furnitureHex(selectedItem.variant.color) }}
                    />
                    <span className="capitalize">
                      {selectedItem.variant.color} · {selectedItem.variant.material}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-text-muted">X / Y / Z</dt>
                  <dd className="mt-0.5 font-medium tabular-nums text-text">
                    {coordinate(selectedItem.position.x)} / {coordinate(selectedItem.position.y)} /{' '}
                    {coordinate(selectedItem.position.z)} m
                  </dd>
                </div>
                <div>
                  <dt className="text-text-muted">Rotation</dt>
                  <dd className="mt-0.5 font-medium tabular-nums text-text">{coordinate(selectedItem.rotation)}°</dd>
                </div>
              </dl>
            </div>

            <section className="border-t pt-4" aria-labelledby="ownership-title">
              <h4 id="ownership-title" className="text-small font-semibold text-text">Ownership</h4>
              <p className="mt-1 text-xs leading-5 text-text-muted">
                Existing pieces are already owned and never count toward your budget; marketplace
                pieces are new purchases that do. Changing ownership updates the budget instantly.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Ownership for the selected piece">
                <button
                  type="button"
                  aria-pressed={selectedItem.source === 'existing'}
                  onClick={() => changeSource('existing')}
                  className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control border px-2 text-small font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none ${
                    selectedItem.source === 'existing'
                      ? 'border-accent bg-accent-soft text-accent-strong'
                      : 'border-border bg-surface-raised text-text hover:bg-surface-muted'
                  }`}
                >
                  <Tag className="size-4 shrink-0" aria-hidden="true" />
                  Already owned
                </button>
                <button
                  type="button"
                  aria-pressed={selectedItem.source === 'marketplace'}
                  onClick={() => changeSource('marketplace')}
                  className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control border px-2 text-small font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none ${
                    selectedItem.source === 'marketplace'
                      ? 'border-accent bg-accent-soft text-accent-strong'
                      : 'border-border bg-surface-raised text-text hover:bg-surface-muted'
                  }`}
                >
                  <ShoppingBag className="size-4 shrink-0" aria-hidden="true" />
                  Buy new
                </button>
              </div>
            </section>

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

            <form onSubmit={applyHeight} className="border-t pt-4" aria-labelledby="height-controls-title">
              <h4 id="height-controls-title" className="text-small font-semibold text-text">Height above floor</h4>
              <p className="mt-1 text-xs leading-5 text-text-muted">
                Set how high the piece sits off the floor — raise TVs, wall art, and shelves to hang
                them. The top of the piece must stay below the ceiling.
              </p>
              <div className="mt-3 flex items-end gap-2">
                <label className="grid min-w-0 flex-1 gap-1.5 text-small font-medium text-text" htmlFor="furniture-y-coordinate">
                  Height (m)
                  <input
                    id="furniture-y-coordinate"
                    type="number"
                    inputMode="decimal"
                    step="0.05"
                    min="0"
                    value={y}
                    onChange={(event) => setY(event.target.value)}
                    className="min-h-11 w-full rounded-control border bg-surface-raised px-3 tabular-nums text-text shadow-none outline-none transition-colors placeholder:text-text-faint focus:border-accent motion-reduce:transition-none"
                  />
                </label>
                <button
                  type="submit"
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control bg-accent px-3 text-small font-semibold text-on-accent transition-colors hover:bg-accent-strong motion-reduce:transition-none"
                >
                  <MoveVertical className="size-4" aria-hidden="true" />
                  Apply
                </button>
              </div>
              <div className="mt-2 flex gap-2">
                {[0, 0.45, 1.2].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setHeight(preset)}
                    aria-label={`Set height to ${preset === 0 ? '0 meters, on the floor' : `${preset} meters`}`}
                    className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-control border px-2 text-xs font-semibold transition-colors motion-reduce:transition-none ${
                      Math.abs((selectedItem?.position.y ?? 0) - preset) < 0.001
                        ? 'border-accent bg-accent-soft text-accent-strong'
                        : 'border-border bg-surface-raised text-text hover:bg-surface-muted'
                    }`}
                  >
                    {preset === 0 ? 'Floor 0 m' : `${preset} m`}
                  </button>
                ))}
              </div>
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
        ) : selectedUserModel ? (
          <section className="space-y-5 px-4 py-5 sm:px-5" aria-labelledby="user-model-title">
            <div>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Selected upload</p>
                  <h3 id="user-model-title" className="mt-1 truncate text-subheading font-semibold tracking-tight text-text">{selectedUserModel.name}</h3>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className={`rounded-pill px-2.5 py-1 text-xs font-semibold ${selectedUserModel.locked ? 'bg-warning-soft text-warning' : 'bg-surface-muted text-text-muted'}`}
                  >
                    {selectedUserModel.locked ? 'Locked' : 'Unlocked'}
                  </span>
                  <button
                    type="button"
                    className="min-h-11 rounded-control px-2 text-xs font-semibold text-accent-strong transition-colors hover:bg-accent-soft motion-reduce:transition-none"
                    onClick={() => {
                      selectUserModel(null);
                      announce('Selection cleared.', 'success');
                    }}
                  >
                    Clear selection
                  </button>
                </div>
              </div>
              <div className="mt-3 flex justify-center" aria-hidden="true">
                <div className="size-36 overflow-hidden rounded-card border border-border">
                  <UserModelThumb url={selectedUserModel.url} className="size-full object-cover" />
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-small">
                <div>
                  <dt className="text-text-muted">Source</dt>
                  <dd className="mt-0.5 font-medium text-text">Uploaded model (session only)</dd>
                </div>
                <div>
                  <dt className="text-text-muted">Cost</dt>
                  <dd className="mt-0.5 font-medium tabular-nums text-text">Not counted toward budget</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-text-muted">Dimensions</dt>
                  <dd className="mt-0.5 font-medium tabular-nums text-text">
                    {coordinate(selectedUserModel.width)} W × {coordinate(selectedUserModel.depth)} D × {coordinate(selectedUserModel.height)} H m
                  </dd>
                </div>
                <div>
                  <dt className="text-text-muted">X / Z</dt>
                  <dd className="mt-0.5 font-medium tabular-nums text-text">
                    {coordinate(selectedUserModel.position.x)} / {coordinate(selectedUserModel.position.z)} m
                  </dd>
                </div>
                <div>
                  <dt className="text-text-muted">Rotation</dt>
                  <dd className="mt-0.5 font-medium tabular-nums text-text">{coordinate(selectedUserModel.rotation)}°</dd>
                </div>
              </dl>
            </div>

            <form onSubmit={applyUserModelMove} className="border-t pt-4" aria-labelledby="user-model-position-title">
              <h4 id="user-model-position-title" className="text-small font-semibold text-text">Position</h4>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="grid gap-1.5 text-small font-medium text-text" htmlFor="user-model-x-coordinate">
                  X coordinate (m)
                  <input
                    id="user-model-x-coordinate"
                    type="number"
                    inputMode="decimal"
                    step="0.05"
                    value={umX}
                    onChange={(event) => setUmX(event.target.value)}
                    className="min-h-11 rounded-control border bg-surface-raised px-3 tabular-nums text-text shadow-none outline-none transition-colors placeholder:text-text-faint focus:border-accent motion-reduce:transition-none"
                  />
                </label>
                <label className="grid gap-1.5 text-small font-medium text-text" htmlFor="user-model-z-coordinate">
                  Z coordinate (m)
                  <input
                    id="user-model-z-coordinate"
                    type="number"
                    inputMode="decimal"
                    step="0.05"
                    value={umZ}
                    onChange={(event) => setUmZ(event.target.value)}
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

            <section className="border-t pt-4" aria-labelledby="user-model-rotation-title">
              <h4 id="user-model-rotation-title" className="text-small font-semibold text-text">Rotation</h4>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[-15, 15, 90].map((degrees) => (
                  <button
                    key={degrees}
                    type="button"
                    onClick={() => rotateUserModelBy(degrees)}
                    className="inline-flex min-h-11 items-center justify-center gap-1 rounded-control border bg-surface-raised px-2 text-small font-semibold text-text transition-colors hover:bg-surface-muted motion-reduce:transition-none"
                  >
                    <RotateCw className={`size-3.5 ${degrees < 0 ? '-scale-x-100' : ''}`} aria-hidden="true" />
                    {degrees > 0 ? '+' : ''}{degrees}°
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-2 border-t pt-4" aria-label="Uploaded model actions">
              <button
                type="button"
                onClick={toggleUserModelLock}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control border bg-surface-raised px-4 py-2 text-small font-semibold text-text transition-colors hover:bg-surface-muted motion-reduce:transition-none"
              >
                {selectedUserModel.locked ? <UnlockKeyhole className="size-4" aria-hidden="true" /> : <LockKeyhole className="size-4" aria-hidden="true" />}
                {selectedUserModel.locked ? 'Unlock model' : 'Lock model'}
              </button>
              {!selectedUserModel.locked ? (
                <button
                  type="button"
                  onClick={removeUserModelItem}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control border border-error bg-error-soft px-4 py-2 text-small font-semibold text-error transition-colors hover:bg-error-soft motion-reduce:transition-none"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  Remove model
                </button>
              ) : null}
            </section>

            <p className="border-l-2 border-border py-2 pl-3 text-xs leading-5 text-text-muted">
              Uploaded models live only in this session: they are excluded from validation, budgets, agent tools, and saved designs.
            </p>
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

/** Session-generated thumbnail for an uploaded GLB; hidden until ready. */
function UserModelThumb({ url, className }: { url: string; className: string }) {
  const src = useModelThumbnail(url);
  if (src === undefined) return null;
  return <img src={src} alt="" draggable={false} className={className} />;
}
