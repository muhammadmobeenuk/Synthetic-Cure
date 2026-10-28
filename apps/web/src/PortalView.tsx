import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Package,
  ClipboardList,
  Truck,
  Send,
  Webhook,
  FileSpreadsheet,
  CheckCircle,
  AlertCircle,
  Plus,
  RefreshCw,
  ExternalLink,
  Shield,
  Layers,
} from "lucide-react";
import { api, ApiError, newOperation } from "./api";

export function PortalView({ user }: { user: any }) {
  const [activeTab, setActiveTab] = useState<"inventory" | "orders" | "new_order" | "shipments" | "webhooks" | "adapters">("inventory");
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const queryClient = useQueryClient();

  // Order submission form state
  const [destinationId, setDestinationId] = useState("");
  const [customerReference, setCustomerReference] = useState("");
  const [orderNote, setOrderNote] = useState("");
  const [orderLines, setOrderLines] = useState<Array<{ productId: string; quantity: string; unit: string }>>([
    { productId: "", quantity: "1", unit: "case" },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Webhook registration form state
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookDescription, setWebhookDescription] = useState("");
  const [webhookTopics, setWebhookTopics] = useState<string[]>(["order.dispatched", "order.delivered"]);
  const [testingEndpointId, setTestingEndpointId] = useState<string | null>(null);

  // Queries
  const portalContext = useQuery({
    queryKey: ["portal_me", user?.id],
    queryFn: () => api("/portal/me"),
    retry: false,
  });

  const portalInventory = useQuery({
    queryKey: ["portal_inventory", user?.id],
    queryFn: () => api("/portal/inventory"),
    enabled: !!portalContext.data,
  });

  const portalOrders = useQuery({
    queryKey: ["portal_orders", user?.id],
    queryFn: () => api("/portal/orders"),
    enabled: !!portalContext.data?.customerId,
  });

  const portalShipments = useQuery({
    queryKey: ["portal_shipments", user?.id],
    queryFn: () => api("/portal/shipments"),
    enabled: !!portalContext.data?.customerId,
  });

  const webhooksQuery = useQuery({
    queryKey: ["notification_endpoints", user?.id],
    queryFn: () => api("/notifications/endpoints"),
  });

  const deliveriesQuery = useQuery({
    queryKey: ["notification_deliveries", user?.id],
    queryFn: () => api("/notifications/deliveries"),
  });

  const workspaceQuery = useQuery({
    queryKey: ["workspace_minimal", user?.id],
    queryFn: () => api("/workspace?limit=50"),
  });

  const products = workspaceQuery.data?.products || [];
  const destinations = workspaceQuery.data?.destinations || [];
  const trips = workspaceQuery.data?.trips || [];

  const handleLineChange = (index: number, field: string, value: string) => {
    const updated = [...orderLines];
    (updated[index] as any)[field] = value;
    if (field === "productId") {
      const prod = products.find((p: any) => p.id === value);
      if (prod) updated[index].unit = prod.base_unit;
    }
    setOrderLines(updated);
  };

  const handleAddLine = () => {
    setOrderLines([...orderLines, { productId: "", quantity: "1", unit: "case" }]);
  };

  const handleRemoveLine = (index: number) => {
    if (orderLines.length <= 1) return;
    setOrderLines(orderLines.filter((_, i) => i !== index));
  };

  const handleSubmitDraftOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!destinationId) {
      setToast({ type: "error", message: "Please select a delivery destination." });
      return;
    }
    const validLines = orderLines.filter((l) => l.productId && Number(l.quantity) > 0);
    if (validLines.length === 0) {
      setToast({ type: "error", message: "Add at least one product with a valid quantity." });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api("/portal/orders", {
        method: "POST",
        body: JSON.stringify({
          clientOperationId: newOperation(),
          destinationId,
          lines: validLines,
          customerReference: customerReference.trim() || undefined,
          note: orderNote.trim() || undefined,
        }),
      });
      setToast({ type: "success", message: `Draft order ${res.code} submitted for warehouse review!` });
      setDestinationId("");
      setCustomerReference("");
      setOrderNote("");
      setOrderLines([{ productId: "", quantity: "1", unit: "case" }]);
      queryClient.invalidateQueries({ queryKey: ["portal_orders"] });
      setActiveTab("orders");
    } catch (err: any) {
      setToast({ type: "error", message: err.message || "Failed to submit draft order." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegisterWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!webhookUrl) return;
    try {
      await api("/notifications/endpoints", {
        method: "POST",
        body: JSON.stringify({
          clientOperationId: newOperation(),
          url: webhookUrl,
          eventTopics: webhookTopics,
          description: webhookDescription || undefined,
          active: true,
        }),
      });
      setToast({ type: "success", message: "Webhook endpoint registered successfully!" });
      setWebhookUrl("");
      setWebhookDescription("");
      queryClient.invalidateQueries({ queryKey: ["notification_endpoints"] });
    } catch (err: any) {
      setToast({ type: "error", message: err.message || "Failed to register webhook." });
    }
  };

  const handleTestPing = async (endpointId: string) => {
    setTestingEndpointId(endpointId);
    try {
      const res = await api("/notifications/test", {
        method: "POST",
        body: JSON.stringify({
          clientOperationId: newOperation(),
          endpointId,
        }),
      });
      setToast({
        type: "success",
        message: `Webhook test ping delivered (HTTP 200). Signature: ${res.signature.slice(0, 16)}...`,
      });
      queryClient.invalidateQueries({ queryKey: ["notification_deliveries"] });
    } catch (err: any) {
      setToast({ type: "error", message: err.message || "Test ping failed." });
    } finally {
      setTestingEndpointId(null);
    }
  };

  return (
    <div className="portal-container" style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      {/* Toast Notification */}
      {toast && (
        <div
          className={`notice ${toast.type}`}
          style={{
            marginBottom: "16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderRadius: "8px",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {toast.type === "success" ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
            {toast.message}
          </span>
          <button
            className="btn icon-only"
            onClick={() => setToast(null)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "inherit" }}
          >
            ×
          </button>
        </div>
      )}

      {/* Header Banner */}
      <div
        className="card"
        style={{
          padding: "20px 24px",
          marginBottom: "24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "16px",
        }}
      >
        <div>
          <h2 style={{ margin: "0 0 6px 0", fontSize: "1.35rem", display: "flex", alignItems: "center", gap: "10px" }}>
            <Shield size={22} className="text-primary" />
            Client & Stock-Owner Portal
          </h2>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.9rem" }}>
            Authenticated self-service view, verified inventory balances, order drafts, carrier manifests, and webhook integrations.
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {portalContext.data?.customerId && (
            <span className="badge" style={{ background: "#e0f2fe", color: "#0369a1" }}>
              Customer Account Assigned
            </span>
          )}
          {portalContext.data?.stockOwnerId && (
            <span className="badge" style={{ background: "#fef3c7", color: "#92400e" }}>
              3PL Stock Owner Assigned
            </span>
          )}
          {!portalContext.data?.customerId && !portalContext.data?.stockOwnerId && (
            <span className="badge" style={{ background: "#f3f4f6", color: "#4b5563" }}>
              Warehouse Staff View
            </span>
          )}
        </div>
      </div>

      {/* Navigation Tabs */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          borderBottom: "1px solid var(--border)",
          paddingBottom: "12px",
          marginBottom: "24px",
          overflowX: "auto",
        }}
      >
        <button
          className={`btn ${activeTab === "inventory" ? "primary" : "secondary"}`}
          onClick={() => setActiveTab("inventory")}
          style={{ display: "flex", alignItems: "center", gap: "8px" }}
        >
          <Package size={16} /> My Inventory
        </button>
        <button
          className={`btn ${activeTab === "orders" ? "primary" : "secondary"}`}
          onClick={() => setActiveTab("orders")}
          style={{ display: "flex", alignItems: "center", gap: "8px" }}
        >
          <ClipboardList size={16} /> My Orders
        </button>
        <button
          className={`btn ${activeTab === "new_order" ? "primary" : "secondary"}`}
          onClick={() => setActiveTab("new_order")}
          style={{ display: "flex", alignItems: "center", gap: "8px" }}
        >
          <Plus size={16} /> Submit Order Draft
        </button>
        <button
          className={`btn ${activeTab === "shipments" ? "primary" : "secondary"}`}
          onClick={() => setActiveTab("shipments")}
          style={{ display: "flex", alignItems: "center", gap: "8px" }}
        >
          <Truck size={16} /> Track Shipments
        </button>
        <button
          className={`btn ${activeTab === "webhooks" ? "primary" : "secondary"}`}
          onClick={() => setActiveTab("webhooks")}
          style={{ display: "flex", alignItems: "center", gap: "8px" }}
        >
          <Webhook size={16} /> Webhooks & Events
        </button>
        <button
          className={`btn ${activeTab === "adapters" ? "primary" : "secondary"}`}
          onClick={() => setActiveTab("adapters")}
          style={{ display: "flex", alignItems: "center", gap: "8px" }}
        >
          <FileSpreadsheet size={16} /> Carrier & Accounting
        </button>
      </div>

      {/* Tab 1: Inventory */}
      {activeTab === "inventory" && (
        <div className="card" style={{ padding: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h3 style={{ margin: 0, fontSize: "1.1rem" }}>Verified Inventory Balances</h3>
            <button
              className="btn secondary"
              onClick={() => portalInventory.refetch()}
              style={{ display: "flex", alignItems: "center", gap: "6px" }}
            >
              <RefreshCw size={14} /> Refresh
            </button>
          </div>

          {portalInventory.isLoading && <p>Loading authoritative inventory balances...</p>}
          {portalInventory.error && (
            <div className="notice error">
              {(portalInventory.error as ApiError).code === "PORTAL_ACCESS_DENIED"
                ? "This user identity is not yet linked to an external customer or stock-owner account. Contact warehouse administration."
                : "Failed to load inventory balances."}
            </div>
          )}

          {portalInventory.data && (
            <div className="table-responsive">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.95rem" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border)", textAlign: "left" }}>
                    <th style={{ padding: "10px" }}>SKU</th>
                    <th style={{ padding: "10px" }}>Product Name</th>
                    <th style={{ padding: "10px" }}>Base Unit</th>
                    <th style={{ padding: "10px" }}>On-Hand Stock</th>
                    <th style={{ padding: "10px" }}>Physical Units / Boxes</th>
                  </tr>
                </thead>
                <tbody>
                  {(portalInventory.data.balances || []).length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: "24px", textAlign: "center", color: "var(--muted)" }}>
                        No stored inventory found for this account.
                      </td>
                    </tr>
                  ) : (
                    (portalInventory.data.balances || []).map((b: any, idx: number) => (
                      <tr key={idx} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "10px", fontWeight: "bold" }}>{b.sku}</td>
                        <td style={{ padding: "10px" }}>{b.product_name}</td>
                        <td style={{ padding: "10px" }}>{b.base_unit}</td>
                        <td style={{ padding: "10px", color: "var(--primary)", fontWeight: "600" }}>
                          {b.on_hand_quantity || b.on_hand || "0"}
                        </td>
                        <td style={{ padding: "10px" }}>{b.box_count ? `${b.box_count} boxes` : "Loose / Container"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Orders */}
      {activeTab === "orders" && (
        <div className="card" style={{ padding: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h3 style={{ margin: 0, fontSize: "1.1rem" }}>My Order History</h3>
            <button className="btn secondary" onClick={() => portalOrders.refetch()}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>

          {portalOrders.isLoading && <p>Loading customer orders...</p>}
          {portalOrders.error && (
            <div className="notice error">
              {(portalOrders.error as ApiError).message || "Unable to load customer orders."}
            </div>
          )}

          {portalOrders.data && (
            <div className="table-responsive">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.95rem" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border)", textAlign: "left" }}>
                    <th style={{ padding: "10px" }}>Order Code</th>
                    <th style={{ padding: "10px" }}>Destination</th>
                    <th style={{ padding: "10px" }}>Items</th>
                    <th style={{ padding: "10px" }}>Status</th>
                    <th style={{ padding: "10px" }}>Created Date</th>
                  </tr>
                </thead>
                <tbody>
                  {(portalOrders.data || []).length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: "24px", textAlign: "center", color: "var(--muted)" }}>
                        No orders recorded for this customer account yet.
                      </td>
                    </tr>
                  ) : (
                    portalOrders.data.map((o: any) => (
                      <tr key={o.id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "10px", fontWeight: "bold" }}>{o.code}</td>
                        <td style={{ padding: "10px" }}>
                          <div>{o.destination_name}</div>
                          <small style={{ color: "var(--muted)" }}>{o.destination_address}</small>
                        </td>
                        <td style={{ padding: "10px" }}>
                          {(o.lines || []).map((l: any, i: number) => (
                            <div key={i} style={{ fontSize: "0.85rem" }}>
                              {l.product_name}: <strong>{l.quantity} {l.unit}</strong>
                            </div>
                          ))}
                        </td>
                        <td style={{ padding: "10px" }}>
                          <span
                            className="badge"
                            style={{
                              background:
                                o.status === "completed"
                                  ? "#dcfce7"
                                  : o.status === "draft"
                                  ? "#fef9c3"
                                  : o.status === "dispatched"
                                  ? "#e0e7ff"
                                  : "#f3f4f6",
                              color:
                                o.status === "completed"
                                  ? "#15803d"
                                  : o.status === "draft"
                                  ? "#854d0e"
                                  : o.status === "dispatched"
                                  ? "#3730a3"
                                  : "#374151",
                            }}
                          >
                            {o.status.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ padding: "10px", color: "var(--muted)" }}>
                          {new Date(o.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Submit Order Draft */}
      {activeTab === "new_order" && (
        <div className="card" style={{ padding: "24px", maxWidth: "800px" }}>
          <h3 style={{ margin: "0 0 16px 0", fontSize: "1.15rem" }}>Submit Draft Customer Order</h3>
          <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "20px" }}>
            Submit an order draft for warehouse review. This draft will be authorized by warehouse supervisors before preparation.
          </p>

          <form onSubmit={handleSubmitDraftOrder}>
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", marginBottom: "6px", fontWeight: "600" }}>Delivery Destination *</label>
              <select
                className="input"
                style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--border)" }}
                value={destinationId}
                onChange={(e) => setDestinationId(e.target.value)}
                required
              >
                <option value="">-- Select Approved Destination --</option>
                {destinations.map((d: any) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.address || "Standard Address"})
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
              <div>
                <label style={{ display: "block", marginBottom: "6px", fontWeight: "600" }}>Customer PO / Reference</label>
                <input
                  type="text"
                  className="input"
                  style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--border)" }}
                  placeholder="e.g. PO-2026-9921"
                  value={customerReference}
                  onChange={(e) => setCustomerReference(e.target.value)}
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "6px", fontWeight: "600" }}>Special Instructions</label>
                <input
                  type="text"
                  className="input"
                  style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--border)" }}
                  placeholder="e.g. Morning delivery preferred"
                  value={orderNote}
                  onChange={(e) => setOrderNote(e.target.value)}
                />
              </div>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", marginBottom: "8px", fontWeight: "600" }}>Order Products & Quantities</label>
              {orderLines.map((line, idx) => (
                <div key={idx} style={{ display: "flex", gap: "12px", marginBottom: "10px", alignItems: "center" }}>
                  <select
                    className="input"
                    style={{ flex: 3, padding: "10px", borderRadius: "6px", border: "1px solid var(--border)" }}
                    value={line.productId}
                    onChange={(e) => handleLineChange(idx, "productId", e.target.value)}
                    required
                  >
                    <option value="">-- Select Product --</option>
                    {products.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sku})
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    className="input"
                    style={{ flex: 1, padding: "10px", borderRadius: "6px", border: "1px solid var(--border)" }}
                    placeholder="Qty"
                    value={line.quantity}
                    onChange={(e) => handleLineChange(idx, "quantity", e.target.value)}
                    required
                  />
                  <input
                    type="text"
                    disabled
                    className="input"
                    style={{ flex: 1, padding: "10px", borderRadius: "6px", border: "1px solid var(--border)", background: "#f9fafb" }}
                    value={line.unit}
                  />
                  {orderLines.length > 1 && (
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => handleRemoveLine(idx)}
                      style={{ padding: "8px 12px", color: "var(--danger)" }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                className="btn secondary"
                onClick={handleAddLine}
                style={{ marginTop: "6px", fontSize: "0.85rem" }}
              >
                + Add Another Product
              </button>
            </div>

            <button type="submit" className="btn primary" disabled={isSubmitting} style={{ width: "100%", padding: "12px" }}>
              {isSubmitting ? "Submitting Draft..." : "Submit Draft Order for Review"}
            </button>
          </form>
        </div>
      )}

      {/* Tab 4: Track Shipments */}
      {activeTab === "shipments" && (
        <div className="card" style={{ padding: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h3 style={{ margin: 0, fontSize: "1.1rem" }}>Shipment & Delivery Tracking</h3>
            <button className="btn secondary" onClick={() => portalShipments.refetch()}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>

          {portalShipments.isLoading && <p>Loading shipments...</p>}
          {portalShipments.error && (
            <div className="notice error">
              {(portalShipments.error as ApiError).message || "Unable to load shipments."}
            </div>
          )}

          {portalShipments.data && (
            <div className="table-responsive">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.95rem" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border)", textAlign: "left" }}>
                    <th style={{ padding: "10px" }}>Shipment Ref</th>
                    <th style={{ padding: "10px" }}>Order Code</th>
                    <th style={{ padding: "10px" }}>Destination</th>
                    <th style={{ padding: "10px" }}>Trip Schedule</th>
                    <th style={{ padding: "10px" }}>Status</th>
                    <th style={{ padding: "10px" }}>Delivery Note</th>
                  </tr>
                </thead>
                <tbody>
                  {(portalShipments.data || []).length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: "24px", textAlign: "center", color: "var(--muted)" }}>
                        No outbound shipments found for this customer account.
                      </td>
                    </tr>
                  ) : (
                    portalShipments.data.map((s: any) => (
                      <tr key={s.id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "10px", fontWeight: "bold" }}>{s.id.slice(0, 8)}</td>
                        <td style={{ padding: "10px" }}>{s.order_code}</td>
                        <td style={{ padding: "10px" }}>
                          <div>{s.destination_name}</div>
                          <small style={{ color: "var(--muted)" }}>{s.destination_address}</small>
                        </td>
                        <td style={{ padding: "10px" }}>
                          {s.trip_date ? `${s.trip_date} (${s.trip_vehicle || "Van"})` : "Unscheduled"}
                        </td>
                        <td style={{ padding: "10px" }}>
                          <span className="badge">{s.status.toUpperCase()}</span>
                        </td>
                        <td style={{ padding: "10px" }}>
                          <a
                            href={`/api/v1/documents/customer-delivery-note/${s.order_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="btn secondary"
                            style={{ fontSize: "0.85rem", padding: "4px 8px", textDecoration: "none" }}
                          >
                            <ExternalLink size={12} /> View Note
                          </a>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 5: Webhooks & Notifications */}
      {activeTab === "webhooks" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
          <div className="card" style={{ padding: "20px" }}>
            <h3 style={{ margin: "0 0 16px 0", fontSize: "1.1rem" }}>Register Webhook Endpoint</h3>
            <form onSubmit={handleRegisterWebhook}>
              <div style={{ marginBottom: "14px" }}>
                <label style={{ display: "block", marginBottom: "6px", fontWeight: "600" }}>Payload URL *</label>
                <input
                  type="url"
                  required
                  className="input"
                  style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--border)" }}
                  placeholder="https://api.myclient.com/webhooks/warehouse"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                />
              </div>

              <div style={{ marginBottom: "14px" }}>
                <label style={{ display: "block", marginBottom: "6px", fontWeight: "600" }}>Description</label>
                <input
                  type="text"
                  className="input"
                  style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--border)" }}
                  placeholder="e.g. ERP Ingestion Webhook"
                  value={webhookDescription}
                  onChange={(e) => setWebhookDescription(e.target.value)}
                />
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", marginBottom: "8px", fontWeight: "600" }}>Subscribed Topics</label>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "0.9rem" }}>
                  {[
                    "order.created",
                    "order.dispatched",
                    "order.delivered",
                    "inbound.received",
                    "quality_hold.placed",
                    "recall.initiated",
                  ].map((topic) => (
                    <label key={topic} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <input
                        type="checkbox"
                        checked={webhookTopics.includes(topic)}
                        onChange={(e) => {
                          if (e.target.checked) setWebhookTopics([...webhookTopics, topic]);
                          else setWebhookTopics(webhookTopics.filter((t) => t !== topic));
                        }}
                      />
                      <code>{topic}</code>
                    </label>
                  ))}
                </div>
              </div>

              <button type="submit" className="btn primary" style={{ width: "100%" }}>
                Register Webhook
              </button>
            </form>
          </div>

          <div className="card" style={{ padding: "20px" }}>
            <h3 style={{ margin: "0 0 16px 0", fontSize: "1.1rem" }}>Configured Endpoints</h3>
            {(webhooksQuery.data || []).length === 0 ? (
              <p style={{ color: "var(--muted)" }}>No webhook endpoints registered yet.</p>
            ) : (
              (webhooksQuery.data || []).map((ep: any) => (
                <div
                  key={ep.id}
                  style={{
                    padding: "12px",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    marginBottom: "12px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                    <strong style={{ wordBreak: "break-all" }}>{ep.url}</strong>
                    <span className="badge" style={{ background: ep.active ? "#dcfce7" : "#fee2e2" }}>
                      {ep.active ? "ACTIVE" : "INACTIVE"}
                    </span>
                  </div>
                  {ep.description && <p style={{ margin: "0 0 6px 0", fontSize: "0.85rem", color: "var(--muted)" }}>{ep.description}</p>}
                  <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "8px" }}>
                    Topics: {(ep.eventTopics || []).join(", ")}
                  </div>
                  <button
                    className="btn secondary"
                    disabled={testingEndpointId === ep.id}
                    onClick={() => handleTestPing(ep.id)}
                    style={{ fontSize: "0.85rem", padding: "4px 10px" }}
                  >
                    {testingEndpointId === ep.id ? "Pinging..." : "Send Test Ping"}
                  </button>
                </div>
              ))
            )}

            <h4 style={{ margin: "20px 0 10px 0", fontSize: "1rem" }}>Recent Dispatch Deliveries</h4>
            {(deliveriesQuery.data || []).length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>No event deliveries logged yet.</p>
            ) : (
              <div style={{ maxHeight: "250px", overflowY: "auto" }}>
                {(deliveriesQuery.data || []).slice(0, 10).map((d: any) => (
                  <div
                    key={d.id}
                    style={{
                      padding: "8px 10px",
                      borderBottom: "1px solid var(--border)",
                      fontSize: "0.85rem",
                      display: "flex",
                      justifyContent: "space-between",
                    }}
                  >
                    <div>
                      <code>{d.event_topic}</code>
                      <div style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
                        {new Date(d.created_at).toLocaleTimeString()} · Status: {d.status_code || d.status}
                      </div>
                    </div>
                    <span className="badge">{d.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 6: Carrier & Accounting */}
      {activeTab === "adapters" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
          {/* Carrier Adapter */}
          <div className="card" style={{ padding: "20px" }}>
            <h3 style={{ margin: "0 0 12px 0", fontSize: "1.1rem" }}>Carrier Manifest Adapter</h3>
            <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "16px" }}>
              Book standardized carrier manifests for delivery trips and export manifest CSVs with formula injection neutralization.
            </p>

            {(trips || []).length === 0 ? (
              <p style={{ color: "var(--muted)" }}>No delivery trips scheduled yet.</p>
            ) : (
              (trips || []).map((t: any) => (
                <div
                  key={t.id}
                  style={{
                    padding: "12px",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    marginBottom: "12px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <strong>Trip {t.business_date}</strong>
                    <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                      Vehicle: {t.vehicle || "Standard Van"} · Driver: {t.driver_name || "Unassigned"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <a
                      href={`/api/v1/adapters/carrier/manifest/${t.id}/csv`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn secondary"
                      style={{ fontSize: "0.85rem", padding: "6px 12px", textDecoration: "none" }}
                    >
                      Export CSV
                    </a>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Accounting Export Adapter */}
          <div className="card" style={{ padding: "20px" }}>
            <h3 style={{ margin: "0 0 12px 0", fontSize: "1.1rem" }}>Accounting Ledger Export Adapter</h3>
            <div
              className="notice"
              style={{
                background: "#fef3c7",
                color: "#92400e",
                padding: "10px 14px",
                borderRadius: "6px",
                fontSize: "0.85rem",
                marginBottom: "16px",
              }}
            >
              PHYSICAL QUANTITIES ONLY · COMMERCIAL PRICING UNCONFIRMED
            </div>
            <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "16px" }}>
              Export delivered orders, itemized physical quantities, units, and customer accounts for general ERP and bookkeeping systems.
            </p>

            <a
              href="/api/v1/adapters/accounting/export/csv?status=delivered"
              target="_blank"
              rel="noreferrer"
              className="btn primary"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px 16px",
                textDecoration: "none",
              }}
            >
              <FileSpreadsheet size={16} /> Download Delivered Accounting CSV
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
