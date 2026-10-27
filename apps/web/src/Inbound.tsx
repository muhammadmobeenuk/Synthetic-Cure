import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, newOperation, saveDraft, getDraft, deleteDraft } from "./api";
import { draftScope, type Identity } from "./draft-scope";
import { registerPendingCapture } from "./work-preservation";
import { SmartCombobox, SmartQuantityInput } from "./SmartInputs";
import { Sparkles, PackageCheck, AlertCircle } from "lucide-react";

type Row = Record<string, any>;
type Pending = { url: string; payload: Record<string, any> };

export function Inbound({
  actor,
  products,
  locations,
  canConfigure,
  canAdjust,
  onSaved,
}: {
  actor: Identity;
  products: Row[];
  locations: Row[];
  canConfigure: boolean;
  canAdjust: boolean;
  onSaved: () => Promise<void>;
}) {
  const scope = draftScope(actor),
    q = useQuery({
      queryKey: ["inbound", scope],
      queryFn: () => api("/inbound"),
      retry: false,
    });

  const [supplier, setSupplier] = useState(""),
    [code, setCode] = useState(""),
    [name, setName] = useState(""),
    [product, setProduct] = useState(""),
    [reference, setReference] = useState(""),
    [date, setDate] = useState(""),
    [quantity, setQuantity] = useState(""),
    [expected, setExpected] = useState(""),
    [location, setLocation] = useState(""),
    [received, setReceived] = useState(""),
    [condition, setCondition] = useState(""),
    [sourceLabel, setSourceLabel] = useState(""),
    [cancelReason, setCancelReason] = useState(""),
    [pending, setPending] = useState<Pending | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [rejected, setRejected] = useState(false);

  const key = "inbound-form";
  const save = () =>
    saveDraft(scope, key, {
      supplier,
      code,
      name,
      product,
      reference,
      date,
      quantity,
      expected,
      location,
      received,
      condition,
      sourceLabel,
      cancelReason,
      pending,
      _ownerUserId: actor.id,
    });

  useEffect(
    () =>
      registerPendingCapture(async () => {
        if (
          supplier ||
          code ||
          name ||
          product ||
          reference ||
          date ||
          quantity ||
          expected ||
          location ||
          received ||
          condition ||
          sourceLabel ||
          cancelReason ||
          pending
        )
          await save();
      }),
    [
      scope,
      supplier,
      code,
      name,
      product,
      reference,
      date,
      quantity,
      expected,
      location,
      received,
      condition,
      sourceLabel,
      cancelReason,
      pending,
    ]
  );

  async function send(command: Pending) {
    setBusy(true);
    setError("");
    setNotice("");
    setRejected(false);
    setPending(command);
    try {
      await saveDraft(scope, key, {
        supplier,
        code,
        name,
        product,
        reference,
        date,
        quantity,
        expected,
        location,
        received,
        condition,
        sourceLabel,
        cancelReason,
        pending: command,
        _ownerUserId: actor.id,
      });
      await api(command.url, command.payload);
      setPending(null);
      await deleteDraft(scope, key).catch(() => {});
      setNotice("Saved · server confirmed. Refresh the list before the next receipt.");
      if (command.url === "/suppliers") {
        setCode("");
        setName("");
      } else if (command.url === "/expected-receipts") {
        setReference("");
        setDate("");
        setQuantity("");
      } else if (command.url.endsWith("/cancel")) {
        setCancelReason("");
      } else {
        setReceived("");
        setSourceLabel("");
        // Keep location for subsequent box receipts
      }
      await q.refetch();
      await onSaved().catch(() => {});
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) setRejected(true);
    } finally {
      setBusy(false);
    }
  }

  const execute = (url: string, payload: Record<string, any>) =>
    void send({ url, payload: { ...payload, clientOperationId: newOperation() } });

  const selected = q.data?.expectations.find((x: Row) => x.id === expected);
  const selectedProduct = products.find((p) => p.id === product);
  const unit = selectedProduct?.unit;

  // Options for comboboxes
  const supplierOptions = (q.data?.suppliers || []).map((s: Row) => ({
    value: s.id,
    label: `${s.code} · ${s.name}`,
  }));

  const productOptions = products.map((p) => ({
    value: p.id,
    label: `${p.sku} · ${p.name}`,
    sublabel: p.name_zh ? `Chinese: ${p.name_zh} · Unit: ${p.unit}` : `Unit: ${p.unit}`,
    badge: p.profile,
  }));

  const locationOptions = locations.map((l) => ({
    value: l.id,
    label: `${l.code} · ${l.name}`,
    badge: l.kind,
  }));

  return (
    <section className="panel entity-card product-import" aria-label="Expected inbound">
      <div className="section-head">
        <div>
          <h2>Expected inbound</h2>
          <p>Plan an arrival, then receive each physical box.</p>
        </div>
      </div>
      <p>
        One product per expected receipt. No stock is created until a box is received. Over-deliveries
        require separate review; do not record them against this expectation.
      </p>

      <div className="setup-actions">
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={async () => {
            try {
              await save();
              setNotice("Saved on this device · not server confirmed");
            } catch {
              setError("Device storage failed. Keep this screen open.");
            }
          }}
        >
          Save device draft
        </button>
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={async () => {
            try {
              const d = await getDraft(scope, key);
              if (!d) {
                setNotice("No saved inbound draft in this workspace.");
                return;
              }
              setSupplier(d.supplier || "");
              setCode(d.code || "");
              setName(d.name || "");
              setProduct(d.product || "");
              setReference(d.reference || "");
              setDate(d.date || "");
              setQuantity(d.quantity || "");
              setExpected(d.expected || "");
              setLocation(d.location || "");
              setReceived(d.received || "");
              setCondition(d.condition || "");
              setSourceLabel(d.sourceLabel || "");
              setCancelReason(d.cancelReason || "");
              setPending(d.pending || null);
              setNotice("Device draft restored.");
            } catch {
              setError("Could not restore the device draft.");
            }
          }}
        >
          Restore device draft
        </button>
      </div>

      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice success" role="status">
          {notice}
        </p>
      )}
      {pending && (
        <div className="notice warning">
          <p>
            Submission retained on this device. Its outcome may be unconfirmed. Retry the exact request
            before changing it.
          </p>
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={() => void send(pending)}
          >
            Retry exact submission
          </button>
          {rejected && (
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={() => {
                setPending(null);
                setRejected(false);
                setNotice(
                  "Request rejected by server. Review fields and current records before submitting again."
                );
              }}
            >
              Review and correct rejected request
            </button>
          )}
        </div>
      )}

      {q.isPending ? (
        <p>Loading inbound records…</p>
      ) : q.error ? (
        <div role="alert">
          <p>Inbound records could not be loaded.</p>
          <button className="btn secondary" onClick={() => void q.refetch()}>
            Retry
          </button>
        </div>
      ) : (
        <>
          {canConfigure && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                execute("/suppliers", { code, name });
              }}
            >
              <fieldset disabled={busy || !!pending}>
                <legend>Add a supplier</legend>
                <div className="import-mapping">
                  <label className="field">
                    <span>Supplier code</span>
                    <input
                      required
                      maxLength={120}
                      placeholder="e.g. SUP-001"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Supplier name</span>
                    <input
                      required
                      maxLength={200}
                      placeholder="e.g. Pacific Produce Wholesale"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                </div>
                <button className="btn secondary" style={{ marginTop: "10px" }}>
                  Save supplier
                </button>
              </fieldset>
            </form>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              execute("/expected-receipts", {
                supplierId: supplier,
                productId: product,
                reference,
                expectedDate: date,
                quantity,
                unit,
              });
            }}
          >
            <fieldset disabled={busy || !!pending}>
              <legend>Plan an expected receipt</legend>
              <div className="import-mapping">
                <SmartCombobox
                  label="Supplier"
                  placeholder="Select or search supplier…"
                  value={supplier}
                  required
                  options={supplierOptions}
                  onChange={(val) => setSupplier(val)}
                />

                <SmartCombobox
                  label="Product"
                  placeholder="Search product by SKU or name…"
                  value={product}
                  required
                  options={productOptions}
                  onChange={(val) => setProduct(val)}
                />

                <label className="field">
                  <span>Supplier PO / Reference</span>
                  <input
                    required
                    maxLength={200}
                    placeholder="e.g. PO-88392"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </label>

                <label className="field">
                  <span>Expected arrival date</span>
                  <input
                    required
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>

                <SmartQuantityInput
                  label="Expected quantity"
                  unit={unit || "select product first"}
                  placeholder="0.00"
                  value={quantity}
                  required
                  hint="Quantity in base unit."
                  onChange={(val) => setQuantity(val)}
                />
              </div>
              <button className="btn primary" style={{ marginTop: "12px" }}>
                Save expected receipt
              </button>
            </fieldset>
          </form>

          <h3>Expected receipts · latest {q.data.limit}</h3>
          <p>
            Accepted, held and pending describe their condition at receipt, not their current
            disposition.
          </p>
          {!q.data.expectations.length && <p>No expected receipts in this warehouse.</p>}
          {q.data.expectations.map((x: Row) => (
            <div className="import-row" key={x.id}>
              <div>
                <strong>
                  {x.reference} · {x.supplier_name}
                </strong>
                <span>
                  {x.sku} · {x.product_name}
                  {x.name_zh ? " · " + x.name_zh : ""}
                </span>
                <span>Expected arrival · {String(x.expected_date).slice(0, 10)}</span>
              </div>
              <div>
                <span>
                  Expected {x.quantity} {x.unit} · Received {x.received} {x.unit}
                </span>
                <span>
                  Accepted {x.accepted} · Held {x.held} · Pending {x.pending} {x.unit}
                </span>
                <strong>
                  {x.cancelled
                    ? `Canceled outstanding ${x.cancelled_quantity} ${x.unit}`
                    : `Outstanding ${x.outstanding} ${x.unit}`}
                </strong>
                {x.cancelled && <span>Cancellation reason · {x.cancellation_reason}</span>}
                <button
                  type="button"
                  className="btn secondary"
                  disabled={busy || !!pending}
                  onClick={() => {
                    setExpected(x.id);
                    // Pre-fill received box quantity with outstanding amount if empty
                    if (!received || received === "0") {
                      setReceived(x.outstanding);
                    }
                  }}
                >
                  Choose receipt
                </button>
              </div>
            </div>
          ))}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (selected)
                execute("/expected-receipts/" + selected.id + "/receive", {
                  expectedVersion: selected.version,
                  locationId: location,
                  quantity: received,
                  condition,
                  sourceLabel,
                });
            }}
          >
            <fieldset
              disabled={
                busy ||
                !!pending ||
                !selected ||
                selected.cancelled ||
                selected.outstanding === "0"
              }
            >
              <legend>Receive one physical box</legend>
              <p>
                {selected
                  ? `${selected.reference} · ${selected.product_name} · Outstanding: ${selected.outstanding} ${selected.unit}`
                  : "Choose an expected receipt above to receive."}
              </p>

              <div className="import-mapping">
                <SmartQuantityInput
                  label="Quantity in this box"
                  unit={selected?.unit || "select receipt"}
                  value={received}
                  required
                  placeholder="0.00"
                  max={selected?.outstanding}
                  onMaxClick={
                    selected?.outstanding
                      ? () => setReceived(selected.outstanding)
                      : undefined
                  }
                  maxLabel={
                    selected?.outstanding
                      ? `Fill Outstanding (${selected.outstanding} ${selected.unit})`
                      : undefined
                  }
                  onChange={(val) => setReceived(val)}
                  hint={
                    selected
                      ? `Max outstanding: ${selected.outstanding} ${selected.unit}`
                      : undefined
                  }
                />

                <label className="field">
                  <span>Physical condition</span>
                  <select
                    required
                    value={condition}
                    onChange={(e) => setCondition(e.target.value)}
                  >
                    <option value="">Choose condition</option>
                    <option value="good">Good · Release into active stock</option>
                    <option value="damaged">Damaged · Hold automatically</option>
                    <option value="hold">Hold for quality review</option>
                  </select>
                </label>

                <SmartCombobox
                  label="Placed at location"
                  placeholder="Search location bay/rack…"
                  value={location}
                  required
                  options={locationOptions}
                  hint="Remembered for subsequent box receipts in this batch."
                  onChange={(val) => setLocation(val)}
                />

                <label className="field">
                  <span>Source label / barcode (optional)</span>
                  <input
                    maxLength={2000}
                    placeholder="Scan or enter external carton label…"
                    value={sourceLabel}
                    onChange={(e) => setSourceLabel(e.target.value)}
                  />
                </label>
              </div>

              <button className="btn primary" style={{ marginTop: "12px" }}>
                Receive box
              </button>
            </fieldset>
          </form>

          {canAdjust && selected && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                execute("/expected-receipts/" + selected.id + "/cancel", {
                  expectedVersion: selected.version,
                  reason: cancelReason,
                });
              }}
            >
              <fieldset
                disabled={
                  busy ||
                  !!pending ||
                  selected.cancelled ||
                  selected.outstanding === "0"
                }
              >
                <legend>Cancel outstanding expected quantity</legend>
                <p>
                  Cancel {selected.outstanding} {selected.unit} for {selected.reference}. Boxes already
                  received stay in stock or on hold.
                </p>
                <label className="field">
                  <span>Reason for cancellation</span>
                  <input
                    required
                    minLength={3}
                    maxLength={1000}
                    placeholder="Reason required for audit history…"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                  />
                </label>
                <button className="btn secondary" style={{ marginTop: "8px" }}>
                  Cancel outstanding quantity
                </button>
              </fieldset>
            </form>
          )}
        </>
      )}
    </section>
  );
}
