import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatUsd } from '@/shared/format.js';
import { Button, Callout, Empty, Field, Input, Skeleton, toast } from '@/shared/ui/index.js';
import { AdminFrame } from './parts.jsx';
import { adminApi, adminKeys, priceDraft, useAdminModels, useIsSuperAdmin } from './queries.js';

const when = (iso) => new Date(iso).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Price history per model configuration and the form to add a new price version. Prices are never edited in place. */
export function AdminPricingPage() {
  const admin = useIsSuperAdmin();
  const models = useAdminModels(admin);
  const [selected, setSelected] = useState(/** @type {string | null} */ (null));
  const list = models.data ?? [];
  const current = list.find((m) => m.id === selected) ?? list[0] ?? null;
  return (
    <AdminFrame
      title="Model prices"
      intro="Every price is a new version with an effective date, a currency and the page where it was published. Finalized ledger entries keep the price they were calculated with; a backdated price applies only to usage recorded after it is entered."
    >
      {models.isPending ? (
        <Skeleton height={200} />
      ) : models.error ? (
        <Callout tone="bad">Models could not be loaded.</Callout>
      ) : (
        <div className="dash">
          <section className="card c-5" aria-labelledby="h-models">
            <div className="pad" style={{ paddingBottom: 0 }}>
              <h2 id="h-models">Model configurations</h2>
            </div>
            <table className="table">
              <caption className="sr">Model configurations with their current price</caption>
              <thead>
                <tr>
                  <th scope="col">Model config</th>
                  <th scope="col" className="num">
                    Current price
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((m) => {
                  const p = m.prices.find((x) => x.id === m.currentPriceId);
                  return (
                    <tr key={m.id} aria-selected={m.id === current?.id}>
                      <td>
                        <button type="button" className="linkish mono" onClick={() => setSelected(m.id)} aria-pressed={m.id === current?.id}>
                          {m.id}
                        </button>
                        <div className="subtle" style={{ fontSize: 11.5 }}>
                          {m.provider} · {m.status.toLowerCase()}
                          {m.isDemo ? ' · DEMO' : ''}
                        </div>
                      </td>
                      <td className="num mono">
                        {!p ? <span className="subtle">none</span> : p.unit === 'CPU_HOUR' ? `${formatUsd(p.inputPerMTok, { min: 2 })} / CPU-h` : `${formatUsd(p.inputPerMTok, { min: 2 })} / ${formatUsd(p.outputPerMTok, { min: 2 })}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
          {current && <PriceHistory key={current.id} model={current} />}
        </div>
      )}
    </AdminFrame>
  );
}

function PriceHistory({ model }) {
  const local = model.provider === 'local';
  return (
    <section className="card c-7" aria-labelledby="h-history">
      <div className="pad" style={{ paddingBottom: 0 }}>
        <h2 id="h-history">
          <span className="mono">{model.id}</span> price history
        </h2>
        <p className="subtle" style={{ fontSize: 12.5, marginTop: 4 }}>
          {local ? 'Local compute is priced per CPU-hour of embedding and rerank time.' : 'USD per 1M tokens. Cached input falls back to the input rate when empty.'}
        </p>
      </div>
      {!model.prices.length ? (
        <div className="pad">
          <Empty>No price yet. Until one is entered, usage is recorded at $0 as FINAL_ESTIMATED.</Empty>
        </div>
      ) : (
        <div style={{ overflow: 'auto' }}>
          <table className="table">
            <caption className="sr">Price versions, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Effective from</th>
                {local ? (
                  <th scope="col" className="num">
                    Per CPU-hour
                  </th>
                ) : (
                  <>
                    <th scope="col" className="num">
                      Input
                    </th>
                    <th scope="col" className="num">
                      Cached
                    </th>
                    <th scope="col" className="num">
                      Output
                    </th>
                  </>
                )}
                <th scope="col">Source</th>
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {model.prices.map((p) => (
                <tr key={p.id}>
                  <td>{when(p.effectiveFrom)}</td>
                  <td className="num mono">{formatUsd(p.inputPerMTok, { min: 2 })}</td>
                  {!local && (
                    <>
                      <td className="num mono">{p.cachedInputPerMTok ? formatUsd(p.cachedInputPerMTok, { min: 2 }) : '—'}</td>
                      <td className="num mono">{formatUsd(p.outputPerMTok, { min: 2 })}</td>
                    </>
                  )}
                  <td className="subtle" style={{ maxWidth: 220, overflowWrap: 'anywhere' }}>
                    {p.sourceUrl.startsWith('https://') ? (
                      <a href={p.sourceUrl} target="_blank" rel="noreferrer">
                        {new URL(p.sourceUrl).hostname}
                      </a>
                    ) : (
                      p.sourceUrl
                    )}
                    {p.isDemo ? ' · DEMO' : ''}
                  </td>
                  <td>
                    <span className="badge" data-tone={p.id === model.currentPriceId ? 'ok' : p.scheduled ? 'info' : undefined}>
                      {p.id === model.currentPriceId ? 'Current' : p.scheduled ? 'Scheduled' : 'Superseded'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AddPrice model={model} />
    </section>
  );
}

function AddPrice({ model }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(() => priceDraft(model));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const local = model.provider === 'local';
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await adminApi.addPrice(model.id, {
        unit: form.unit,
        inputPerMTok: form.inputPerMTok.trim(),
        ...(local ? {} : { outputPerMTok: form.outputPerMTok.trim() }),
        ...(!local && form.cachedInputPerMTok.trim() ? { cachedInputPerMTok: form.cachedInputPerMTok.trim() } : {}),
        ...(form.effectiveFrom ? { effectiveFrom: new Date(form.effectiveFrom).toISOString() } : {}),
        sourceUrl: form.sourceUrl.trim(),
        isDemo: form.isDemo,
        currency: 'USD',
      });
      toast(res.note ?? 'Price added', res.note ? 'warn' : 'ok');
      setForm((f) => ({ ...f, effectiveFrom: '', sourceUrl: '' }));
      qc.invalidateQueries({ queryKey: adminKeys.all });
      qc.invalidateQueries({ queryKey: ['models'] });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="pad" onSubmit={submit} aria-labelledby="h-addprice">
      <h3 id="h-addprice" className="sect-h">
        Add a price version
      </h3>
      <div className="form" style={{ maxWidth: 'none', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', marginTop: 8 }}>
        <Field label={local ? 'USD per CPU-hour' : 'Input (USD / 1M)'}>
          <Input inputMode="decimal" value={form.inputPerMTok} onChange={set('inputPerMTok')} required />
        </Field>
        {!local && (
          <>
            <Field label="Cached input (USD / 1M)" hint="Optional">
              <Input inputMode="decimal" value={form.cachedInputPerMTok} onChange={set('cachedInputPerMTok')} />
            </Field>
            <Field label="Output (USD / 1M)">
              <Input inputMode="decimal" value={form.outputPerMTok} onChange={set('outputPerMTok')} required />
            </Field>
          </>
        )}
        <Field label="Effective from" hint="Empty means now; a future time schedules the price">
          <Input type="datetime-local" value={form.effectiveFrom} onChange={set('effectiveFrom')} />
        </Field>
        <Field label="Source URL" hint="The https page where the price is published; demo:// only for DEMO prices">
          <Input type="url" value={form.sourceUrl} onChange={set('sourceUrl')} placeholder="https://" required />
        </Field>
        <label className="row" style={{ alignSelf: 'end', paddingBottom: 8 }}>
          <input type="checkbox" checked={form.isDemo} onChange={set('isDemo')} /> DEMO price (illustrative)
        </label>
      </div>
      <p className="subtle" style={{ fontSize: 12, marginTop: 6 }}>
        Currency: USD. The ledger does not convert currencies.
      </p>
      {error && (
        <p role="alert" style={{ color: 'var(--fv-bad)', marginTop: 8 }}>
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" size="sm" disabled={busy} style={{ marginTop: 10 }}>
        Add price
      </Button>
    </form>
  );
}
