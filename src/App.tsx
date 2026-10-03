import { useCallback, useState } from 'react';
import SectionSidebar from './components/SectionSidebar';
import type { FormEvent } from 'react';
import { Activity, ArrowRight, CircleAlert, RefreshCw, ShieldCheck } from 'lucide-react';

type Identity = { id: string; email: string; role: 'customer' | 'merchant' | 'operator' | 'auditor' };
type CatalogItem = { id: string; sku: string; title: string; unit_price_cents: number; available_quantity: number };
type Order = { id: string; state: string; currency: string; total_cents: number; failure_code: string | null; created_at: string };

function money(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

function App() {
  const [apiUrl, setApiUrl] = useState('http://127.0.0.1:8080');
  const [token, setToken] = useState('');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [notice, setNotice] = useState('Enter a short-lived bearer token to connect.');
  const [busy, setBusy] = useState(false);

  const request = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...init?.headers },
    });
    const body = await response.json() as { error?: string } & T;
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
    return body;
  }, [apiUrl, token]);

  const refresh = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    try {
      const [session, catalogResponse, orderResponse] = await Promise.all([
        request<{ identity: Identity }>('/api/session'),
        request<{ items: CatalogItem[] }>('/api/catalog'),
        request<{ orders: Order[] }>('/api/orders'),
      ]);
      setIdentity(session.identity);
      setCatalog(catalogResponse.items);
      setOrders(orderResponse.orders);
      setNotice(`Connected as ${session.identity.role}. Live authorization is checked on every request.`);
    } catch (error) {
      setIdentity(null);
      setNotice(error instanceof Error ? error.message : 'Connection failed');
    } finally { setBusy(false); }
  }, [request, token]);

  function resetConnection() {
    setIdentity(null);
    setCatalog([]);
    setOrders([]);
  }

  async function checkout(event: FormEvent) {
    event.preventDefault();
    const item = catalog[0];
    if (!item) return;
    setBusy(true);
    try {
      const key = crypto.randomUUID();
      const result = await request<{ order: Order }>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `console-${key}`,
          currency: 'USD',
          items: [{ sku: item.sku, quantity }],
          shippingAddress: { line1: '1 Market Street', city: 'Boston', region: 'MA', postalCode: '02108', country: 'US' },
        }),
      });
      setNotice(`Order ${result.order.id.slice(0, 8)} reserved locally and queued for provider processing.`);
      await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Checkout failed'); }
    finally { setBusy(false); }
  }

  async function processNext() {
    setBusy(true);
    try {
      const result = await request<{ operation: { state: string } | null }>('/api/operations/process-next', { method: 'POST' });
      setNotice(result.operation ? `Provider operation finished with state: ${result.operation.state}.` : 'No provider operation is currently due.');
      await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Operation failed'); }
    finally { setBusy(false); }
  }

  return (
    <div className={identity ? 'codex-section-shell' : undefined}>
      {identity && <SectionSidebar title="Governed Commerce" items={[
        { href: '#overview', label: 'Overview' },
        { href: '#connection', label: 'Connection' },
        { href: '#checkout', label: 'Checkout' },
        { href: '#provider-queue', label: 'Provider Queue' },
        { href: '#orders', label: 'Order Ledger' },
      ]} />}
    <main>
      <header className="topbar">
        <div className="brand"><ShieldCheck size={22} /> Governed Commerce</div>
        <span className="environment">Persistent order control plane</span>
      </header>

      <section className="hero" id="overview">
        <div>
          <p className="eyebrow">ORDER OPERATIONS / LIVE STATE</p>
          <h1>Every transition has an owner, an idempotency key, and evidence.</h1>
          <p className="lede">Reserve inventory without overselling, coordinate provider writes, apply signed webhooks once, and recover uncertain outcomes under operator control.</p>
        </div>
        <div className="chain" aria-label="Order lifecycle">
          {['reserve', 'tax', 'pay', 'ship', 'refund'].map((step, index) => <span key={step}>{step}{index < 4 && <ArrowRight size={13} />}</span>)}
        </div>
      </section>

      <section className="connection panel" id="connection">
        <div>
          <label htmlFor="api">API endpoint</label>
          <input id="api" value={apiUrl} onChange={(event) => { setApiUrl(event.target.value); resetConnection(); }} />
        </div>
        <div className="token-field">
          <label htmlFor="token">Short-lived bearer token</label>
          <input id="token" type="password" autoComplete="off" value={token} onChange={(event) => { setToken(event.target.value); resetConnection(); }} placeholder="Not stored by this console" />
        </div>
        <button onClick={refresh} disabled={busy || !token}><RefreshCw size={16} /> Connect</button>
      </section>

      <div className={`notice ${identity ? 'ok' : ''}`}><Activity size={17} /> {notice}</div>

      <section className="metrics">
        <article><span>Identity</span><strong>{identity?.email || 'Disconnected'}</strong><small>{identity?.role || 'No live role'}</small></article>
        <article><span>Available SKUs</span><strong>{catalog.length}</strong><small>tenant-scoped inventory</small></article>
        <article><span>Visible orders</span><strong>{orders.length}</strong><small>role-scoped query</small></article>
        <article><span>Exceptions</span><strong>{orders.filter((order) => order.state === 'exception').length}</strong><small>require reconciliation</small></article>
      </section>

      <section className="workspace">
        <article className="panel" id="checkout">
          <div className="panel-heading"><div><p className="eyebrow">CUSTOMER</p><h2>Start a governed checkout</h2></div><span className="status">inventory locked</span></div>
          {catalog[0] ? (
            <form className="checkout" onSubmit={checkout}>
              <div><strong>{catalog[0].title}</strong><small>{catalog[0].sku} · {catalog[0].available_quantity} available</small></div>
              <span>{money(catalog[0].unit_price_cents)}</span>
              <label>Qty<input type="number" min="1" max={Math.max(1, catalog[0].available_quantity)} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label>
              <button disabled={busy || !identity || !['customer', 'operator'].includes(identity.role)}>Reserve &amp; queue <ArrowRight size={15} /></button>
            </form>
          ) : <p className="empty">Connect to a seeded tenant to load catalog inventory.</p>}
        </article>

        <article className="panel" id="provider-queue">
          <div className="panel-heading"><div><p className="eyebrow">OPERATIONS</p><h2>Provider queue</h2></div><span className="status warning">explicit writes</span></div>
          <p className="muted">The worker uses durable leases, bounded retries, and one idempotency key per external mutation. Ambiguous outcomes pause for reconciliation.</p>
          <button className="secondary" onClick={processNext} disabled={busy || identity?.role !== 'operator'}>Process next due operation</button>
        </article>
      </section>

      <section className="panel orders" id="orders">
        <div className="panel-heading"><div><p className="eyebrow">ORDER LEDGER</p><h2>Recent workflow state</h2></div><span className="status">immutable audit linked</span></div>
        {orders.length === 0 ? <p className="empty">No visible orders.</p> : orders.map((order) => (
          <div className="order-row" key={order.id}>
            <div><strong>{order.id.slice(0, 8)}</strong><small>{new Date(order.created_at).toLocaleString()}</small></div>
            <span className={`state state-${order.state}`}>{order.state.split('_').join(' ')}</span>
            <strong>{money(order.total_cents, order.currency)}</strong>
            <span className="failure">{order.failure_code ? <><CircleAlert size={14} /> {order.failure_code}</> : 'No exception'}</span>
          </div>
        ))}
      </section>
    </main>
    </div>
  );
}

export default App;
