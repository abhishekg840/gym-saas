'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { isUuid, readSession, type GymSession } from '@/lib/session';
import {
  PAYMENT_METHODS,
  PRODUCT_CATEGORIES,
  PRODUCT_CATEGORY_META,
  cancelPickup,
  cartTotal,
  categoryLabel,
  checkout,
  completePickup,
  createProduct,
  deleteProduct,
  formatRupees,
  formatStamp,
  isLowStock,
  listOrders,
  listPendingPickups,
  listProducts,
  marginPercent,
  restockProduct,
  updateProduct,
  waitingLabel,
  type CartLine,
  type CheckoutReceipt,
  type Order,
  type PendingPickup,
  type PickupReceipt,
  type Product,
  type ProductCategory,
} from '@/lib/crm';
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  CheckCircle2,
  ClipboardList,
  IndianRupee,
  Loader2,
  Minus,
  Package,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  ShoppingBag,
  Trash2,
  TrendingUp,
  X,
} from 'lucide-react';

/** The slice of a member row the member picker needs. */
interface MemberOption {
  id: string;
  full_name: string;
  phone: string;
  status: string;
}

const EMPTY_PRODUCT = {
  name: '',
  category: PRODUCT_CATEGORIES[0] as string,
  costPrice: '',
  sellingPrice: '',
  stockQuantity: '0',
  lowStockThreshold: '5',
  sku: '',
};

/** Local calendar day, so a 11pm sale still counts towards today's takings. */
function isToday(value: string): boolean {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.toDateString() === now.toDateString();
}

