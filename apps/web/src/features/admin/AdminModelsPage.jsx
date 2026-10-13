import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { formatInt } from '@/shared/format.js';
import { Button, Callout, Empty, Skeleton, toast } from '@/shared/ui/index.js';
import { AdminFrame } from './parts.jsx';
import { adminApi, adminKeys, useAdminModels, useIsSuperAdmin, useRegistryDiff } from './queries.js';

const STATUS_TONE = { VERIFIED: 'ok', UNVERIFIED: 'warn', DISABLED: 'bad' };

/** Model registry: verify or disable configurations, choose the default, and compare with the seed file. */
export function AdminModelsPage() {
  const admin = useIsSuperAdmin();
  const qc = useQueryClient();
  const models = useAdminModels(admin);
  const diff = useRegistryDiff(admin);
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: adminKeys.all });
    qc.invalidateQueries({ queryKey: ['models'] });
  };
  const patch = async (m, body, message) => {
    try {
      await adminApi.patchModel(m.id, body);
      toast(message, 'ok');
      refresh();
    } catch (e) {
      toast(e.message, 'bad');
    }
  };
  const sync = async () => {
    setBusy(true);
    try {
      const r = await adminApi.syncRegistry();
      toast(r.created.length ? `Added ${r.created.join(', ')} as unverified` : 'Nothing to add: every seed entry with a model id is registered', 'ok');
      refresh();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  const d = diff.data;
  const pending = d ? d.added.length + d.changed.length : 0;

  return (
    <AdminFrame
      title="Model registry"
      intro="Model ids come from environment variables; this page never invents one. New entries arrive unverified. Verifying a model confirms its id and price with the provider; disabled models are never routed to."
    >
      {models.isPending ? (
        <Skeleton height={200} />
      ) : models.error ? (
        <Callout tone="bad">The registry could not be loaded.</Callout>
      ) : (
        <div className="dash">
          <section className="card c-12" aria-labelledby="h-registry">
            <div className="pad" style={{ paddingBottom: 0 }}>
              <h2 id="h-registry">Registered models</h2>
            </div>
            <div style={{ overflow: 'auto' }}>
              <table className="table">
                <caption className="sr">Model configurations</caption>
                <thead>
                  <tr>
                    <th scope="col">Model config</th>
                    <th scope="col">Provider · model id</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="num">
                      Context
                    </th>
                    <th scope="col">Price</th>
                    <th scope="col">
                      <span className="sr">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {models.data.map((m) => {
                    const chat = m.capabilities.includes('chat');
                    return (
                      <tr key={m.id}>
                        <td>
                          <span className="mono">{m.id}</span>
                          {m.isDefault && (
                            <span className="badge" data-tone="ai" style={{ marginLeft: 6 }}>
                              Default
                            </span>
                          )}
                          {m.isDemo && (
                            <span className="badge" style={{ marginLeft: 6 }}>
                              DEMO
                            </span>
                          )}
                          <div className="subtle" style={{ fontSize: 11.5 }}>
                            {m.displayName}
                          </div>
                        </td>
                        <td className="mono">
                          {m.provider} · {m.model}
                          {!m.available && m.status !== 'DISABLED' && <div className="subtle">provider not configured</div>}
                        </td>
                        <td>
                          <span className="badge" data-tone={STATUS_TONE[m.status]}>
                            {m.status.toLowerCase()}
                          </span>
                        </td>
                        <td className="num mono">{m.contextWindow ? formatInt(m.contextWindow) : '—'}</td>
                        <td>{m.currentPriceId ? <Link to="/app/admin/pricing">priced</Link> : <span className="subtle">no price</span>}</td>
                        <td>
                          <div className="row" style={{ justifyContent: 'flex-end' }}>
                            {m.status !== 'VERIFIED' && (
                              <Button size="sm" onClick={() => patch(m, { status: 'VERIFIED' }, `${m.id} verified`)} aria-label={`Verify ${m.id}`}>
                                Verify
                              </Button>
                            )}
                            {m.status !== 'DISABLED' ? (
                              <Button size="sm" variant="ghost" onClick={() => patch(m, { status: 'DISABLED' }, `${m.id} disabled`)} aria-label={`Disable ${m.id}`} disabled={m.isDefault}>
                                Disable
                              </Button>
                            ) : (
                              <Button size="sm" variant="ghost" onClick={() => patch(m, { status: 'UNVERIFIED' }, `${m.id} re-enabled as unverified`)} aria-label={`Re-enable ${m.id}`}>
                                Re-enable
                              </Button>
                            )}
                            {chat && !m.isDefault && m.status !== 'DISABLED' && (
                              <Button size="sm" variant="ghost" onClick={() => patch(m, { isDefault: true }, `${m.id} is now the default chat model`)} aria-label={`Make ${m.id} the default`}>
                                Make default
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card pad c-12" aria-labelledby="h-diff">
            <div className="row between">
              <h2 id="h-diff">Seed file vs registry</h2>
              <Button size="sm" variant="primary" onClick={sync} disabled={busy || !d?.added.some((a) => !a.blockedBy)}>
                Add new seed entries
              </Button>
            </div>
            <p className="subtle" style={{ fontSize: 12.5, marginTop: 4 }}>
              config/models/registry.seed.yaml against the database. Syncing only adds missing entries (unverified); it never overwrites an admin’s edits.
            </p>
            {diff.isPending ? (
              <Skeleton height={60} />
            ) : !d || (!pending && !d.removed.length) ? (
              <Empty>The registry matches the seed file.</Empty>
            ) : (
              <div className="dash" style={{ marginTop: 12 }}>
                <div className="c-4">
                  <h3 className="sect-h">Only in the seed file</h3>
                  {d.added.length ? (
                    <ul className="list" style={{ fontSize: 13 }}>
                      {d.added.map((a) => (
                        <li key={a.id} className="li">
                          <span className="mono">{a.id}</span>
                          <span className="subtle">{a.blockedBy ? `waiting for ${a.blockedBy}` : a.provider}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="subtle">None</p>
                  )}
                </div>
                <div className="c-4">
                  <h3 className="sect-h">Only in the database</h3>
                  {d.removed.length ? (
                    <ul className="list" style={{ fontSize: 13 }}>
                      {d.removed.map((r) => (
                        <li key={r.id} className="li">
                          <span className="mono">{r.id}</span>
                          <span className="subtle">{r.provider}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="subtle">None</p>
                  )}
                </div>
                <div className="c-4">
                  <h3 className="sect-h">Different</h3>
                  {d.changed.length ? (
                    <ul className="list" style={{ fontSize: 13 }}>
                      {d.changed.map((c) => (
                        <li key={c.id} className="li" style={{ display: 'block' }}>
                          <span className="mono">{c.id}</span>
                          {c.fields.map((f) => (
                            <div key={f.field} className="subtle mono" style={{ fontSize: 11.5 }}>
                              {f.field}: seed {String(f.seed)} · db {String(f.db)}
                            </div>
                          ))}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="subtle">None</p>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </AdminFrame>
  );
}
