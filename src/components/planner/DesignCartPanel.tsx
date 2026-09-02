'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { FolderOpen, Plus, RotateCcw, Save, ShoppingBag, Sparkles } from 'lucide-react';
import { getProductById } from '@/domain/catalog';
import { selectCartCount, selectCartTotal } from '@/store/selectors';
import { useRoomStore } from '@/store/roomStore';

function money(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

interface DesignCartPanelProps {
  view: 'designs' | 'cart';
}

export function DesignCartPanel({ view }: DesignCartPanelProps) {
  const savedDesigns = useRoomStore((state) => state.savedDesigns);
  const furniture = useRoomStore((state) => state.furniture);
  const cart = useRoomStore((state) => state.cart);
  const cartCount = useRoomStore(selectCartCount);
  const cartTotal = useRoomStore(selectCartTotal);
  const saveDesign = useRoomStore((state) => state.saveDesign);
  const loadDesign = useRoomStore((state) => state.loadDesign);
  const resetToDefault = useRoomStore((state) => state.resetToDefault);
  const loadBudgetRescue = useRoomStore((state) => state.loadBudgetRescue);
  const addToCart = useRoomStore((state) => state.addToCart);
  const [designName, setDesignName] = useState('');
  const [message, setMessage] = useState('');
  const [messageKind, setMessageKind] = useState<'success' | 'error'>('success');
  const [confirmingReset, setConfirmingReset] = useState(false);

  function announce(nextMessage: string, kind: 'success' | 'error') {
    setMessage(nextMessage);
    setMessageKind(kind);
  }

  const purchasableItems = useMemo(
    () => furniture.filter((item) => item.source === 'marketplace'),
    [furniture],
  );
  const cartedInstanceIds = useMemo(
    () => new Set(cart.items.flatMap((item) => (item.instanceId ? [item.instanceId] : []))),
    [cart.items],
  );
  const availableCartItems = useMemo(
    () => purchasableItems.filter((item) => !cartedInstanceIds.has(item.instanceId)),
    [cartedInstanceIds, purchasableItems],
  );

  function saveCurrentDesign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = designName.trim();
    if (!name) {
      announce('Name this design before saving it.', 'error');
      return;
    }
    const result = saveDesign(name, {}, 'human');
    if (!result.ok) {
      announce(result.message, 'error');
      return;
    }
    setDesignName('');
    announce(`Saved “${result.data.name}”.`, 'success');
  }

  function restoreDesign(designId: string, name: string) {
    const result = loadDesign(designId, 'human');
    announce(result.ok ? `Loaded “${name}”.` : result.message, result.ok ? 'success' : 'error');
  }

  function restoreDefault() {
    const result = resetToDefault('human');
    setConfirmingReset(false);
    announce(result.ok ? 'Room reset to the default arrangement.' : result.message, result.ok ? 'success' : 'error');
  }

  function rescueBudget() {
    const result = loadBudgetRescue('human');
    announce(result.ok ? 'Budget Rescue starter loaded.' : result.message, result.ok ? 'success' : 'error');
  }

  function addAvailableItems() {
    if (availableCartItems.length === 0) {
      announce('Every marketplace item in this room is already in the cart.', 'success');
      return;
    }
    const result = addToCart(availableCartItems.map((item) => item.instanceId), 'human');
    announce(
      result.ok
        ? `${availableCartItems.length} marketplace item${availableCartItems.length === 1 ? '' : 's'} added to the cart.`
        : result.message,
      result.ok ? 'success' : 'error',
    );
  }

  return (
    <aside className="space-y-5" aria-label={view === 'designs' ? 'Design tools' : 'Cart tools'}>
      {view === 'designs' ? (
        <>
          <section aria-labelledby="design-library-heading">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold tracking-widest text-accent-strong uppercase">Your plan</p>
                <h2 id="design-library-heading" className="mt-1 text-subheading font-semibold tracking-tight text-text">
                  Design library
                </h2>
              </div>
              <FolderOpen className="mt-1 size-5 text-text-muted" aria-hidden="true" />
            </div>

            <form className="mt-4 flex gap-2" onSubmit={saveCurrentDesign}>
              <label className="sr-only" htmlFor="design-name">Design name</label>
              <input
                id="design-name"
                value={designName}
                onChange={(event) => setDesignName(event.target.value)}
                placeholder="Sunday morning layout"
                className="min-h-11 min-w-0 flex-1 rounded-control border border-border bg-surface px-3 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-focus-ring"
              />
              <button type="submit" className="inline-flex min-h-11 items-center gap-2 rounded-control bg-accent px-3 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong focus:outline-none focus:ring-2 focus:ring-focus-ring focus:ring-offset-2 motion-reduce:transition-none">
                <Save className="size-4" aria-hidden="true" />
                Save design
              </button>
            </form>
          </section>

          <section className="border-y border-border" aria-label="Saved designs">
            {savedDesigns.length === 0 ? (
              <p className="py-4 text-sm leading-6 text-text-muted">
                Name this arrangement above to save it and return to it later.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {savedDesigns.map((design) => (
                  <li key={design.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-text">{design.name}</p>
                      <p className="mt-0.5 text-xs text-text-muted">{design.items.length} pieces · {money(design.budget)} budget</p>
                    </div>
                    <button type="button" onClick={() => restoreDesign(design.id, design.name)} className="min-h-11 shrink-0 rounded-control px-3 text-sm font-semibold text-accent-strong transition-colors hover:bg-accent-soft focus:outline-none focus:ring-2 focus:ring-focus-ring motion-reduce:transition-none">
                      Load
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {confirmingReset ? (
            <section className="border-l-2 border-warning pl-3" aria-label="Confirm room reset">
              <p className="text-sm font-medium text-text">Reset this room to its default arrangement?</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={restoreDefault} className="min-h-11 rounded-control bg-warning px-3 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong focus:outline-none focus:ring-2 focus:ring-focus-ring motion-reduce:transition-none">Reset room</button>
                <button type="button" onClick={() => setConfirmingReset(false)} className="min-h-11 rounded-control px-3 text-sm font-semibold text-text-muted transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-focus-ring motion-reduce:transition-none">Keep editing</button>
              </div>
            </section>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => setConfirmingReset(true)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-border px-3 text-sm font-semibold text-text transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-focus-ring motion-reduce:transition-none">
                <RotateCcw className="size-4" aria-hidden="true" />
                Reset room
              </button>
              <button type="button" onClick={rescueBudget} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-border px-3 text-sm font-semibold text-text transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-focus-ring motion-reduce:transition-none">
                <Sparkles className="size-4" aria-hidden="true" />
                Load Budget Rescue
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <section aria-labelledby="cart-heading">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold tracking-widest text-accent-strong uppercase">Marketplace</p>
                <h2 id="cart-heading" className="mt-1 text-subheading font-semibold tracking-tight text-text">Room cart</h2>
              </div>
              <span className="inline-flex min-h-11 items-center rounded-pill bg-surface-muted px-3 font-mono text-sm font-semibold tabular-nums text-text">
                {cartCount} items
              </span>
            </div>

            <button
              type="button"
              onClick={addAvailableItems}
              disabled={availableCartItems.length === 0}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control bg-accent px-3 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong focus:outline-none focus:ring-2 focus:ring-focus-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-faint motion-reduce:transition-none"
            >
              <Plus className="size-4" aria-hidden="true" />
              {availableCartItems.length === 0 ? 'Cart is up to date' : `Add ${availableCartItems.length} room item${availableCartItems.length === 1 ? '' : 's'}`}
            </button>
            <p className="mt-2 text-xs leading-5 text-text-muted">Only marketplace pieces can be added. Existing room items stay out of your cart.</p>
          </section>

          <section className="border-y border-border" aria-label="Cart contents">
            {cart.items.length === 0 ? (
              <div className="py-5">
                <ShoppingBag className="size-5 text-text-muted" aria-hidden="true" />
                <p className="mt-2 text-sm font-medium text-text">Your cart is ready when you are.</p>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  {availableCartItems.length > 0
                    ? 'Add the marketplace pieces already in your room, or place another item from the rail.'
                    : 'Place marketplace furniture in the room, then add it here.'}
                </p>
              </div>
            ) : (
              <>
                <ul aria-label="Cart items" className="divide-y divide-border">
                  {cart.items.map((item) => {
                    const product = getProductById(item.productId);
                    const name = product?.name ?? item.productId;
                    return (
                      <li key={item.id} className="grid grid-cols-2 gap-x-3 gap-y-1 py-3">
                        <p className="truncate text-sm font-semibold text-text">{name}</p>
                        <p className="text-right font-mono text-sm font-semibold tabular-nums text-text">{money(item.unitPrice * item.quantity)}</p>
                        <p className="text-xs text-text-muted">{product?.category ?? 'Marketplace item'} · {money(item.unitPrice)} each</p>
                        <p className="text-right font-mono text-xs tabular-nums text-text-muted">Qty {item.quantity}</p>
                      </li>
                    );
                  })}
                </ul>
                <div className="flex items-center justify-between border-t border-border py-3">
                  <span className="text-sm font-semibold text-text">Estimated total</span>
                  <span className="font-mono text-base font-semibold tabular-nums text-text">{money(cartTotal)}</span>
                </div>
              </>
            )}
          </section>
        </>
      )}

      {message ? (
        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={`border-l-2 pl-3 text-sm ${messageKind === 'error' ? 'border-error text-error' : 'border-success text-text-muted'}`}
        >
          {message}
        </p>
      ) : null}
    </aside>
  );
}
