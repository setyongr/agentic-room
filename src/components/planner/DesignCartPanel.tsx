'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { CheckCircle2, CreditCard, FolderOpen, FolderPlus, Plus, RotateCcw, Save, ShoppingBag, Sparkles, Trash2 } from 'lucide-react';
import { appearancePreviewGradient, resolveAppearance } from '@/data/appearance';
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
  const removeCartItem = useRoomStore((state) => state.removeCartItem);
  const checkoutCart = useRoomStore((state) => state.checkoutCart);
  const clearCart = useRoomStore((state) => state.clearCart);
  const startNewProject = useRoomStore((state) => state.startNewProject);
  const [designName, setDesignName] = useState('');
  const [message, setMessage] = useState('');
  const [messageKind, setMessageKind] = useState<'success' | 'error'>('success');
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [confirmingProject, setConfirmingProject] = useState(false);

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

  function startProject() {
    const result = startNewProject('human');
    setConfirmingProject(false);
    announce(
      result.ok
        ? 'Empty project started: every piece, door, and window was removed — the room keeps its measured size.'
        : result.message,
      result.ok ? 'success' : 'error',
    );
  }

  function rescueBudget() {
    const result = loadBudgetRescue('human');
    announce(result.ok ? 'Budget Rescue starter loaded.' : result.message, result.ok ? 'success' : 'error');
  }

  function removeCartLine(instanceId: string, name: string) {
    const result = removeCartItem(instanceId, 'human');
    announce(
      result.ok ? `Removed ${name} from the cart.` : result.message,
      result.ok ? 'success' : 'error',
    );
  }

  function checkout() {
    const result = checkoutCart();
    if (!result.ok) {
      announce(result.message, 'error');
      return;
    }
    const order = result.data;
    announce(
      `Mock checkout complete: order ${order.orderId} — ${money(order.total)} for ${order.cart.items.length} item${order.cart.items.length === 1 ? '' : 's'}.`,
      'success',
    );
  }

  function startNewCart() {
    const result = clearCart();
    announce(result.ok ? 'Started a new cart.' : result.message, result.ok ? 'success' : 'error');
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

          <section className="rounded-control border border-border bg-surface-muted/40 p-3" aria-label="New project">
            {confirmingProject ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm leading-6 text-text">
                  Start a new empty project? This removes every placed piece, door, and window
                  (uploaded models too) and resets the budget and finishes to their defaults.
                  Saved designs stay in your library.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={startProject}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-error px-3 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong focus:outline-none focus:ring-2 focus:ring-focus-ring motion-reduce:transition-none"
                  >
                    <FolderPlus className="size-4" aria-hidden="true" />
                    Start empty project
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingProject(false)}
                    className="min-h-11 rounded-control px-3 text-sm font-semibold text-text-muted transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-focus-ring motion-reduce:transition-none"
                  >
                    Keep editing
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold tracking-widest text-accent-strong uppercase">New project</p>
                <p className="text-xs leading-5 text-text-muted">
                  Start from a clean canvas at the current room size — no furniture, no doors, no
                  windows. Enter your real measurements in Furnish → Room size next.
                </p>
                <button
                  type="button"
                  onClick={() => setConfirmingProject(true)}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control border border-border px-3 text-sm font-semibold text-text transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-focus-ring motion-reduce:transition-none"
                >
                  <FolderPlus className="size-4" aria-hidden="true" />
                  New empty project
                </button>
              </div>
            )}
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
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
                        <span
                          aria-hidden="true"
                          className="inline-block size-3.5 shrink-0 rounded-control border border-border"
                          style={{ background: appearancePreviewGradient(design.appearance) }}
                        />
                        <span className="truncate">
                          {resolveAppearance(design.appearance).wall.name} ·{' '}
                          {resolveAppearance(design.appearance).floor.name} ·{' '}
                          {resolveAppearance(design.appearance).wallpaper.name}
                        </span>
                      </p>
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

            {cart.status === 'checked_out' ? (
              <div className="mt-4 flex items-start gap-3 rounded-control border border-success bg-success-soft px-3 py-3" role="status">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-text">Checked out</p>
                  <p className="mt-0.5 text-xs leading-5 text-text-muted">
                    This mock order is complete. The lines below are kept for reference; start a
                    new cart to shop again.
                  </p>
                </div>
              </div>
            ) : (
              <>
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
              </>
            )}
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
                      <li key={item.id} className="flex items-start gap-3 py-3">
                        {cart.status === 'active' ? (
                          <button
                            type="button"
                            onClick={() => removeCartLine(item.instanceId ?? item.id, name)}
                            aria-label={`Remove ${name} from cart`}
                            className="inline-flex size-11 shrink-0 items-center justify-center rounded-control border border-border text-text-muted transition-colors hover:border-error hover:bg-error-soft hover:text-error focus:outline-none focus:ring-2 focus:ring-focus-ring motion-reduce:transition-none"
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </button>
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <p className="flex items-baseline justify-between gap-3">
                            <span className="truncate text-sm font-semibold text-text">{name}</span>
                            <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-text">{money(item.unitPrice * item.quantity)}</span>
                          </p>
                          <p className="mt-0.5 text-xs text-text-muted">
                            {product?.category ?? 'Marketplace item'} · {money(item.unitPrice)} each · Qty {item.quantity}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <div className="flex items-center justify-between border-t border-border py-3">
                  <span className="text-sm font-semibold text-text">{cart.status === 'checked_out' ? 'Order total' : 'Estimated total'}</span>
                  <span className="font-mono text-base font-semibold tabular-nums text-text">{money(cartTotal)}</span>
                </div>
                {cart.status === 'active' ? (
                  <div className="flex flex-col gap-2 pb-2">
                    <button
                      type="button"
                      onClick={checkout}
                      className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control bg-accent px-3 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong focus:outline-none focus:ring-2 focus:ring-focus-ring focus:ring-offset-2 motion-reduce:transition-none"
                    >
                      <CreditCard className="size-4" aria-hidden="true" />
                      Checkout {money(cartTotal)}
                    </button>
                    <p className="text-center text-xs leading-5 text-text-muted">
                      Mock checkout — no real payment happens.
                    </p>
                  </div>
                ) : (
                  <div className="pb-2">
                    <button
                      type="button"
                      onClick={startNewCart}
                      className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control border border-border px-3 text-sm font-semibold text-text transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-focus-ring motion-reduce:transition-none"
                    >
                      <RotateCcw className="size-4" aria-hidden="true" />
                      Start a new cart
                    </button>
                  </div>
                )}
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