export default function GymStorePage() {
  const router = useRouter();

  const [session, setSession] = useState<GymSession | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);

  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeKind, setNoticeKind] = useState<'ok' | 'bad'>('ok');

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'all' | ProductCategory>('all');

  const [cart, setCart] = useState<CartLine[]>([]);
  const [memberId, setMemberId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0]);
  const [selling, setSelling] = useState(false);
  const [receipt, setReceipt] = useState<CheckoutReceipt | PickupReceipt | null>(null);

  /** null = closed, '' = adding, otherwise the product id being edited. */
  const [productFormId, setProductFormId] = useState<string | null>(null);
  const [productForm, setProductForm] = useState(EMPTY_PRODUCT);
  const [savingProduct, setSavingProduct] = useState(false);

  const [restockId, setRestockId] = useState<string | null>(null);
  const [restockQty, setRestockQty] = useState('10');
  const [restocking, setRestocking] = useState(false);

  /** Items members reserved in the companion app and have not collected yet. */
  const [pickups, setPickups] = useState<PendingPickup[]>([]);
  const [pickupBusyId, setPickupBusyId] = useState<string | null>(null);
  /** How the desk is taking the money when it hands a reservation over. */
  const [pickupMethod, setPickupMethod] = useState(PAYMENT_METHODS[0]);

  const tenantId = isUuid(session?.tenantId) ? (session?.tenantId as string) : null;

  function flash(message: string, kind: 'ok' | 'bad' = 'ok') {
    setNotice(message);
    setNoticeKind(kind);
  }

  const lowStock = useMemo(() => products.filter((product) => isLowStock(product)), [products]);
  const cartCount = useMemo(() => cart.reduce((sum, line) => sum + line.quantity, 0), [cart]);
  const cartValue = useMemo(() => cartTotal(cart), [cart]);
  const stockAtCost = useMemo(
    () => products.reduce((sum, p) => sum + Number(p.cost_price) * p.stock_quantity, 0),
    [products]
  );
  const shelfCount = useMemo(
    () => products.reduce((sum, p) => sum + p.stock_quantity, 0),
    [products]
  );
  const todayTakings = useMemo(
    () =>
      orders
        .filter((order) => isToday(order.created_at))
        .reduce((sum, order) => sum + Number(order.total_amount), 0),
    [orders]
  );
  /** What is already paid for but still sitting behind the counter. */
  const pickupValue = useMemo(
    () => pickups.reduce((sum, entry) => sum + Number(entry.total_amount), 0),
    [pickups]
  );

  /** Catalogue after the search box and the category chips have had their say. */
  const visibleProducts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return products.filter((product) => {
      if (category !== 'all' && product.category !== category) return false;
      if (!needle) return true;
      return (
        product.name.toLowerCase().includes(needle) ||
        (product.sku ?? '').toLowerCase().includes(needle) ||
        categoryLabel(product.category).toLowerCase().includes(needle)
      );
    });
  }, [products, search, category]);

  const loadAll = useCallback(async (tenant: string | null) => {
    const result = await listProducts(tenant);
    setLoading(false);

    if (!result.ok) {
      flash(result.error ?? 'Could not load the store inventory.', 'bad');
      return;
    }
    setProducts(result.products);
  }, []);

  const loadSales = useCallback(async (tenant: string | null) => {
    const result = await listOrders(tenant, 25);
    if (!result.ok) {
      flash(result.error ?? 'Could not load recent sales.', 'bad');
      return;
    }
    setOrders(result.orders);
  }, []);

  /**
   * The pickup queue is read through fn_store_pending_reservations rather than a
   * table read: store_reservations has no anon grant, so the only door is the
   * function, which is scoped to this gym.
   */
  const loadPickups = useCallback(async (tenant: string | null) => {
    const result = await listPendingPickups(tenant);
    if (!result.ok) {
      flash(result.error ?? 'Could not load the desk pickup queue.', 'bad');
      return;
    }
    setPickups(result.pickups);
  }, []);

  useEffect(() => {
    const parsed = readSession();
    if (!parsed) {
      router.push('/login');
      return;
    }

    // localStorage only exists in the browser, so the session can only arrive
    // after hydration. This setState is the whole point of the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(parsed);

    if (!isUuid(parsed.tenantId)) {
      setNotice('No gym is linked to this session. Sign in again to load the store.');
      setNoticeKind('bad');
      setLoading(false);
      return;
    }

    loadAll(parsed.tenantId ?? null);
    loadSales(parsed.tenantId ?? null);
    loadPickups(parsed.tenantId ?? null);
  }, [router, loadAll, loadSales, loadPickups]);

  // The till can attach a sale to a member. This read goes straight to
  // PostgREST like the dashboard's member table; the sale itself is written by
  // fn_store_checkout so stock can never be double-sold.
  useEffect(() => {
    if (!tenantId) return;

    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('members')
        .select('id, full_name, phone, status')
        .eq('tenant_id', tenantId)
        .order('full_name', { ascending: true })
        .limit(1000);

      if (cancelled || !data) return;
      setMembers(data as MemberOption[]);
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  function refresh() {
    loadAll(tenantId);
    loadSales(tenantId);
    loadPickups(tenantId);
  }

  // ---- Cart ----------------------------------------------------------------

  /** Refuses to put more on the bill than the shelf is holding. */
  function addToCart(product: Product, quantity = 1) {
    if (product.stock_quantity <= 0) {
      flash(`${product.name} is out of stock. Restock it before selling.`, 'bad');
      return;
    }

    setCart((prev) => {
      const existing = prev.find((line) => line.product.id === product.id);
      if (!existing) {
        return [...prev, { product, quantity: Math.min(quantity, product.stock_quantity) }];
      }

      const nextQty = Math.min(existing.quantity + quantity, product.stock_quantity);
      if (nextQty === existing.quantity) {
        flash(`Only ${product.stock_quantity} × ${product.name} left on the shelf.`, 'bad');
      }
      return prev.map((line) =>
        line.product.id === product.id ? { ...line, quantity: nextQty } : line
      );
    });
  }

  function decreaseLine(productId: string) {
    setCart((prev) =>
      prev
        .map((line) =>
          line.product.id === productId ? { ...line, quantity: line.quantity - 1 } : line
        )
        .filter((line) => line.quantity > 0)
    );
  }

  function setLineQuantity(productId: string, raw: string) {
    const parsed = Number(raw);
    setCart((prev) =>
      prev.map((line) => {
        if (line.product.id !== productId) return line;
        if (!Number.isInteger(parsed) || parsed < 1) return { ...line, quantity: 1 };
        return { ...line, quantity: Math.min(parsed, line.product.stock_quantity) };
      })
    );
  }

  function removeLine(productId: string) {
    setCart((prev) => prev.filter((line) => line.product.id !== productId));
  }

  function clearCart() {
    setCart([]);
    setMemberId('');
    setPaymentMethod(PAYMENT_METHODS[0]);
  }

  const cartQtyFor = (productId: string) =>
    cart.find((line) => line.product.id === productId)?.quantity ?? 0;

  // ---- Checking out --------------------------------------------------------

  async function completeSale(e: React.FormEvent) {
    e.preventDefault();
    if (cart.length === 0) {
      flash('The cart is empty — add something before taking payment.', 'bad');
      return;
    }

    setSelling(true);
    const result = await checkout({
      tenantId,
      memberId: memberId || null,
      paymentMethod,
      lines: cart.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
    });
    setSelling(false);

    if (!result.ok || !result.receipt) {
      // A stock clash is the common failure: the shelf moved under us. Reloading
      // re-syncs the quantities so the cashier can see the real numbers.
      flash(result.error ?? 'Could not complete this sale.', 'bad');
      loadAll(tenantId);
      return;
    }

    const sale = result.receipt;

    // The receipt is authoritative: apply the same decrement locally rather than
    // guessing, so the grid matches the database that just committed.
    setProducts((prev) =>
      prev.map((product) => {
        const sold = sale.items.find((item) => item.product_id === product.id);
        if (!sold) return product;
        return { ...product, stock_quantity: Math.max(product.stock_quantity - sold.quantity, 0) };
      })
    );

    setOrders((prev) => [
      {
        id: sale.order_id,
        member_id: sale.member_id,
        total_amount: sale.total_amount,
        payment_method: sale.payment_method,
        items: sale.items,
        created_at: sale.created_at,
        member_name: sale.member_name,
      },
      ...prev,
    ]);

    setReceipt(sale);
    setCart([]);
    setMemberId('');
    setPaymentMethod(PAYMENT_METHODS[0]);
    flash(
      `Sale #${sale.order_id.slice(0, 8)} billed for ${formatRupees(sale.total_amount)}${
        sale.is_walk_in ? ' (walk-in)' : ` to ${sale.member_name ?? 'the member'}`
      }.`
    );
  }


  // ---- Desk pickups (Phase 5) ----------------------------------------------

  /**
   * Hands a reserved item over the desk and bills it. The shelf decrement, the
   * order row and the revenue entry all happen inside fn_store_complete_pickup, so
   * the queue, the stock and the day's takings can never drift apart.
   */
  async function handOverPickup(entry: PendingPickup) {
    setPickupBusyId(entry.id);
    const result = await completePickup(tenantId, entry.id, pickupMethod);
    setPickupBusyId(null);

    if (!result.ok || !result.receipt) {
      flash(result.error ?? 'Could not complete this pickup.', 'bad');
      loadPickups(tenantId);
      loadAll(tenantId);
      return;
    }

    const sale = result.receipt;

    // The receipt is authoritative, exactly as in a counter sale: mirror the
    // decrement locally rather than guessing what the shelf now holds.
    setProducts((prev) =>
      prev.map((product) => {
        const sold = sale.items.find((item) => item.product_id === product.id);
        if (!sold) return product;
        return { ...product, stock_quantity: Math.max(product.stock_quantity - sold.quantity, 0) };
      })
    );

    setOrders((prev) => [
      {
        id: sale.order_id,
        member_id: sale.member_id,
        total_amount: sale.total_amount,
        payment_method: sale.payment_method,
        items: sale.items,
        created_at: sale.created_at,
        member_name: sale.member_name,
      },
      ...prev,
    ]);

    setPickups((prev) => prev.filter((row) => row.id !== entry.id));
    setReceipt(sale);
    flash(
      `${entry.quantity} × ${entry.product_name} handed to ${entry.member_name} and billed ${formatRupees(
        sale.total_amount
      )}.`
    );
  }

  /** Closes a reservation nobody collected. The shelf is untouched. */
  async function dropPickup(entry: PendingPickup) {
    setPickupBusyId(entry.id);
    const result = await cancelPickup(tenantId, entry.id);
    setPickupBusyId(null);

    if (!result.ok) {
      flash(result.error ?? 'Could not close that reservation.', 'bad');
      loadPickups(tenantId);
      return;
    }

    setPickups((prev) => prev.filter((row) => row.id !== entry.id));
    flash(`The reservation for ${entry.product_name} was closed.`);
  }

  // ---- Catalogue -----------------------------------------------------------

  function openAddProduct() {
    setProductFormId('');
    setProductForm(EMPTY_PRODUCT);
  }

  function openEditProduct(product: Product) {
    setProductFormId(product.id);
    setProductForm({
      name: product.name,
      category: product.category,
      costPrice: String(product.cost_price),
      sellingPrice: String(product.selling_price),
      stockQuantity: String(product.stock_quantity),
      lowStockThreshold: String(product.low_stock_threshold),
      sku: product.sku ?? '',
    });
  }

  async function saveProduct(e: React.FormEvent) {
    e.preventDefault();
    if (productFormId === null) return;

    const name = productForm.name.trim();
    if (!name) {
      flash('Give the product a name first.', 'bad');
      return;
    }

    const costPrice = Number(productForm.costPrice) || 0;
    const sellingPrice = Number(productForm.sellingPrice) || 0;
    if (sellingPrice < costPrice) {
      flash(`${name} would sell below cost. Fix the prices before saving.`, 'bad');
      return;
    }

    const stockQuantity = Number(productForm.stockQuantity);
    if (!Number.isInteger(stockQuantity) || stockQuantity < 0) {
      flash('Stock must be a whole number of 0 or more.', 'bad');
      return;
    }

    const payload = {
      name,
      category: productForm.category as ProductCategory,
      cost_price: costPrice,
      selling_price: sellingPrice,
      stock_quantity: stockQuantity,
      low_stock_threshold: Number(productForm.lowStockThreshold) || 0,
      sku: productForm.sku.trim() || null,
    };

    setSavingProduct(true);
    const result = productFormId
      ? await updateProduct(tenantId, productFormId, payload)
      : await createProduct(tenantId, payload);
    setSavingProduct(false);

    if (!result.ok || !result.product) {
      flash(result.error ?? 'Could not save this product.', 'bad');
      return;
    }

    const saved = result.product;
    setProducts((prev) => {
      const next = prev.some((row) => row.id === saved.id)
        ? prev.map((row) => (row.id === saved.id ? saved : row))
        : [...prev, saved];
      return next.sort((a, b) => a.name.localeCompare(b.name));
    });

    flash(productFormId ? `${saved.name} updated.` : `${saved.name} added to the catalogue.`);
    setProductFormId(null);
  }

  async function removeProduct(product: Product) {
    if (
      !confirm(
        `Delete ${product.name} from the catalogue? Past sales keep their own name and price, so receipts will not change.`
      )
    ) {
      return;
    }

    setBusyId(product.id);
    const result = await deleteProduct(tenantId, product.id);
    setBusyId(null);

    if (!result.ok) {
      flash(result.error ?? 'Could not remove this product.', 'bad');
      return;
    }

    setProducts((prev) => prev.filter((row) => row.id !== product.id));
    setCart((prev) => prev.filter((line) => line.product.id !== product.id));
    flash(`${product.name} removed from the catalogue.`);
  }

  // ---- Restocking ----------------------------------------------------------

  function openRestock(product: Product) {
    setRestockId(product.id);
    setRestockQty('10');
  }

  async function submitRestock(e: React.FormEvent) {
    e.preventDefault();
    if (!restockId) return;

    const delta = Number(restockQty);
    // The delta is applied in SQL, so two people receiving deliveries at once
    // add up instead of overwriting each other.
    if (!Number.isInteger(delta) || delta === 0) {
      flash('Enter a non-zero whole number — negative values correct a miscount.', 'bad');
      return;
    }

    setRestocking(true);
    const result = await restockProduct(tenantId, restockId, delta);
    setRestocking(false);

    if (!result.ok || !result.product) {
      flash(result.error ?? 'Could not update the stock.', 'bad');
      return;
    }

    const updated = result.product;
    setProducts((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
    setRestockId(null);
    flash(
      `${updated.name} now holds ${updated.stock_quantity} unit${
        updated.stock_quantity === 1 ? '' : 's'
      }.`
    );
  }

  const restockTarget = products.find((product) => product.id === restockId) ?? null;


  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans">
      {/* Header */}
      <div className="sticky top-0 z-30 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="p-2.5 rounded-xl bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-white transition"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-300">
              <ShoppingBag className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight">Gym Store &amp; POS</h1>
              <p className="text-xs text-neutral-400">
                {session?.tenantName || 'Your gym'} &middot; {products.length} products &middot;{' '}
                {shelfCount} units on the shelf
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {lowStock.length > 0 && (
              <span className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] font-bold">
                <AlertTriangle className="w-3.5 h-3.5" /> {lowStock.length} low on stock
              </span>
            )}
            <button
              onClick={refresh}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-neutral-300 hover:text-white text-[11px] font-semibold transition"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
            <button
              onClick={openAddProduct}
              className="flex items-center gap-1.5 px-4 py-2 bg-violet-500 hover:bg-violet-600 text-white font-bold rounded-xl text-xs transition shadow-lg shadow-violet-500/20"
            >
              <Package className="w-4 h-4" /> Add Product
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6">
        {notice && (
          <div
            className={`mb-5 flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm ${
              noticeKind === 'ok'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-200'
            }`}
          >
            {noticeKind === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            ) : (
              <X className="w-4 h-4 mt-0.5 shrink-0" />
            )}
            <span className="flex-1">{notice}</span>
            <button
              onClick={() => setNotice(null)}
              className="text-neutral-400 hover:text-white transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-violet-500/10 text-violet-300">
              <Boxes className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-neutral-400">Stock Value</p>
              <p className="text-xl font-bold">{formatRupees(stockAtCost)}</p>
              <p className="text-[10px] text-neutral-500">at cost price</p>
            </div>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-neutral-400">
                Today&apos;s Takings
              </p>
              <p className="text-xl font-bold">{formatRupees(todayTakings)}</p>
              <p className="text-[10px] text-neutral-500">from the last 25 sales</p>
            </div>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-neutral-400">In the Cart</p>
              <p className="text-xl font-bold">{formatRupees(cartValue)}</p>
              <p className="text-[10px] text-neutral-500">
                {cartCount} item{cartCount === 1 ? '' : 's'} scanned
              </p>
            </div>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-neutral-400">Low Stock</p>
              <p className="text-xl font-bold">{lowStock.length}</p>
              <p className="text-[10px] text-neutral-500">
                {lowStock.length === 0 ? 'everything stocked' : 'at or below re-order level'}
              </p>
            </div>
          </div>
        </div>


        {/* Pending desk pickups — items members reserved from the companion app */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden mb-6">
          <div className="p-4 border-b border-neutral-800 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-amber-400" /> Pending Desk Pickups
              {pickups.length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px] font-bold">
                  {pickups.length} waiting
                </span>
              )}
            </h2>

            <div className="flex flex-wrap items-center gap-2">
              {pickups.length > 0 && (
                <span className="text-[11px] text-neutral-400">{formatRupees(pickupValue)} reserved</span>
              )}
              <label className="flex items-center gap-2 text-[11px] text-neutral-500">
                Billed as
                <select
                  value={pickupMethod}
                  onChange={(e) => setPickupMethod(e.target.value)}
                  className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-500"
                >
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={() => loadPickups(tenantId)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-neutral-950 border border-neutral-800 text-neutral-300 hover:text-white text-[11px] font-semibold transition"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </button>
            </div>
          </div>

          {pickups.length === 0 ? (
            <div className="p-8 text-center">
              <Package className="w-7 h-7 text-neutral-600 mx-auto mb-3" />
              <p className="text-sm text-neutral-300 font-semibold">The desk queue is clear</p>
              <p className="text-xs text-neutral-500 mt-1">
                Nothing is waiting for collection. Reservations made in the member app show up here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-neutral-800 max-h-[360px] overflow-y-auto">
              {pickups.map((entry) => {
                const stale = entry.waiting_minutes >= 30;
                const stockShort = Number(entry.stock_available ?? 0) < Number(entry.quantity);
                const busy = pickupBusyId === entry.id;

                return (
                  <div
                    key={entry.id}
                    className="p-3.5 flex flex-wrap items-center gap-3 hover:bg-neutral-950/60 transition"
                  >
                    <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-300 shrink-0">
                      <Package className="w-5 h-5" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold truncate">
                        {entry.quantity} × {entry.product_name}
                        <span className="ml-2 font-bold text-amber-300">
                          {formatRupees(entry.total_amount)}
                        </span>
                      </p>
                      <p className="text-[10px] text-neutral-500 truncate">
                        {entry.member_name}
                        {entry.member_phone ? ` · ${entry.member_phone}` : ''}
                        {entry.member_username ? ` · @${entry.member_username}` : ''}
                      </p>
                      <p className="text-[10px] mt-0.5">
                        <span className={stale ? 'text-amber-400 font-semibold' : 'text-neutral-500'}>
                          waiting {waitingLabel(entry.waiting_minutes)}
                        </span>
                        {stockShort ? (
                          <span className="text-rose-400 font-semibold">
                            {' '}
                            · not enough on the shelf to complete
                          </span>
                        ) : (
                          <span className="text-neutral-500">
                            {' '}
                            · {entry.stock_available ?? 0} in stock
                          </span>
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handOverPickup(entry)}
                        disabled={busy}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-500 hover:bg-violet-600 disabled:opacity-60 text-white text-[11px] font-bold transition shadow-lg shadow-violet-500/20"
                      >
                        {busy ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        )}
                        Complete Pickup &amp; Bill
                      </button>
                      <button
                        onClick={() => dropPickup(entry)}
                        disabled={busy}
                        title="Close the reservation without billing"
                        className="px-2.5 py-2 rounded-xl bg-neutral-950 border border-neutral-800 text-neutral-400 hover:text-rose-300 hover:border-rose-500/30 disabled:opacity-60 transition"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p className="px-4 py-3 border-t border-neutral-800 text-[11px] text-neutral-500">
            Reserved from the companion app. Completing a pickup bills it to the member, takes the
            stock off the shelf and writes the order in one step.
          </p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          {/* Catalogue / till grid */}
          <div className="xl:col-span-2">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-3">
              <div className="flex items-center gap-2 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 flex-1">
                <Search className="w-4 h-4 text-neutral-500" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, SKU or category…"
                  className="bg-transparent text-sm w-full focus:outline-none placeholder:text-neutral-600"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="text-neutral-500 hover:text-white transition"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <p className="text-[11px] text-neutral-500 shrink-0">
                {visibleProducts.length} of {products.length} shown
              </p>
            </div>

            <div className="flex flex-wrap gap-2 mb-4">
              <button
                onClick={() => setCategory('all')}
                className={`px-3 py-1.5 rounded-full text-[11px] font-bold border transition ${
                  category === 'all'
                    ? 'bg-white text-black border-white'
                    : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-white'
                }`}
              >
                All
              </button>
              {PRODUCT_CATEGORIES.map((option) => {
                const meta = PRODUCT_CATEGORY_META[option];
                const active = category === option;
                return (
                  <button
                    key={option}
                    onClick={() => setCategory(option)}
                    className={`px-3 py-1.5 rounded-full text-[11px] font-bold border transition ${
                      active
                        ? 'bg-white text-black border-white'
                        : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-white'
                    }`}
                  >
                    {meta.emoji} {meta.label}
                  </button>
                );
              })}
            </div>

            {loading ? (
              <div className="flex items-center gap-2 text-sm text-neutral-400 py-16 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading the catalogue…
              </div>
            ) : visibleProducts.length === 0 ? (
              <div className="bg-neutral-900 border border-dashed border-neutral-800 rounded-2xl p-10 text-center">
                <Package className="w-8 h-8 text-neutral-600 mx-auto mb-3" />
                <p className="text-sm text-neutral-300 font-semibold">
                  {products.length === 0
                    ? 'The store shelf is empty'
                    : 'Nothing matches that filter'}
                </p>
                <p className="text-xs text-neutral-500 mt-1">
                  {products.length === 0
                    ? 'Add your first product to start selling at the counter.'
                    : 'Try another search term or clear the category chips.'}
                </p>
                {products.length === 0 && (
                  <button
                    onClick={openAddProduct}
                    className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-violet-500 hover:bg-violet-600 text-white font-bold rounded-xl text-xs transition"
                  >
                    <Plus className="w-4 h-4" /> Add Product
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-3">

                {visibleProducts.map((product) => {
                  const meta = PRODUCT_CATEGORY_META[product.category];
                  const inCart = cartQtyFor(product.id);
                  const low = isLowStock(product);
                  const soldOut = product.stock_quantity <= 0;

                  return (
                    <div
                      key={product.id}
                      className={`bg-neutral-900 border rounded-2xl p-4 flex flex-col ${
                        soldOut ? 'border-neutral-800/60 opacity-70' : 'border-neutral-800'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-bold truncate">{product.name}</p>
                          <p className="text-[10px] text-neutral-500 font-mono truncate">
                            {product.sku ?? 'no SKU'}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${meta.badge}`}
                        >
                          {meta.emoji} {meta.label}
                        </span>
                      </div>

                      <div className="mt-3 flex items-end justify-between">
                        <p className="text-lg font-black text-emerald-300">
                          {formatRupees(product.selling_price)}
                        </p>
                        <p className="text-[10px] text-neutral-500">
                          {marginPercent(product)}% margin
                        </p>
                      </div>

                      <div className="mt-2 flex items-center justify-between text-[11px]">
                        <span
                          className={
                            soldOut
                              ? 'text-rose-400 font-bold'
                              : low
                                ? 'text-amber-400 font-bold'
                                : 'text-neutral-400'
                          }
                        >
                          {soldOut ? 'Out of stock' : `${product.stock_quantity} in stock`}
                          {!soldOut && low && <span className="ml-1">· re-order</span>}
                        </span>
                        {inCart > 0 && (
                          <span className="text-violet-300 font-bold">{inCart} in cart</span>
                        )}
                      </div>

                      <div className="mt-3 flex items-center gap-2">
                        <button
                          onClick={() => addToCart(product)}
                          disabled={soldOut}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold bg-violet-500/15 hover:bg-violet-500/25 text-violet-200 border border-violet-500/30 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Plus className="w-3.5 h-3.5" /> Add to bill
                        </button>
                        <button
                          onClick={() => openRestock(product)}
                          title="Receive stock"
                          className="p-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition"
                        >
                          <Boxes className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => openEditProduct(product)}
                          title="Edit product"
                          className="p-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>


          {/* The till */}
          <div className="xl:col-span-1">
            <form
              onSubmit={completeSale}
              className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 xl:sticky xl:top-24"
            >
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
                  <ShoppingBag className="w-4 h-4 text-violet-300" /> Current Bill
                </h2>
                {cart.length > 0 && (
                  <button
                    type="button"
                    onClick={clearCart}
                    className="text-[11px] font-semibold text-neutral-400 hover:text-rose-300 transition"
                  >
                    Clear
                  </button>
                )}
              </div>

              {cart.length === 0 ? (
                <div className="border border-dashed border-neutral-800 rounded-2xl p-6 text-center">
                  <ShoppingBag className="w-7 h-7 text-neutral-600 mx-auto mb-2" />
                  <p className="text-xs text-neutral-400">
                    Scan or tap <span className="text-neutral-200 font-semibold">Add to bill</span>{' '}
                    and the line items land here.
                  </p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {cart.map((line) => (
                    <div
                      key={line.product.id}
                      className="bg-neutral-950 border border-neutral-800 rounded-xl p-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold truncate">{line.product.name}</p>
                          <p className="text-[10px] text-neutral-500">
                            {formatRupees(line.product.selling_price)} each
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeLine(line.product.id)}
                          className="p-1 rounded-lg text-neutral-500 hover:text-rose-400 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="mt-2 flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => decreaseLine(line.product.id)}
                            className="p-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <input
                            type="number"
                            min={1}
                            max={line.product.stock_quantity}
                            value={line.quantity}
                            onChange={(e) => setLineQuantity(line.product.id, e.target.value)}
                            className="w-14 text-center bg-neutral-900 border border-neutral-800 rounded-lg py-1 text-xs font-mono focus:outline-none focus:border-violet-500"
                          />
                          <button
                            type="button"
                            onClick={() => addToCart(line.product)}
                            className="p-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                        <p className="text-sm font-bold text-emerald-300">
                          {formatRupees(Number(line.product.selling_price) * line.quantity)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}


              <div className="mt-4 space-y-3 border-t border-neutral-800 pt-4">
                <div>
                  <label className="text-[10px] text-neutral-400 uppercase tracking-wider block mb-1">
                    Sell to
                  </label>
                  <select
                    value={memberId}
                    onChange={(e) => setMemberId(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-500"
                  >
                    <option value="">Walk-in guest</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.full_name} · {member.phone}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] text-neutral-400 uppercase tracking-wider block mb-1">
                    Payment
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {PAYMENT_METHODS.map((method) => (
                      <button
                        key={method}
                        type="button"
                        onClick={() => setPaymentMethod(method)}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition ${
                          paymentMethod === method
                            ? 'bg-violet-500 text-white border-violet-500'
                            : 'bg-neutral-950 text-neutral-400 border-neutral-800 hover:text-white'
                        }`}
                      >
                        {method}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-neutral-500 mt-1.5">
                    Walk-in money is still recorded in the day&apos;s takings; it just carries no
                    member link.
                  </p>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs uppercase tracking-wider text-neutral-400">
                    Total ({cartCount} item{cartCount === 1 ? '' : 's'})
                  </span>
                  <span className="text-2xl font-black text-emerald-300">
                    {formatRupees(cartValue)}
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={selling || cart.length === 0}
                  className="w-full flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-black font-black py-3 rounded-xl text-xs uppercase tracking-wider transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {selling ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Billing…
                    </>
                  ) : (
                    <>
                      <IndianRupee className="w-4 h-4" /> Take payment
                    </>
                  )}
                </button>

                <p className="text-[10px] text-neutral-500 text-center">
                  Stock, the order row and the receipt are written together in one server-side
                  transaction.
                </p>
              </div>
            </form>
          </div>
        </div>


        {/* Inventory ledger */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mt-6">
          <div className="lg:col-span-2 bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-neutral-800 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
                <Boxes className="w-4 h-4 text-violet-300" /> Inventory
              </h2>
              <p className="text-[11px] text-neutral-500">
                {products.length} SKUs &middot; {shelfCount} units &middot;{' '}
                {formatRupees(stockAtCost)} tied up at cost
              </p>
            </div>

            {products.length === 0 ? (
              <p className="p-8 text-center text-sm text-neutral-500">
                No stock on the books yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[720px]">
                  <thead className="bg-neutral-950 text-neutral-400 uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="text-left px-4 py-2.5">Product</th>
                      <th className="text-right px-3 py-2.5">Cost</th>
                      <th className="text-right px-3 py-2.5">Price</th>
                      <th className="text-right px-3 py-2.5">Margin</th>
                      <th className="text-right px-3 py-2.5">Stock</th>
                      <th className="text-right px-4 py-2.5">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800">
                    {products.map((product) => {
                      const low = isLowStock(product);
                      const busy = busyId === product.id;

                      return (
                        <tr key={product.id} className="hover:bg-neutral-950/60 transition">
                          <td className="px-4 py-2.5">
                            <p className="font-semibold text-neutral-100">{product.name}</p>
                            <p className="text-[10px] text-neutral-500">
                              {categoryLabel(product.category)}
                              {product.sku ? ` · ${product.sku}` : ''}
                            </p>
                          </td>
                          <td className="text-right px-3 py-2.5 text-neutral-400">
                            {formatRupees(product.cost_price)}
                          </td>
                          <td className="text-right px-3 py-2.5 text-neutral-200">
                            {formatRupees(product.selling_price)}
                          </td>
                          <td className="text-right px-3 py-2.5 text-emerald-300">
                            {marginPercent(product)}%
                          </td>
                          <td className="text-right px-3 py-2.5">
                            <span
                              className={`font-bold ${
                                product.stock_quantity <= 0
                                  ? 'text-rose-400'
                                  : low
                                    ? 'text-amber-400'
                                    : 'text-neutral-200'
                              }`}
                            >
                              {product.stock_quantity}
                            </span>
                            <span className="block text-[10px] text-neutral-500">
                              re-order at {product.low_stock_threshold}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => openRestock(product)}
                                className="px-2 py-1 rounded-lg text-[10px] font-bold bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition"
                              >
                                Restock
                              </button>
                              <button
                                onClick={() => openEditProduct(product)}
                                title="Edit product"
                                className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => removeProduct(product)}
                                disabled={busy}
                                title="Delete product"
                                className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 transition disabled:opacity-50"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>


          {/* Recent sales */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden h-fit">
            <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
                <Receipt className="w-4 h-4 text-emerald-400" /> Recent Sales
              </h2>
              <span className="text-[11px] text-neutral-500">{orders.length} shown</span>
            </div>

            {orders.length === 0 ? (
              <p className="p-8 text-center text-sm text-neutral-500">
                Nothing has been billed yet. Sales show up here the moment the till rings them up.
              </p>
            ) : (
              <div className="divide-y divide-neutral-800 max-h-[520px] overflow-y-auto">
                {orders.map((order) => (
                  <div key={order.id} className="p-3.5 hover:bg-neutral-950/60 transition">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">
                          {order.member_name ?? 'Walk-in guest'}
                        </p>
                        <p className="text-[10px] text-neutral-500">
                          {formatStamp(order.created_at)} &middot; {order.payment_method} &middot;{' '}
                          {order.items.length} line{order.items.length === 1 ? '' : 's'}
                        </p>
                      </div>
                      <p className="text-sm font-bold text-emerald-300 shrink-0">
                        {formatRupees(order.total_amount)}
                      </p>
                    </div>
                    <p className="mt-1.5 text-[10px] text-neutral-500 truncate">
                      {order.items
                        .map((item) => `${item.quantity}× ${item.name}`)
                        .join(' · ') || 'no line items'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>


      {/* Add / edit product */}
      {productFormId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-lg bg-neutral-900 border border-neutral-800 rounded-3xl overflow-hidden shadow-2xl my-8">
            <div className="p-5 border-b border-neutral-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-300">
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold">
                    {productFormId ? 'Edit product' : 'Add a product'}
                  </h3>
                  <p className="text-[11px] text-neutral-400">
                    Selling price must cover the cost price.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setProductFormId(null)}
                className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={saveProduct} className="p-5 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="text-[10px] text-neutral-400 uppercase tracking-wider block mb-1">
                    Name
                  </label>
                  <input
                    required
                    value={productForm.name}
                    onChange={(e) => setProductForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g. Whey Protein 1kg"
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="text-[10px] text-neutral-400 uppercase tracking-wider block mb-1">
                    Category
                  </label>
                  <select
                    value={productForm.category}
                    onChange={(e) =>
                      setProductForm((prev) => ({ ...prev, category: e.target.value }))
                    }
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-500"
                  >
                    {PRODUCT_CATEGORIES.map((option) => (
                      <option key={option} value={option}>
                        {PRODUCT_CATEGORY_META[option].label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] text-neutral-400 uppercase tracking-wider block mb-1">
                    SKU (optional)
                  </label>
                  <input
                    value={productForm.sku}
                    onChange={(e) => setProductForm((prev) => ({ ...prev, sku: e.target.value }))}
                    placeholder="WHEY-1KG"
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-violet-500"
                  />
                </div>


                <div>
                  <label className="text-[10px] text-neutral-400 uppercase tracking-wider block mb-1">
                    Cost price
                  </label>
                  <input
                    required
                    type="number"
                    min={0}
                    step="0.01"
                    value={productForm.costPrice}
                    onChange={(e) =>
                      setProductForm((prev) => ({ ...prev, costPrice: e.target.value }))
                    }
                    placeholder="0"
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="text-[10px] text-neutral-400 uppercase tracking-wider block mb-1">
                    Selling price
                  </label>
                  <input
                    required
                    type="number"
                    min={0}
                    step="0.01"
                    value={productForm.sellingPrice}
                    onChange={(e) =>
                      setProductForm((prev) => ({ ...prev, sellingPrice: e.target.value }))
                    }
                    placeholder="0"
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="text-[10px] text-neutral-400 uppercase tracking-wider block mb-1">
                    Opening stock
                  </label>
                  <input
                    required
                    type="number"
                    min={0}
                    value={productForm.stockQuantity}
                    onChange={(e) =>
                      setProductForm((prev) => ({ ...prev, stockQuantity: e.target.value }))
                    }
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="text-[10px] text-neutral-400 uppercase tracking-wider block mb-1">
                    Re-order at
                  </label>
                  <input
                    required
                    type="number"
                    min={0}
                    value={productForm.lowStockThreshold}
                    onChange={(e) =>
                      setProductForm((prev) => ({ ...prev, lowStockThreshold: e.target.value }))
                    }
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-violet-500"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setProductFormId(null)}
                  className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingProduct}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold bg-violet-500 hover:bg-violet-600 text-white transition disabled:opacity-50"
                >
                  {savingProduct ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  )}
                  {productFormId ? 'Save changes' : 'Add product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


      {/* Restock */}
      {restockTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-neutral-900 border border-neutral-800 rounded-3xl overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-neutral-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  <Boxes className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold">Receive stock</h3>
                  <p className="text-[11px] text-neutral-400 truncate max-w-[200px]">
                    {restockTarget.name} · {restockTarget.stock_quantity} on hand
                  </p>
                </div>
              </div>
              <button
                onClick={() => setRestockId(null)}
                className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={submitRestock} className="p-5 space-y-3">
              <div>
                <label className="text-[10px] text-neutral-400 uppercase tracking-wider block mb-1">
                  Units in / out
                </label>
                <input
                  required
                  type="number"
                  step={1}
                  value={restockQty}
                  onChange={(e) => setRestockQty(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex flex-wrap gap-1.5">
                {[5, 10, 24, 50].map((quick) => (
                  <button
                    key={quick}
                    type="button"
                    onClick={() => setRestockQty(String(quick))}
                    className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition"
                  >
                    +{quick}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setRestockQty(`${-1 * restockTarget.stock_quantity}`)}
                  className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition"
                >
                  Write off all
                </button>
              </div>

              <p className="text-[10px] text-neutral-500 leading-relaxed">
                The change is applied as a delta inside Postgres, so two people receiving the same
                delivery add up instead of overwriting one another. Use a negative number after a
                stocktake.
              </p>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setRestockId(null)}
                  className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={restocking}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-600 text-black transition disabled:opacity-50"
                >
                  {restocking ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Boxes className="w-3.5 h-3.5" />
                  )}
                  Update stock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


      {/* Receipt */}
      {receipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-neutral-950 border border-neutral-800 rounded-3xl overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-dashed border-neutral-800 text-center">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mb-3">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="font-black text-lg">Payment received</h3>
              {'reservation_kind' in receipt && receipt.reservation_kind === 'desk_pickup' && (
                <p className="mt-1 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[10px] font-bold">
                  <ClipboardList className="w-3.5 h-3.5" /> Desk pickup
                </p>
              )}
              <p className="text-[11px] text-neutral-400">
                {session?.tenantName || 'Your gym'} &middot; {formatStamp(receipt.created_at)}
              </p>
              <p className="text-[10px] text-neutral-500 font-mono mt-1">
                Order #{receipt.order_id.slice(0, 8).toUpperCase()}
              </p>
            </div>

            <div className="p-5 space-y-2 border-b border-dashed border-neutral-800">
              {receipt.items.map((item) => (
                <div key={item.product_id} className="flex items-start justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{item.name}</p>
                    <p className="text-[10px] text-neutral-500">
                      {item.quantity} × {formatRupees(item.price)}
                    </p>
                  </div>
                  <p className="font-bold text-neutral-200 shrink-0">
                    {formatRupees(item.subtotal)}
                  </p>
                </div>
              ))}
            </div>

            <div className="p-5 space-y-2">
              <div className="flex items-center justify-between text-xs text-neutral-400">
                <span>Sold to</span>
                <span className="text-neutral-200">
                  {receipt.is_walk_in ? 'Walk-in guest' : (receipt.member_name ?? 'Member')}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-neutral-400">
                <span>Payment</span>
                <span className="text-neutral-200">{receipt.payment_method}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-neutral-400">
                <span>Lines</span>
                <span className="text-neutral-200">{receipt.line_count}</span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-neutral-800">
                <span className="text-sm font-bold uppercase tracking-wider text-neutral-300">
                  Total
                </span>
                <span className="text-2xl font-black text-emerald-300">
                  {formatRupees(receipt.total_amount)}
                </span>
              </div>

              <p className="text-[10px] text-neutral-500">
                {receipt.invoice_id
                  ? 'A paid invoice was filed against the member for this sale.'
                  : 'Walk-in sale — takings were logged without a member invoice.'}
              </p>

              <button
                onClick={() => setReceipt(null)}
                className="w-full mt-2 py-3 rounded-xl text-xs font-bold bg-white text-black hover:bg-neutral-200 transition"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

