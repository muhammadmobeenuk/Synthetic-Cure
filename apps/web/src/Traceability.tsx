import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, newOperation, ApiError, saveDraft, getDraft, deleteDraft } from './api';
import { registerPendingCapture } from './work-preservation';
import { draftScope, type Identity } from './draft-scope';
import {
  ShieldAlert,
  Search,
  AlertTriangle,
  RotateCcw,
  Download,
  CheckCircle2,
  Lock,
  Unlock,
  Radio,
  FileSpreadsheet,
  Boxes,
  Truck,
  ArrowRight,
  Package,
  Layers,
  ChevronRight,
  RefreshCw,
  Clock,
} from 'lucide-react';

type Row = Record<string, any>;

export function Traceability({
  actor,
  products = [],
  locations = [],
  canAdjust = false,
  canReview = false,
  onSaved,
}: {
  actor: Identity & { role?: string };
  products: Row[];
  locations: Row[];
  canAdjust?: boolean;
  canReview?: boolean;
  onSaved?: () => void;
}) {
  const scope = draftScope(actor);
  const canManageQuality = canReview || canAdjust || actor.role === 'admin' || actor.role === 'administrator' || actor.role === 'supervisor';
  const [activeTab, setActiveTab] = useState<'holds' | 'recalls' | 'investigation' | 'outbox'>('holds');

  // --- Holds state ---
  const holdsQuery = useQuery({
    queryKey: ['quality-holds', scope],
    queryFn: () => api('/quality-holds'),
    retry: false,
  });
  const [holdScope, setHoldScope] = useState<'box' | 'product' | 'lot' | 'location'>('product');
  const [holdTargetId, setHoldTargetId] = useState('');
  const [holdReason, setHoldReason] = useState('');
  const [holdSeverity, setHoldSeverity] = useState<'minor' | 'major' | 'critical'>('major');
  const [releasingHold, setReleasingHold] = useState<Row | null>(null);
  const [releaseReason, setReleaseReason] = useState('');

  // --- Recalls state ---
  const recallsQuery = useQuery({
    queryKey: ['recalls', scope],
    queryFn: () => api('/recalls'),
    retry: false,
  });
  const [recallCode, setRecallCode] = useState('');
  const [recallTitle, setRecallTitle] = useState('');
  const [recallProdId, setRecallProdId] = useState('');
  const [recallLotId, setRecallLotId] = useState('');
  const [recallReason, setRecallReason] = useState('');
  const [recallSeverity, setRecallSeverity] = useState<'class_1' | 'class_2' | 'class_3'>('class_1');
  const [selectedRecallId, setSelectedRecallId] = useState<string | null>(null);

  const recallReportQuery = useQuery({
    queryKey: ['recall-report', scope, selectedRecallId],
    queryFn: () => api(`/recalls/${selectedRecallId}`),
    enabled: !!selectedRecallId,
    retry: false,
  });
  const [closingRecall, setClosingRecall] = useState<Row | null>(null);
  const [closureNotes, setClosureNotes] = useState('');

  // --- Investigation state ---
  const [traceType, setTraceType] = useState<'backward' | 'forward'>('backward');
  const [searchBoxCode, setSearchBoxCode] = useState('');
  const [searchLotReference, setSearchLotReference] = useState('');
  const [searchSerial, setSearchSerial] = useState('');
  const [backwardResult, setBackwardResult] = useState<any>(null);
  const [forwardResult, setForwardResult] = useState<any>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState('');

  // --- Outbox state ---
  const outboxQuery = useQuery({
    queryKey: ['sync-outbox', scope],
    queryFn: () => api('/sync/outbox'),
    refetchInterval: 10000,
  });
  const [conflictItem, setConflictItem] = useState<Row | null>(null);
  const [rebaseVersion, setRebaseVersion] = useState<number>(1);

  // Common UI feedback
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Work preservation draft key
  useEffect(() => {
    registerPendingCapture(async () => {
      await saveDraft(scope, 'traceability-draft', {
        activeTab,
        holdScope,
        holdTargetId,
        holdReason,
        recallCode,
        recallTitle,
        recallProdId,
        recallReason,
      });
    });
  }, [scope, activeTab, holdScope, holdTargetId, holdReason, recallCode, recallTitle, recallProdId, recallReason]);

  useEffect(() => {
    getDraft(scope, 'traceability-draft').then((d) => {
      if (d) {
        if (d.activeTab) setActiveTab(d.activeTab);
        if (d.holdScope) setHoldScope(d.holdScope);
        if (d.holdTargetId) setHoldTargetId(d.holdTargetId);
        if (d.holdReason) setHoldReason(d.holdReason);
        if (d.recallCode) setRecallCode(d.recallCode);
        if (d.recallTitle) setRecallTitle(d.recallTitle);
        if (d.recallProdId) setRecallProdId(d.recallProdId);
        if (d.recallReason) setRecallReason(d.recallReason);
      }
    }).catch(() => {});
  }, [scope]);

  // Place quality hold
  async function handlePlaceHold(e: React.FormEvent) {
    e.preventDefault();
    if (!holdTargetId || !holdReason) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api('/quality-holds', {
        scope: holdScope,
        targetId: holdTargetId,
        reason: holdReason,
        severity: holdSeverity,
        clientOperationId: newOperation(),
      });
      setNotice(`Quality quarantine hold active on ${holdScope} · allocation and picking blocked`);
      setHoldReason('');
      setHoldTargetId('');
      await holdsQuery.refetch();
      if (onSaved) onSaved();
    } catch (err: any) {
      setError(err.message || 'Failed to place quality hold');
    } finally {
      setBusy(false);
    }
  }

  // Release quality hold
  async function handleReleaseHold(e: React.FormEvent) {
    e.preventDefault();
    if (!releasingHold || !releaseReason) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/quality-holds/${releasingHold.id}/release`, {
        expectedVersion: releasingHold.version,
        releaseReason,
        clientOperationId: newOperation(),
      });
      setNotice(`Quality hold ${releasingHold.id.slice(0, 8)} released · goods condition restored`);
      setReleasingHold(null);
      setReleaseReason('');
      await holdsQuery.refetch();
      if (onSaved) onSaved();
    } catch (err: any) {
      setError(err.message || 'Failed to release quality hold');
    } finally {
      setBusy(false);
    }
  }

  // Initiate product recall
  async function handleInitiateRecall(e: React.FormEvent) {
    e.preventDefault();
    if (!recallCode || !recallTitle || !recallProdId || !recallReason) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await api('/recalls', {
        code: recallCode,
        title: recallTitle,
        productId: recallProdId,
        lotId: recallLotId || undefined,
        reason: recallReason,
        severity: recallSeverity,
        clientOperationId: newOperation(),
      });
      setNotice(
        `Recall ${recallCode} initiated · ${res.affected_on_hand_boxes} on-hand boxes moved to quarantine hold`,
      );
      setRecallCode('');
      setRecallTitle('');
      setRecallReason('');
      setRecallLotId('');
      await recallsQuery.refetch();
      setSelectedRecallId(res.id);
      if (onSaved) onSaved();
    } catch (err: any) {
      setError(err.message || 'Failed to initiate product recall');
    } finally {
      setBusy(false);
    }
  }

  // Close recall
  async function handleCloseRecall(e: React.FormEvent) {
    e.preventDefault();
    if (!closingRecall || !closureNotes) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/recalls/${closingRecall.id}/close`, {
        expectedVersion: closingRecall.version,
        closureNotes,
        clientOperationId: newOperation(),
      });
      setNotice(`Recall ${closingRecall.code} closed and archived`);
      setClosingRecall(null);
      setClosureNotes('');
      await recallsQuery.refetch();
      if (selectedRecallId === closingRecall.id) {
        await recallReportQuery.refetch();
      }
      if (onSaved) onSaved();
    } catch (err: any) {
      setError(err.message || 'Failed to close recall');
    } finally {
      setBusy(false);
    }
  }

  // Run backward trace
  async function runBackwardTrace(e: React.FormEvent) {
    e.preventDefault();
    if (!searchBoxCode.trim()) return;
    setTraceLoading(true);
    setTraceError('');
    setBackwardResult(null);
    try {
      const res = await api(`/traceability/backward?boxCode=${encodeURIComponent(searchBoxCode.trim())}`);
      setBackwardResult(res);
    } catch (err: any) {
      setTraceError(err.message || 'Backward trace investigation failed');
    } finally {
      setTraceLoading(false);
    }
  }

  // Run forward trace
  async function runForwardTrace(e: React.FormEvent) {
    e.preventDefault();
    setTraceLoading(true);
    setTraceError('');
    setForwardResult(null);
    try {
      const params = new URLSearchParams();
      if (searchLotReference.trim()) params.append('lotReference', searchLotReference.trim());
      if (searchSerial.trim()) params.append('serialNumber', searchSerial.trim());
      const res = await api(`/traceability/forward?${params.toString()}`);
      setForwardResult(res);
    } catch (err: any) {
      setTraceError(err.message || 'Forward trace investigation failed');
    } finally {
      setTraceLoading(false);
    }
  }

  // Resolve sync conflict
  async function handleResolveConflict(action: 'retry' | 'rebase' | 'discard') {
    if (!conflictItem) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api('/sync/resolve-conflict', {
        queueId: conflictItem.id,
        action,
        rebaseExpectedVersion: action === 'rebase' ? rebaseVersion : undefined,
      });
      setNotice(`Conflict resolved with action: ${action}`);
      setConflictItem(null);
      await outboxQuery.refetch();
    } catch (err: any) {
      setError(err.message || 'Failed to resolve conflict');
    } finally {
      setBusy(false);
    }
  }

  const activeHolds = (holdsQuery.data || []).filter((h: Row) => h.status === 'active');
  const pastHolds = (holdsQuery.data || []).filter((h: Row) => h.status === 'released');
  const activeRecalls = (recallsQuery.data || []).filter((r: Row) => r.status === 'active');
  const closedRecalls = (recallsQuery.data || []).filter((r: Row) => r.status === 'completed');
  const outboxItems = outboxQuery.data || [];
  const conflictCount = outboxItems.filter((i: Row) => i.status === 'conflict').length;
  const pendingCount = outboxItems.filter((i: Row) => i.status === 'pending' || i.status === 'syncing').length;

  return (
    <section className="panel entity-card traceability-suite" aria-label="Traceability, Quarantine & Recalls">
      {/* Header */}
      <div className="section-head" style={{ marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldAlert size={22} color="#087a55" />
            <h2 style={{ margin: 0 }}>Traceability, Quarantine & Recalls</h2>
          </div>
          <p style={{ margin: '4px 0 0 0', color: '#536575' }}>
            Authoritative batch & serial tracing, quarantine safety holds, product recalls and scoped offline sync.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {conflictCount > 0 && (
            <span
              className="badge"
              style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #f87171', cursor: 'pointer' }}
              onClick={() => setActiveTab('outbox')}
            >
              <AlertTriangle size={14} /> {conflictCount} sync conflicts
            </span>
          )}
          {pendingCount > 0 && (
            <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1' }}>
              <Clock size={14} /> {pendingCount} queued
            </span>
          )}
          <span className="badge" style={{ background: activeHolds.length ? '#fef3c7' : '#ecfdf5', color: activeHolds.length ? '#92400e' : '#065f46' }}>
            <Lock size={14} /> {activeHolds.length} active holds
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="tab-bar" style={{ display: 'flex', gap: 6, borderBottom: '1px solid #d8e1e7', paddingBottom: 8, marginBottom: 16 }}>
        <button
          type="button"
          className={`btn ${activeTab === 'holds' ? 'primary' : 'secondary'}`}
          onClick={() => setActiveTab('holds')}
        >
          <Lock size={16} /> Quarantine Holds ({activeHolds.length})
        </button>
        <button
          type="button"
          className={`btn ${activeTab === 'recalls' ? 'primary' : 'secondary'}`}
          onClick={() => setActiveTab('recalls')}
        >
          <AlertTriangle size={16} /> Recalls & Dossiers ({activeRecalls.length})
        </button>
        <button
          type="button"
          className={`btn ${activeTab === 'investigation' ? 'primary' : 'secondary'}`}
          onClick={() => setActiveTab('investigation')}
        >
          <Search size={16} /> Forward & Backward Trace
        </button>
        <button
          type="button"
          className={`btn ${activeTab === 'outbox' ? 'primary' : 'secondary'}`}
          onClick={() => setActiveTab('outbox')}
        >
          <Radio size={16} /> Scoped Sync Outbox {conflictCount > 0 ? `(${conflictCount} conflicts)` : ''}
        </button>
      </div>

      {/* Notices & Alerts */}
      {error && (
        <div className="notice error" role="alert" style={{ marginBottom: 12 }}>
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="notice success" role="status" style={{ marginBottom: 12 }}>
          <CheckCircle2 size={18} />
          <span>{notice}</span>
        </div>
      )}

      {/* TAB 1: QUALITY QUARANTINE HOLDS */}
      {activeTab === 'holds' && (
        <div className="stack" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="notice warning">
            <Lock size={18} />
            <span>
              Quality quarantine holds strictly block allocation, picking verification, and vehicle loading.
              Only supervisors or administrators can place or release holds.
            </span>
          </div>

          {/* Place Hold Form */}
          {canManageQuality && (
            <article className="panel" style={{ background: '#fafbfc', border: '1px solid #d8e1e7', padding: 16, borderRadius: 6 }}>
              <h3 style={{ margin: '0 0 12px 0' }}>Place Quarantine Safety Hold</h3>
              <form onSubmit={handlePlaceHold}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
                  <label>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>Quarantine Scope</span>
                    <select
                      value={holdScope}
                      onChange={(e: any) => {
                        setHoldScope(e.target.value);
                        setHoldTargetId('');
                      }}
                      disabled={busy}
                      style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 4, border: '1px solid #ccd5da' }}
                    >
                      <option value="product">Product (All batches / stock)</option>
                      <option value="box">Physical Box ID</option>
                      <option value="lot">Lot / Batch ID</option>
                      <option value="location">Storage Location ID</option>
                    </select>
                  </label>

                  <label>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>Target Entity</span>
                    {holdScope === 'product' ? (
                      <select
                        required
                        value={holdTargetId}
                        onChange={(e) => setHoldTargetId(e.target.value)}
                        disabled={busy}
                        style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 4, border: '1px solid #ccd5da' }}
                      >
                        <option value="">Select affected product…</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.sku} · {p.name}
                          </option>
                        ))}
                      </select>
                    ) : holdScope === 'location' ? (
                      <select
                        required
                        value={holdTargetId}
                        onChange={(e) => setHoldTargetId(e.target.value)}
                        disabled={busy}
                        style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 4, border: '1px solid #ccd5da' }}
                      >
                        <option value="">Select quarantine location…</option>
                        {locations.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.code} · {l.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        required
                        type="text"
                        placeholder={`Enter exact ${holdScope} ID…`}
                        value={holdTargetId}
                        onChange={(e) => setHoldTargetId(e.target.value)}
                        disabled={busy}
                        style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 4, border: '1px solid #ccd5da' }}
                      />
                    )}
                  </label>

                  <label>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>Severity</span>
                    <select
                      value={holdSeverity}
                      onChange={(e: any) => setHoldSeverity(e.target.value)}
                      disabled={busy}
                      style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 4, border: '1px solid #ccd5da' }}
                    >
                      <option value="critical">Critical (Immediate containment)</option>
                      <option value="major">Major (Safety / compliance risk)</option>
                      <option value="minor">Minor (Investigation / precautionary)</option>
                    </select>
                  </label>
                </div>

                <label style={{ display: 'block', marginBottom: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Reason for Quarantine</span>
                  <input
                    required
                    type="text"
                    placeholder="e.g. Temperature deviation, damaged packaging, supplier notification…"
                    value={holdReason}
                    onChange={(e) => setHoldReason(e.target.value)}
                    disabled={busy}
                    style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 4, border: '1px solid #ccd5da' }}
                  />
                </label>

                <button type="submit" className="btn primary" disabled={busy || !holdTargetId || !holdReason}>
                  <Lock size={16} /> Place Quarantine Hold
                </button>
              </form>
            </article>
          )}

          {/* Active Holds List */}
          <div>
            <h3 style={{ margin: '12px 0 8px 0' }}>Active Quarantine Holds ({activeHolds.length})</h3>
            {holdsQuery.isPending ? (
              <p>Loading quality holds…</p>
            ) : !activeHolds.length ? (
              <p style={{ color: '#536575' }}>No active quarantine holds in this warehouse.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {activeHolds.map((h: Row) => (
                  <div
                    key={h.id}
                    className="import-row"
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      background: '#fffdf5',
                      border: '1px solid #fde68a',
                      padding: 12,
                      borderRadius: 6,
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          className="badge"
                          style={{
                            background: h.severity === 'critical' ? '#fee2e2' : h.severity === 'major' ? '#ffedd5' : '#fef9c3',
                            color: h.severity === 'critical' ? '#991b1b' : h.severity === 'major' ? '#9a3412' : '#854d0e',
                            textTransform: 'uppercase',
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          {h.severity}
                        </span>
                        <strong>
                          {h.scope.toUpperCase()}: {h.target_id}
                        </strong>
                      </div>
                      <p style={{ margin: '4px 0 0 0', color: '#1f2937' }}>{h.reason}</p>
                      <small style={{ color: '#6b7280' }}>
                        Placed on {String(h.created_at || '').slice(0, 16).replace('T', ' ')} by {h.placed_by || 'Admin'}
                      </small>
                    </div>
                    {canManageQuality && (
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => setReleasingHold(h)}
                        disabled={busy}
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                      >
                        <Unlock size={14} /> Release Hold
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Release Modal Dialog */}
          {releasingHold && (
            <div
              className="modal-backdrop"
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999,
              }}
            >
              <div
                className="panel"
                style={{
                  background: 'white',
                  maxWidth: 500,
                  width: '90%',
                  padding: 24,
                  borderRadius: 8,
                  boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
                }}
              >
                <h3>Release Quarantine Hold</h3>
                <p>
                  Target: <strong>{releasingHold.scope}</strong> ({releasingHold.target_id})
                </p>
                <p style={{ color: '#536575', fontSize: 13 }}>
                  Release restores item condition to confirmed stock and re-enables allocation. A formal release reason
                  and supervisor inspection disposition are required for the audit record.
                </p>
                <form onSubmit={handleReleaseHold}>
                  <label style={{ display: 'block', marginBottom: 16 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>Release Reason / Inspection Notes</span>
                    <textarea
                      required
                      rows={3}
                      value={releaseReason}
                      onChange={(e) => setReleaseReason(e.target.value)}
                      placeholder="e.g. Lab test cleared, repack completed, false positive verified…"
                      style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 4, border: '1px solid #ccd5da' }}
                    />
                  </label>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button type="button" className="btn secondary" onClick={() => setReleasingHold(null)}>
                      Cancel
                    </button>
                    <button type="submit" className="btn primary" disabled={busy || !releaseReason.trim()}>
                      Confirm Release
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Past Released Holds */}
          {pastHolds.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: 'pointer', color: '#536575' }}>
                View Released Quarantine Audit History ({pastHolds.length})
              </summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {pastHolds.map((h: Row) => (
                  <div key={h.id} style={{ padding: 8, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13 }}>
                    <span style={{ color: '#059669', fontWeight: 600 }}>RELEASED</span> · {h.scope.toUpperCase()}: {h.target_id} · Reason: {h.reason} · Release Notes: {h.release_reason || 'N/A'}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* TAB 2: RECALLS & IMPACT DOSSIERS */}
      {activeTab === 'recalls' && (
        <div className="stack" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="notice warning">
            <AlertTriangle size={18} />
            <span>
              Initiating a recall atomically locks all matching on-hand inventory into quarantine hold, performs a forward
              trace across all dispatched orders and customers, and generates an audit dossier with formula injection neutralization.
            </span>
          </div>

          {/* Initiate Recall Form */}
          {canManageQuality && (
            <article className="panel" style={{ background: '#fafbfc', border: '1px solid #d8e1e7', padding: 16, borderRadius: 6 }}>
              <h3 style={{ margin: '0 0 12px 0' }}>Initiate Product Safety Recall</h3>
              <form onSubmit={handleInitiateRecall}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
                  <label>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>Recall Code</span>
                    <input
                      required
                      type="text"
                      placeholder="e.g. RC-2026-001"
                      value={recallCode}
                      onChange={(e) => setRecallCode(e.target.value)}
                      disabled={busy}
                      style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 4, border: '1px solid #ccd5da' }}
                    />
                  </label>

                  <label>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>Recall Title</span>
                    <input
                      required
                      type="text"
                      placeholder="e.g. Allergen Mislabeling"
                      value={recallTitle}
                      onChange={(e) => setRecallTitle(e.target.value)}
                      disabled={busy}
                      style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 4, border: '1px solid #ccd5da' }}
                    />
                  </label>

                  <label>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>Product</span>
                    <select
                      required
                      value={recallProdId}
                      onChange={(e) => setRecallProdId(e.target.value)}
                      disabled={busy}
                      style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 4, border: '1px solid #ccd5da' }}
                    >
                      <option value="">Select recalled product…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.sku} · {p.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>Optional Lot ID</span>
                    <input
                      type="text"
                      placeholder="Optional batch / lot ID"
                      value={recallLotId}
                      onChange={(e) => setRecallLotId(e.target.value)}
                      disabled={busy}
                      style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 4, border: '1px solid #ccd5da' }}
                    />
                  </label>

                  <label>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>Class Severity</span>
                    <select
                      value={recallSeverity}
                      onChange={(e: any) => setRecallSeverity(e.target.value)}
                      disabled={busy}
                      style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 4, border: '1px solid #ccd5da' }}
                    >
                      <option value="class_1">Class I (Dangerous / life-threatening)</option>
                      <option value="class_2">Class II (Temporary / medically reversible)</option>
                      <option value="class_3">Class III (Unlikely to cause adverse reaction)</option>
                    </select>
                  </label>
                </div>

                <label style={{ display: 'block', marginBottom: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Official Recall Reason & Evidence</span>
                  <input
                    required
                    type="text"
                    placeholder="Specific defect, manufacturer bulletin or regulatory order…"
                    value={recallReason}
                    onChange={(e) => setRecallReason(e.target.value)}
                    disabled={busy}
                    style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 4, border: '1px solid #ccd5da' }}
                  />
                </label>

                <button type="submit" className="btn primary" disabled={busy || !recallCode || !recallTitle || !recallProdId || !recallReason}>
                  <AlertTriangle size={16} /> Initiate Authoritative Recall
                </button>
              </form>
            </article>
          )}

          {/* Recalls List */}
          <div>
            <h3 style={{ margin: '12px 0 8px 0' }}>Active & Past Recalls</h3>
            {recallsQuery.isPending ? (
              <p>Loading recalls…</p>
            ) : !recallsQuery.data?.length ? (
              <p style={{ color: '#536575' }}>No recalls registered.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {recallsQuery.data.map((r: Row) => (
                  <div
                    key={r.id}
                    className="import-row"
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      background: r.status === 'active' ? '#fff5f5' : '#f8fafc',
                      border: r.status === 'active' ? '1px solid #fecaca' : '1px solid #e2e8f0',
                      padding: 12,
                      borderRadius: 6,
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          className="badge"
                          style={{
                            background: r.severity === 'class_1' ? '#fee2e2' : '#fed7aa',
                            color: r.severity === 'class_1' ? '#991b1b' : '#9a3412',
                            fontWeight: 700,
                          }}
                        >
                          {r.severity.toUpperCase().replace('_', ' ')}
                        </span>
                        <strong>{r.code}</strong> — {r.title}
                        <span className="badge">{r.status}</span>
                      </div>
                      <p style={{ margin: '4px 0 0 0', color: '#1f2937' }}>{r.reason}</p>
                      <small style={{ color: '#6b7280' }}>
                        Affected On-Hand: {r.affected_on_hand_boxes} boxes · Outbound Shipments: {r.affected_delivered_boxes} boxes
                      </small>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => setSelectedRecallId(selectedRecallId === r.id ? null : r.id)}
                      >
                        {selectedRecallId === r.id ? 'Hide Report' : 'View Impact Dossier'}
                      </button>
                      <a
                        href={`/api/v1/recalls/${r.id}/export`}
                        download={`recall-${r.code}.csv`}
                        className="btn secondary"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      >
                        <Download size={14} /> Export CSV
                      </a>
                      {r.status === 'active' && canManageQuality && (
                          <button type="button" className="btn secondary" onClick={() => setClosingRecall(r)}>
                            Close Recall
                          </button>
                        )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Selected Recall Dossier View */}
          {selectedRecallId && (
            <article className="panel" style={{ background: '#f8fafc', border: '1px solid #cbd5e1', padding: 16, borderRadius: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>Recall Impact & Dispersion Dossier</h3>
                <button type="button" className="btn secondary" onClick={() => setSelectedRecallId(null)}>
                  Close Dossier
                </button>
              </div>

              {recallReportQuery.isPending ? (
                <p>Generating recall dispersion analysis…</p>
              ) : recallReportQuery.error ? (
                <p className="notice error">Failed to load recall dossier</p>
              ) : (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
                    <div style={{ background: 'white', padding: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}>
                      <div style={{ color: '#64748b', fontSize: 12 }}>Quarantined On-Hand</div>
                      <div style={{ fontSize: 20, fontWeight: 700 }}>
                        {recallReportQuery.data.totals.onHandBoxesCount} boxes
                      </div>
                      <small style={{ color: '#64748b' }}>
                        {recallReportQuery.data.totals.totalOnHandQuantity} {recallReportQuery.data.recall.product_unit}
                      </small>
                    </div>

                    <div style={{ background: 'white', padding: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}>
                      <div style={{ color: '#64748b', fontSize: 12 }}>Outbound Dispersion</div>
                      <div style={{ fontSize: 20, fontWeight: 700 }}>
                        {recallReportQuery.data.totals.totalDeliveredQuantity} {recallReportQuery.data.recall.product_unit}
                      </div>
                      <small style={{ color: '#64748b' }}>
                        {recallReportQuery.data.totals.affectedCustomersCount} customer destinations
                      </small>
                    </div>

                    <div style={{ background: 'white', padding: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}>
                      <div style={{ color: '#64748b', fontSize: 12 }}>CSV Protection</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#059669', marginTop: 4 }}>
                        Formula Injection Neutralized
                      </div>
                      <small style={{ color: '#64748b' }}>Apostrophe prefix applied to = + - @</small>
                    </div>
                  </div>

                  {/* Outbound dispersion table */}
                  <h4 style={{ margin: '12px 0 6px 0' }}>Affected Outbound Distribution</h4>
                  {!recallReportQuery.data.outboundDistribution?.length ? (
                    <p style={{ color: '#64748b' }}>No outbound customer shipments recorded for this product.</p>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ background: '#e2e8f0', textAlign: 'left' }}>
                            <th style={{ padding: 8 }}>Customer</th>
                            <th style={{ padding: 8 }}>Destination</th>
                            <th style={{ padding: 8 }}>Order / Shipment</th>
                            <th style={{ padding: 8 }}>Delivered Qty</th>
                            <th style={{ padding: 8 }}>Trip / Date</th>
                            <th style={{ padding: 8 }}>Driver</th>
                          </tr>
                        </thead>
                        <tbody>
                          {recallReportQuery.data.outboundDistribution.map((row: Row, idx: number) => (
                            <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0' }}>
                              <td style={{ padding: 8 }}>
                                <strong>{row.customer_name}</strong> ({row.customer_code})
                              </td>
                              <td style={{ padding: 8 }}>{row.destination_name}</td>
                              <td style={{ padding: 8 }}>
                                {row.order_code} · {row.shipment_status}
                              </td>
                              <td style={{ padding: 8 }}>
                                {row.delivered_quantity || row.shipped_quantity} {row.unit}
                              </td>
                              <td style={{ padding: 8 }}>
                                {row.trip_code || 'Unassigned'} ({String(row.delivery_date || '').slice(0, 10)})
                              </td>
                              <td style={{ padding: 8 }}>{row.driver_name || 'N/A'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </article>
          )}

          {/* Close Recall Modal */}
          {closingRecall && (
            <div
              className="modal-backdrop"
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999,
              }}
            >
              <div className="panel" style={{ background: 'white', maxWidth: 500, width: '90%', padding: 24, borderRadius: 8 }}>
                <h3>Close & Archive Recall</h3>
                <p>
                  Closing recall <strong>{closingRecall.code}</strong> ({closingRecall.title})
                </p>
                <form onSubmit={handleCloseRecall}>
                  <label style={{ display: 'block', marginBottom: 16 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>Closure Audit Notes & Safe Stock Disposition</span>
                    <textarea
                      required
                      rows={3}
                      value={closureNotes}
                      onChange={(e) => setClosureNotes(e.target.value)}
                      placeholder="e.g. All affected customers contacted, remaining inventory incinerated under witness…"
                      style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 4, border: '1px solid #ccd5da' }}
                    />
                  </label>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button type="button" className="btn secondary" onClick={() => setClosingRecall(null)}>
                      Cancel
                    </button>
                    <button type="submit" className="btn primary" disabled={busy || !closureNotes.trim()}>
                      Confirm Recall Closure
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: FORWARD & BACKWARD TRACE INVESTIGATION */}
      {activeTab === 'investigation' && (
        <div className="stack" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className={`btn ${traceType === 'backward' ? 'primary' : 'secondary'}`}
              onClick={() => {
                setTraceType('backward');
                setForwardResult(null);
                setTraceError('');
              }}
            >
              <Package size={16} /> Backward Trace (Customer Box to Inbound Supplier PO)
            </button>
            <button
              type="button"
              className={`btn ${traceType === 'forward' ? 'primary' : 'secondary'}`}
              onClick={() => {
                setTraceType('forward');
                setBackwardResult(null);
                setTraceError('');
              }}
            >
              <Truck size={16} /> Forward Trace (Batch / Lot to Customer Destinations)
            </button>
          </div>

          {traceError && <div className="notice error">{traceError}</div>}

          {/* Backward Trace Form */}
          {traceType === 'backward' && (
            <form onSubmit={runBackwardTrace} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <label style={{ flex: 1 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Box Code or ID</span>
                <input
                  required
                  type="text"
                  placeholder="e.g. B-10023, BOX-01…"
                  value={searchBoxCode}
                  onChange={(e) => setSearchBoxCode(e.target.value)}
                  style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 4, border: '1px solid #ccd5da' }}
                />
              </label>
              <button type="submit" className="btn primary" disabled={traceLoading || !searchBoxCode.trim()}>
                <Search size={16} /> Investigate Inbound Lineage
              </button>
            </form>
          )}

          {/* Forward Trace Form */}
          {traceType === 'forward' && (
            <form onSubmit={runForwardTrace} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'flex-end' }}>
              <label>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Lot / Batch Reference</span>
                <input
                  type="text"
                  placeholder="e.g. LOT-2026-X…"
                  value={searchLotReference}
                  onChange={(e) => setSearchLotReference(e.target.value)}
                  style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 4, border: '1px solid #ccd5da' }}
                />
              </label>
              <label>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Item Serial Number</span>
                <input
                  type="text"
                  placeholder="e.g. SN-99882…"
                  value={searchSerial}
                  onChange={(e) => setSearchSerial(e.target.value)}
                  style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 4, border: '1px solid #ccd5da' }}
                />
              </label>
              <button
                type="submit"
                className="btn primary"
                disabled={traceLoading || (!searchLotReference.trim() && !searchSerial.trim())}
              >
                <Search size={16} /> Investigate Customer Dispersion
              </button>
            </form>
          )}

          {traceLoading && <p>Running lineage query across audit and inventory ledger…</p>}

          {/* Backward Trace Result */}
          {backwardResult && (
            <article className="panel" style={{ background: '#f8fafc', border: '1px solid #cbd5e1', padding: 16, borderRadius: 6 }}>
              <h3>Backward Lineage for Box {backwardResult.box.code}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
                <div>
                  <small style={{ color: '#64748b' }}>Current Condition</small>
                  <div>
                    <span className="badge">{backwardResult.box.condition}</span> ({backwardResult.box.status})
                  </div>
                </div>
                <div>
                  <small style={{ color: '#64748b' }}>Inbound PO Expectation</small>
                  <div>
                    <strong>{backwardResult.inboundExpectation?.expectation_reference || 'Ad-hoc Receipt'}</strong>
                  </div>
                </div>
                <div>
                  <small style={{ color: '#64748b' }}>Supplier</small>
                  <div>
                    <strong>{backwardResult.inboundExpectation?.supplier_name || 'Unrecorded Supplier'}</strong>
                  </div>
                </div>
                <div>
                  <small style={{ color: '#64748b' }}>Arrival Date</small>
                  <div>{String(backwardResult.inboundExpectation?.expected_date || 'N/A').slice(0, 10)}</div>
                </div>
              </div>

              <h4>Contained Products & Lot Details</h4>
              {backwardResult.contents?.map((c: Row, idx: number) => (
                <div key={idx} style={{ background: 'white', padding: 12, borderRadius: 6, border: '1px solid #e2e8f0', marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>
                      {c.product_sku} — {c.product_name}
                    </strong>
                    <span>
                      {c.quantity} {c.unit}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                    Lot Reference: <strong>{c.lot_reference || 'N/A'}</strong> · Manufactured:{' '}
                    {String(c.manufactured_on || 'N/A').slice(0, 10)} · Expires:{' '}
                    {String(c.expires_on || 'N/A').slice(0, 10)}
                  </div>
                  {c.measured_temperature_c !== null && (
                    <div style={{ fontSize: 12, color: '#0369a1', marginTop: 2 }}>
                      Receipt Cold Chain Temp: {c.measured_temperature_c}°C
                    </div>
                  )}
                </div>
              ))}
            </article>
          )}

          {/* Forward Trace Result */}
          {forwardResult && (
            <article className="panel" style={{ background: '#f8fafc', border: '1px solid #cbd5e1', padding: 16, borderRadius: 6 }}>
              <h3>Forward Trace Dispersion Analysis</h3>

              {forwardResult.serial && (
                <div style={{ background: '#e0f2fe', padding: 12, borderRadius: 6, marginBottom: 12 }}>
                  <strong>Serial Number {forwardResult.serial.serial_number}</strong>
                  <div>Status: {forwardResult.serial.status} · Product: {forwardResult.serial.product_sku}</div>
                </div>
              )}

              <h4>On-Hand Inventory Locations ({forwardResult.onHandInventory?.length || 0})</h4>
              {!forwardResult.onHandInventory?.length ? (
                <p style={{ color: '#64748b' }}>No stock on hand in the warehouse.</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, marginBottom: 16 }}>
                  {forwardResult.onHandInventory.map((item: Row, idx: number) => (
                    <div key={idx} style={{ background: 'white', padding: 10, borderRadius: 6, border: '1px solid #e2e8f0' }}>
                      <strong>Box {item.box_code}</strong>
                      <div>Location: {item.location_code || 'Unassigned'}</div>
                      <small style={{ color: '#64748b' }}>
                        Qty: {item.quantity} {item.unit} · Condition: {item.condition}
                      </small>
                    </div>
                  ))}
                </div>
              )}

              <h4>Dispatched Customer Shipments ({forwardResult.outboundShipments?.length || 0})</h4>
              {!forwardResult.outboundShipments?.length ? (
                <p style={{ color: '#64748b' }}>No outbound customer deliveries found.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#e2e8f0', textAlign: 'left' }}>
                        <th style={{ padding: 8 }}>Customer</th>
                        <th style={{ padding: 8 }}>Destination</th>
                        <th style={{ padding: 8 }}>Order</th>
                        <th style={{ padding: 8 }}>Delivered Qty</th>
                        <th style={{ padding: 8 }}>Trip / Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {forwardResult.outboundShipments.map((s: Row, idx: number) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0' }}>
                          <td style={{ padding: 8 }}>
                            <strong>{s.customer_name}</strong>
                          </td>
                          <td style={{ padding: 8 }}>{s.destination_name}</td>
                          <td style={{ padding: 8 }}>{s.order_code}</td>
                          <td style={{ padding: 8 }}>
                            {s.delivered_quantity || s.shipped_quantity} {s.unit}
                          </td>
                          <td style={{ padding: 8 }}>
                            {s.trip_code} ({String(s.delivery_date || '').slice(0, 10)})
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </article>
          )}
        </div>
      )}

      {/* TAB 4: SCOPED OFFLINE SYNC OUTBOX & CONFLICT RESOLUTION */}
      {activeTab === 'outbox' && (
        <div className="stack" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="notice warning">
            <Radio size={18} />
            <span>
              Offline mutations are queued in the scoped sync outbox with stable operation IDs. File uploads precede
              business commands. In-flight conflicts (409) are visible and must be rebased or discarded; they never masquerade as confirmed stock.
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Scoped Outbox Ledger ({outboxItems.length})</h3>
            <button type="button" className="btn secondary" onClick={() => outboxQuery.refetch()}>
              <RefreshCw size={14} /> Refresh Outbox
            </button>
          </div>

          {!outboxItems.length ? (
            <p style={{ color: '#536575' }}>All operations are synchronized with the authoritative server.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {outboxItems.map((item: Row) => (
                <div
                  key={item.id}
                  style={{
                    padding: 12,
                    borderRadius: 6,
                    border: item.status === 'conflict' ? '1px solid #f87171' : '1px solid #e2e8f0',
                    background: item.status === 'conflict' ? '#fef2f2' : item.status === 'syncing' ? '#f0fdf4' : 'white',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        className="badge"
                        style={{
                          background: item.status === 'conflict' ? '#fee2e2' : item.status === 'syncing' ? '#dcfce7' : '#f1f5f9',
                          color: item.status === 'conflict' ? '#991b1b' : item.status === 'syncing' ? '#166534' : '#475569',
                          textTransform: 'uppercase',
                          fontWeight: 700,
                          fontSize: 11,
                        }}
                      >
                        {item.status}
                      </span>
                      <strong>{item.command_name}</strong>
                      <small style={{ color: '#64748b' }}>Entity: {item.target_entity} / {item.target_id || 'new'}</small>
                    </div>
                    {item.conflict_reason && (
                      <div style={{ color: '#b91c1c', fontSize: 13, marginTop: 4 }}>
                        Conflict: {item.conflict_reason}
                      </div>
                    )}
                    <small style={{ color: '#94a3b8' }}>
                      Operation ID: {item.client_operation_id} · Retries: {item.retry_count} / {item.max_retries}
                    </small>
                  </div>
                  <div>
                    {item.status === 'conflict' && (
                      <button type="button" className="btn primary" onClick={() => setConflictItem(item)}>
                        Review & Resolve
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Conflict Resolution Modal */}
          {conflictItem && (
            <div
              className="modal-backdrop"
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999,
              }}
            >
              <div className="panel" style={{ background: 'white', maxWidth: 540, width: '90%', padding: 24, borderRadius: 8 }}>
                <h3>Resolve 409 Version Conflict</h3>
                <p style={{ color: '#b91c1c' }}>
                  <strong>Server Conflict:</strong> {conflictItem.conflict_reason}
                </p>
                <p style={{ fontSize: 13, color: '#536575' }}>
                  This command was drafted offline against an older version of the record. You can rebase the command
                  with the updated version number, retry the exact submission, or discard the offline draft safely.
                </p>

                <div style={{ background: '#f8fafc', padding: 10, borderRadius: 4, marginBottom: 16, fontSize: 12, maxHeight: 150, overflowY: 'auto' }}>
                  <pre style={{ margin: 0 }}>{JSON.stringify(conflictItem.payload, null, 2)}</pre>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>Rebase Expected Version</span>
                    <input
                      type="number"
                      min={1}
                      value={rebaseVersion}
                      onChange={(e) => setRebaseVersion(parseInt(e.target.value) || 1)}
                      style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 4, border: '1px solid #ccd5da' }}
                    />
                  </label>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <button type="button" className="btn secondary" onClick={() => handleResolveConflict('discard')}>
                    Discard Draft
                  </button>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="btn secondary" onClick={() => setConflictItem(null)}>
                      Cancel
                    </button>
                    <button type="button" className="btn secondary" onClick={() => handleResolveConflict('retry')}>
                      Retry As-Is
                    </button>
                    <button type="button" className="btn primary" onClick={() => handleResolveConflict('rebase')}>
                      Rebase & Queue
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
