import { useEffect, useState } from "react";
import { api, newOperation, saveDraft, getDraft, deleteDraft, ApiError } from "./api";
import { draftScope, type Identity } from "./draft-scope";
import { registerPendingCapture } from "./work-preservation";
import { SmartCombobox, SmartQuantityInput } from "./SmartInputs";
import { Plus, Trash2, CheckCircle2 } from "lucide-react";

type RecordRow = Record<string, any>;
type Line = { productId: string; quantity: string };

export function CustomerOrderForm({
  actor,
  customers,
  destinations,
  products,
  availableStock,
  onSaved,
  onClose,
}: {
  actor: Identity;
  customers: RecordRow[];
  destinations: RecordRow[];
  products: RecordRow[];
  availableStock?: Record<string, string>;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const scope = draftScope(actor);
  const [customerId, setCustomer] = useState("");
  const [destinationId, setDestination] = useState("");
  const [lines, setLines] = useState<Line[]>([{ productId: "", quantity: "" }]);
  const [operation, setOperation] = useState(newOperation);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const draft = () => ({
    customerId,
    destinationId,
    lines,
    operation,
    locked,
    _ownerUserId: actor.id,
  });

  const persist = async () => {
    if (customerId || destinationId || lines.some((l) => l.productId || l.quantity)) {
      await saveDraft(scope, "customer-order", draft());
    }
  };

  useEffect(
    () => registerPendingCapture(persist),
    [scope, customerId, destinationId, lines, operation, locked]
  );

  function update(i: number, key: keyof Line, value: string) {
    setLines(lines.map((l, n) => (n === i ? { ...l, [key]: value } : l)));
  }

  const quantityInvalid = (value: string) =>
    !/^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/.test(value) || Number(value) <= 0;

  const invalid = lines.some((l) => !l.productId || quantityInvalid(l.quantity));
  const duplicate = lines.some(
    (l, i) => l.productId && lines.findIndex((x) => x.productId === l.productId) !== i
  );

  // Filter or group destinations based on selected customer
  const customerDestinations = customerId
    ? destinations.filter((d) => d.customer_id === customerId)
    : [];

  // When customer changes, if they have exactly 1 direct destination and none is selected, auto-select it
  useEffect(() => {
    if (customerId && customerDestinations.length === 1 && !destinationId) {
      setDestination(customerDestinations[0].id);
    }
  }, [customerId, customerDestinations.length, destinationId]);

  // Destination options with smart labeling and badges
  const destinationOptions = destinations.map((d) => {
    const isDirect = customerId && d.customer_id === customerId;
    return {
      value: d.id,
      label: d.name,
      sublabel: d.address || "Address unconfirmed",
      badge: d.verified ? (isDirect ? "Primary Branch" : "Verified") : "Unconfirmed",
    };
  });

  // Customer options with bilingual names
  const customerOptions = customers.map((c) => ({
    value: c.id,
    label: `${c.code} · ${c.name}`,
    sublabel: c.name_zh ? `Chinese: ${c.name_zh}` : undefined,
  }));

  // Product options
  const productOptions = products.map((p) => {
    const stock = availableStock ? availableStock[p.id] : undefined;
    return {
      value: p.id,
      label: `${p.sku} · ${p.name}`,
      sublabel: `${p.name_zh ? p.name_zh + " · " : ""}Base unit: ${p.unit}${
        stock !== undefined ? ` · In Stock: ${stock} ${p.unit}` : ""
      }`,
      badge:
        stock !== undefined
          ? Number(stock) > 0
            ? `${stock} ${p.unit} in stock`
            : "Out of stock"
          : p.profile,
    };
  });

  async function submit() {
    setError("");
    setSuccess("");
    setBusy(true);
    const payload = {
      clientOperationId: operation,
      customerId,
      destinationId,
      lines: lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        unit: products.find((p) => p.id === l.productId)?.unit,
      })),
    };

    try {
      setLocked(true);
      await saveDraft(scope, "customer-order", { ...draft(), locked: true });
      const result = await api("/orders", payload);
      await deleteDraft(scope, "customer-order").catch(() => {});
      setSuccess("Order " + result.code + " created · server confirmed");
      setCustomer("");
      setDestination("");
      setLines([{ productId: "", quantity: "" }]);
      setOperation(newOperation());
      setLocked(false);
      try {
        await onSaved();
      } catch {
        setSuccess("Order " + result.code + " created. Reload the order list to see it.");
      }
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 409) {
        setLocked(false);
        setOperation(newOperation());
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel entity-card product-import" aria-label="Customer order form">
      <div className="section-head">
        <div>
          <h2>Customer order form</h2>
          <p>Requested goods · destination and delivery planning remain separate</p>
        </div>
        <button
          className="btn secondary"
          disabled={busy}
          onClick={async () => {
            try {
              await persist();
              onClose();
            } catch {
              setError("Device storage failed. Keep this form open.");
            }
          }}
        >
          Close form
        </button>
      </div>

      <p>
        Enter verified product and quantity information. Prices and package conversions are not
        assumed. Create a dated preparation batch separately.
      </p>

      <div className="setup-actions">
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={async () => {
            try {
              await persist();
              setSuccess("Draft saved on this device · not confirmed by server");
            } catch {
              setError("Device storage failed. Keep this form open.");
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
              const d = await getDraft(scope, "customer-order");
              if (!d) {
                setError("No saved order draft in this workspace");
                return;
              }
              setCustomer(d.customerId);
              setDestination(d.destinationId);
              setLines(d.lines);
              setOperation(d.operation);
              setLocked(!!d.locked);
              setError("");
              setSuccess("Device draft restored.");
            } catch {
              setError("Could not restore the device draft.");
            }
          }}
        >
          Restore device draft
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={busy || locked}>
          <legend>Order details</legend>

          <div className="import-mapping">
            <SmartCombobox
              label="Ordering customer"
              placeholder="Search by code or customer name…"
              value={customerId}
              required
              options={customerOptions}
              onChange={(val) => {
                setCustomer(val);
                if (destinationId) {
                  setSuccess(
                    "Customer changed. Verify that the selected destination is authorised for this customer."
                  );
                }
              }}
            />

            <SmartCombobox
              label="Receiving destination / branch"
              placeholder="Search branch name or address…"
              value={destinationId}
              required
              options={destinationOptions}
              hint={
                customerId && customerDestinations.length > 0
                  ? `${customerDestinations.length} direct branch(es) registered for this customer.`
                  : "Where the receiver differs from the customer, authorization is verified."
              }
              onChange={(val) => setDestination(val)}
            />
          </div>

          <div className="order-items-section">
            <div className="section-head" style={{ marginTop: "14px", marginBottom: "10px" }}>
              <h3>Requested products ({lines.length})</h3>
              <small className="muted">Each line supports instant SKU search and unit steppers.</small>
            </div>

            {lines.map((line, i) => {
              const product = products.find((p) => p.id === line.productId);
              return (
                <div
                  className="import-row"
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.4fr 1.2fr auto",
                    gap: "14px",
                    alignItems: "start",
                    background: "#f9fbfc",
                    border: "1px solid #e1e9ed",
                    borderRadius: "8px",
                    padding: "16px",
                    marginBottom: "12px",
                  }}
                >
                  <div>
                    <SmartCombobox
                      label={`Product · line ${i + 1}`}
                      placeholder="Search SKU or product name…"
                      value={line.productId}
                      required
                      options={productOptions}
                      onChange={(val) => update(i, "productId", val)}
                    />
                    {product && availableStock && (
                      <div style={{ marginTop: "4px", fontSize: "11px" }}>
                        {Number(availableStock[product.id] || 0) > 0 ? (
                          <span style={{ color: "#087a55", fontWeight: 600 }}>
                            ✓ {availableStock[product.id]} {product.unit} available in warehouse
                          </span>
                        ) : (
                          <span style={{ color: "#d97706", fontWeight: 600 }}>
                            ⚠ 0 {product.unit} unallocated (inbound / receipt needed)
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <SmartQuantityInput
                    label={`Requested quantity`}
                    unit={product?.unit || undefined}
                    placeholder="e.g. 10.00"
                    value={line.quantity}
                    required
                    hint="Positive decimal, up to 6 decimal places."
                    onChange={(val) => update(i, "quantity", val)}
                  />

                  {lines.length > 1 && (
                    <button
                      type="button"
                      className="btn secondary"
                      style={{ marginTop: "28px", minHeight: "44px" }}
                      title={`Remove line ${i + 1}`}
                      aria-label={`Remove line ${i + 1}`}
                      onClick={() => setLines(lines.filter((_, n) => n !== i))}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              );
            })}

            <button
              type="button"
              className="btn secondary"
              style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
              disabled={lines.length >= 100}
              onClick={() => setLines([...lines, { productId: "", quantity: "" }])}
            >
              <Plus size={16} /> Add another product line
            </button>
          </div>
        </fieldset>

        {duplicate && (
          <p className="notice error" role="alert">
            Each product can appear only once. Combine quantities for the same product.
          </p>
        )}
        {locked && (
          <p className="notice warning">
            The result is uncertain. Retry this exact submission to check safely; the server will
            not create another order for the same operation.
          </p>
        )}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {success && (
          <p className="notice success" role="status">
            {success}
          </p>
        )}

        <div style={{ marginTop: "20px" }}>
          <button className="btn primary" disabled={busy || duplicate || (!locked && invalid)}>
            {busy ? "Sending…" : locked ? "Retry exact submission" : "Create customer order"}
          </button>
        </div>
      </form>
    </section>
  );
}
