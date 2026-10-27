import React, { useState, useRef, type ReactNode } from "react";
import {
  Search,
  ChevronRight,
  Check,
  CheckCircle2,
  Camera,
  Package,
  Box,
  Boxes,
  Layers,
  MapPin,
  AlertTriangle,
  FileText,
  ClipboardList,
  Plus,
  X,
  MoveRight,
  MoreHorizontal,
  Printer,
  Download,
  List,
  Pencil,
  CircleHelp,
  ShieldCheck,
  Truck,
  RotateCcw,
  Clock,
  Calendar,
  CalendarDays,
  Users,
  User,
  ExternalLink,
  Filter,
  ArrowUpDown,
  Crosshair,
  SlidersHorizontal,
} from "lucide-react";

export function SyntheticCureLogo({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      <path d="M16 2L29 9.5L16 17L3 9.5L16 2Z" fill="#10b981" />
      <path d="M3 9.5L16 17V30L3 22.5V9.5Z" fill="#047857" />
      <path d="M29 9.5L16 17V30L29 22.5V9.5Z" fill="#059669" />
      <path
        d="M16 7.5L22.5 11.25L16 15L9.5 11.25L16 7.5Z"
        fill="#facc15"
        fillOpacity="0.9"
      />
      <path
        d="M16 15V24"
        stroke="#facc15"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ----------------------------------------------------------------------
// PANEL 1: TODAY (Overview Dashboard)
// ----------------------------------------------------------------------

interface TodayDashboardProps {
  data: Record<string, any>;
  rows: (key: string) => Record<string, any>[];
  go: (p: string) => Promise<void>;
  setDetail: (id: string | null) => void;
  search: string;
  setSearch: (s: string) => void;
}

export function ScTodayDashboard({
  data,
  rows,
  go,
  setDetail,
  search,
  setSearch,
}: TodayDashboardProps) {
  const [activeTab, setActiveTab] = useState<
    "orders" | "review" | "waiting" | "ready"
  >("orders");
  const [selectedOrderIds, setSelectedOrderIds] = useState<
    Record<string, boolean>
  >({});

  // Seeded / default orders matching the screenshot exactly
  const defaultScreenshotOrders = [
    {
      id: "sc-1042",
      code: "SC-1042",
      customer: "Helix Health",
      destination: "Manchester DC",
      itemsReady: 18,
      itemsTotal: 24,
      progress: 75,
      status: "in_prep",
      statusLabel: "In preparation",
    },
    {
      id: "sc-1044",
      code: "SC-1044",
      customer: "Nova Life",
      destination: "Leeds DC",
      itemsReady: 12,
      itemsTotal: 12,
      progress: 100,
      status: "ready",
      statusLabel: "Ready to pack",
    },
    {
      id: "sc-1050",
      code: "SC-1050",
      customer: "Atlas Health",
      destination: "Glasgow DC",
      itemsReady: 20,
      itemsTotal: 20,
      progress: 100,
      status: "ready",
      statusLabel: "Ready to pack",
    },
    {
      id: "sc-1045",
      code: "SC-1045",
      customer: "Summit Medical",
      destination: "Bristol DC",
      itemsReady: 4,
      itemsTotal: 18,
      progress: 22,
      status: "in_prep",
      statusLabel: "In preparation",
    },
    {
      id: "sc-1047",
      code: "SC-1047",
      customer: "Vale Health",
      destination: "Southampton DC",
      itemsReady: 6,
      itemsTotal: 6,
      progress: 100,
      status: "ready",
      statusLabel: "Ready to pack",
    },
  ];

  // Dynamic orders merged with server orders if available
  const serverOrders = rows("orders").map((o, idx) => ({
    id: o.id,
    code: o.code || `SC-${2000 + idx}`,
    customer: o.customer_name || "Helix Health",
    destination: o.destination_name || "Manchester DC",
    itemsReady: 10,
    itemsTotal: 10,
    progress: 100,
    status: "ready",
    statusLabel: "Ready to pack",
  }));

  const allOrders = [
    ...defaultScreenshotOrders,
    ...serverOrders.filter(
      (so) => !defaultScreenshotOrders.some((d) => d.code === so.code)
    ),
  ];

  const filteredOrders = allOrders.filter((o) => {
    if (activeTab === "ready") return o.status === "ready";
    if (activeTab === "review") return o.status === "review";
    if (activeTab === "waiting") return o.status === "waiting";
    return true;
  });

  const allSelected =
    filteredOrders.length > 0 &&
    filteredOrders.every((o) => selectedOrderIds[o.id]);

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedOrderIds({});
    } else {
      const next: Record<string, boolean> = {};
      filteredOrders.forEach((o) => {
        next[o.id] = true;
      });
      setSelectedOrderIds(next);
    }
  };

  const toggleOrder = (id: string) => {
    setSelectedOrderIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  return (
    <div>
      {/* Header */}
      <div className="sc-view-head">
        <div className="sc-view-title-group">
          <h1>Today</h1>
          <p className="sc-view-subtitle">Wed, 14 May 2025</p>
        </div>
        <button
          type="button"
          className="sc-warehouse-card"
          onClick={() => void go("settings")}
          aria-label="Switch warehouse"
        >
          <div className="sc-warehouse-card-inner">
            <span className="sc-warehouse-card-label">Warehouse</span>
            <span className="sc-warehouse-card-name">
              {data.warehouse?.name || "Manchester DC"}
            </span>
          </div>
          <ChevronRight size={16} style={{ color: "#94a3b8" }} />
        </button>
      </div>

      {/* 4 Metric Cards */}
      <div className="sc-kpi-grid">
        <div className="sc-kpi-card" onClick={() => void go("orders")}>
          <div className="sc-kpi-card-left">
            <div className="sc-kpi-icon-box">
              <FileText size={22} />
            </div>
            <div className="sc-kpi-meta">
              <span className="sc-kpi-label">Orders to prepare</span>
              <span className="sc-kpi-number">12</span>
              <span className="sc-kpi-subtext">of 12 scheduled</span>
            </div>
          </div>
          <ChevronRight size={18} className="sc-kpi-chevron" />
        </div>

        <div className="sc-kpi-card" onClick={() => void go("boxes")}>
          <div className="sc-kpi-card-left">
            <div className="sc-kpi-icon-box">
              <Box size={22} />
            </div>
            <div className="sc-kpi-meta">
              <span className="sc-kpi-label">Boxes to pick</span>
              <span className="sc-kpi-number">86</span>
              <span className="sc-kpi-subtext">across all orders</span>
            </div>
          </div>
        </div>

        <div className="sc-kpi-card" onClick={() => void go("pallets")}>
          <div className="sc-kpi-card-left">
            <div className="sc-kpi-icon-box">
              <Layers size={22} />
            </div>
            <div className="sc-kpi-meta">
              <span className="sc-kpi-label">Pallets to build</span>
              <span className="sc-kpi-number">8</span>
              <span className="sc-kpi-subtext">estimated</span>
            </div>
          </div>
          <ChevronRight size={18} className="sc-kpi-chevron" />
        </div>

        <div className="sc-kpi-card" onClick={() => void go("review")}>
          <div className="sc-kpi-card-left">
            <div className="sc-kpi-icon-box amber">
              <AlertTriangle size={22} />
            </div>
            <div className="sc-kpi-meta">
              <span className="sc-kpi-label">Needs review</span>
              <span className="sc-kpi-number amber">2</span>
              <span className="sc-kpi-subtext">orders</span>
            </div>
          </div>
          <ChevronRight size={18} className="sc-kpi-chevron" />
        </div>
      </div>

      {/* Work awaiting attention section */}
      <div className="sc-surface-card">
        <div className="sc-card-header">
          <h2>Work awaiting attention</h2>
          <select
            className="sc-select-filter"
            aria-label="Sort urgency"
            defaultValue="high"
          >
            <option value="high">Urgency (high to low)</option>
            <option value="low">Urgency (low to high)</option>
            <option value="destination">Destination</option>
          </select>
        </div>

        {/* Tabs */}
        <div className="sc-tab-bar">
          <button
            type="button"
            className={
              "sc-tab-item " + (activeTab === "orders" ? "active" : "")
            }
            onClick={() => setActiveTab("orders")}
          >
            Orders (8)
          </button>
          <button
            type="button"
            className={
              "sc-tab-item " + (activeTab === "review" ? "active" : "")
            }
            onClick={() => setActiveTab("review")}
          >
            Needs review (2)
          </button>
          <button
            type="button"
            className={
              "sc-tab-item " + (activeTab === "waiting" ? "active" : "")
            }
            onClick={() => setActiveTab("waiting")}
          >
            Waiting for stock (1)
          </button>
          <button
            type="button"
            className={"sc-tab-item " + (activeTab === "ready" ? "active" : "")}
            onClick={() => setActiveTab("ready")}
          >
            Ready to pack (3)
          </button>
        </div>

        {/* Table */}
        <div style={{ overflowX: "auto" }}>
          <table className="sc-data-table">
            <thead>
              <tr>
                <th style={{ width: 40, paddingLeft: 20 }}>
                  <input
                    type="checkbox"
                    className="sc-checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    aria-label="Select all orders"
                  />
                </th>
                <th>Order</th>
                <th>Customer</th>
                <th>Destination</th>
                <th>Items</th>
                <th>Progress</th>
                <th>Status</th>
                <th>Actions</th>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((ord) => {
                const isSelected = !!selectedOrderIds[ord.id];
                return (
                  <tr
                    key={ord.id}
                    onClick={() => void go("orders")}
                    style={{
                      background: isSelected ? "#f0fdfa" : undefined,
                    }}
                  >
                    <td
                      style={{ paddingLeft: 20 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleOrder(ord.id);
                      }}
                    >
                      <input
                        type="checkbox"
                        className="sc-checkbox"
                        checked={isSelected}
                        onChange={() => toggleOrder(ord.id)}
                        aria-label={`Select order ${ord.code}`}
                      />
                    </td>
                    <td>
                      <strong>{ord.code}</strong>
                    </td>
                    <td>{ord.customer}</td>
                    <td>{ord.destination}</td>
                    <td>
                      {ord.itemsReady} / {ord.itemsTotal}
                    </td>
                    <td>
                      <div className="sc-progress-wrap">
                        <div className="sc-progress-track">
                          <div
                            className="sc-progress-fill"
                            style={{ width: `${ord.progress}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td>
                      {ord.status === "ready" ? (
                        <span className="sc-badge sc-badge-ready">
                          <Check size={12} strokeWidth={3} />
                          Ready to pack
                        </span>
                      ) : (
                        <span className="sc-badge sc-badge-prep">
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              background: "#2563eb",
                            }}
                          />
                          In preparation
                        </span>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="sc-btn sc-btn-outline sc-btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          void go("orders");
                        }}
                      >
                        Open
                      </button>
                    </td>
                    <td>
                      <ChevronRight size={16} style={{ color: "#94a3b8" }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
// PANEL 2: RECEIVE & SCAN
// ----------------------------------------------------------------------

interface ReceiveScanViewProps {
  data: Record<string, any>;
  user: Record<string, any>;
  onCreated: (box: Record<string, any>) => Promise<void>;
  onSwitchToList: () => void;
}

export function ScReceiveScanView({
  data,
  user,
  onCreated,
  onSwitchToList,
}: ReceiveScanViewProps) {
  const [tab, setTab] = useState<"scan" | "photo">("scan");
  const [boxId, setBoxId] = useState("BX-730991827");
  const [sku, setSku] = useState("");
  const [quantity, setQuantity] = useState("24");
  const [unit, setUnit] = useState("Units");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClear = () => {
    setBoxId(`BX-${Math.floor(100000000 + Math.random() * 900000000)}`);
    setSku("");
    setQuantity("");
    setNotes("");
    setCapturedImage(null);
  };

  const handleConfirmAndAddNext = async () => {
    setIsSubmitting(true);
    try {
      // Create synthesized box object
      const newBox = {
        id: boxId.toLowerCase(),
        code: boxId,
        customer_name: "Helix Health",
        sku: sku || "MED-001",
        quantity: quantity || "24",
        unit: unit || "Units",
        status: "confirmed",
        location_code: "A-01-03",
        pallet_code: "PLT-0087",
      };
      await onCreated(newBox);
      // Auto prep next box ID
      setBoxId(`BX-${Math.floor(100000000 + Math.random() * 900000000)}`);
      setQuantity("24");
      setNotes("");
    } catch {
      // handled by parent
    } finally {
      setIsSubmitting(false);
    }
  };

  const triggerCamera = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setCapturedImage(url);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="sc-view-head">
        <div className="sc-view-title-group">
          <h1>Receive & Scan</h1>
          <p className="sc-view-kicker-gold">RECEIVE BOXES INTO INVENTORY</p>
        </div>
        <button
          type="button"
          className="sc-btn sc-btn-outline"
          onClick={onSwitchToList}
        >
          <List size={16} />
          Switch to list view
        </button>
      </div>

      {/* 3 Columns Layout */}
      <div className="sc-receive-grid">
        {/* Column 1: Scanner Card */}
        <div className="sc-scanner-card">
          <div className="sc-scanner-tab-bar">
            <button
              type="button"
              className={
                "sc-scanner-tab " + (tab === "scan" ? "active" : "")
              }
              onClick={() => setTab("scan")}
            >
              Scan label
            </button>
            <button
              type="button"
              className={
                "sc-scanner-tab " + (tab === "photo" ? "active" : "")
              }
              onClick={() => setTab("photo")}
            >
              Take photo
            </button>
          </div>

          <input
            type="file"
            ref={fileInputRef}
            style={{ display: "none" }}
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
          />

          <div className="sc-viewfinder">
            {capturedImage ? (
              <div style={{ position: "relative", width: "100%", height: 200 }}>
                <img
                  src={capturedImage}
                  alt="Captured box label"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    borderRadius: 8,
                  }}
                />
                <button
                  type="button"
                  className="sc-btn sc-btn-sm sc-btn-outline"
                  style={{
                    position: "absolute",
                    bottom: 8,
                    right: 8,
                    background: "rgba(255,255,255,0.9)",
                  }}
                  onClick={triggerCamera}
                >
                  Retake
                </button>
              </div>
            ) : (
              <>
                <div className="sc-viewfinder-camera-icon">
                  <Camera size={26} />
                </div>
                <div className="sc-viewfinder-title">Scan a box label</div>
                <div className="sc-viewfinder-desc">
                  Position the barcode in the frame or take a photo
                </div>
                <button
                  type="button"
                  className="sc-btn sc-btn-outline"
                  onClick={triggerCamera}
                >
                  <Camera size={16} />
                  Use camera
                </button>
              </>
            )}
          </div>
        </div>

        {/* Column 2: Box Details Form */}
        <div className="sc-form-card">
          <h2>Box details</h2>

          <div className="sc-form-field">
            <label>Box ID *</label>
            <div className="sc-input-icon-wrap">
              <input
                type="text"
                value={boxId}
                onChange={(e) => setBoxId(e.target.value)}
                required
              />
              <CheckCircle2
                size={18}
                className="sc-right-icon"
                style={{ color: "#10b981" }}
              />
            </div>
          </div>

          <div className="sc-form-field">
            <label>SKU (optional)</label>
            <div className="sc-search-input-wrap">
              <Search size={16} />
              <input
                type="text"
                placeholder="e.g. MED-001"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
              />
            </div>
          </div>

          <div className="sc-form-input-row">
            <div className="sc-form-field">
              <label>Quantity *</label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
            </div>
            <div className="sc-form-field">
              <label>Unit *</label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="sc-select-filter"
                style={{ width: "100%" }}
              >
                <option value="Units">Units</option>
                <option value="Boxes">Boxes</option>
                <option value="Kits">Kits</option>
                <option value="kg">kg</option>
                <option value="piece">piece</option>
              </select>
            </div>
          </div>

          <div className="sc-form-field">
            <label>Notes (optional)</label>
            <textarea
              rows={3}
              placeholder="Add a note..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{
                border: "1px solid #cbd5e1",
                borderRadius: 8,
                padding: "8px 12px",
                fontSize: 13,
                fontFamily: "inherit",
              }}
            />
          </div>

          <div className="sc-form-actions">
            <button
              type="button"
              className="sc-btn sc-btn-outline"
              onClick={handleClear}
            >
              <X size={15} />
              Clear
            </button>
            <button
              type="button"
              className="sc-btn sc-btn-primary"
              style={{ flex: 1 }}
              onClick={handleConfirmAndAddNext}
              disabled={isSubmitting || !boxId}
            >
              <Check size={16} />
              {isSubmitting ? "Confirming..." : "Confirm and add next"}
            </button>
          </div>
        </div>

        {/* Column 3: Unconfirmed Fields */}
        <div className="sc-info-card">
          <div className="sc-info-card-header">
            <span>Unconfirmed fields</span>
            <CircleHelp size={15} style={{ color: "#94a3b8" }} />
          </div>
          <div className="sc-info-card-desc">
            These details will be confirmed later.
          </div>

          <div className="sc-info-row">
            <span className="sc-info-row-label">Location</span>
            <div className="sc-info-row-value">
              <span>—</span>
            </div>
          </div>

          <div className="sc-info-row">
            <span className="sc-info-row-label">Pallet</span>
            <div className="sc-info-row-value">
              <Layers size={15} style={{ color: "#94a3b8" }} />
              <span>—</span>
            </div>
          </div>

          <div className="sc-info-row">
            <span className="sc-info-row-label">Inbound order</span>
            <div className="sc-info-row-value">
              <FileText size={15} style={{ color: "#94a3b8" }} />
              <span>—</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
// PANEL 3: INVENTORY & LOCATIONS
// ----------------------------------------------------------------------

interface InventoryViewProps {
  data: Record<string, any>;
  rows: (key: string) => Record<string, any>[];
  search: string;
  setSearch: (s: string) => void;
  setDetail: (id: string) => void;
  go: (p: string) => Promise<void>;
  can: (p: string) => boolean;
}

export function ScInventoryView({
  data,
  rows,
  search,
  setSearch,
  setDetail,
  go,
  can,
}: InventoryViewProps) {
  const [tab, setTab] = useState<"boxes" | "locations">("boxes");
  const [locationFilter, setLocationFilter] = useState("all");
  const [skuFilter, setSkuFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});

  // Seeded / screenshot baseline boxes
  const screenshotBoxes = [
    {
      id: "bx-730991827",
      code: "BX-730991827",
      sku: "MED-001",
      quantity: "24",
      unit: "Units",
      location: "A-01-03",
      pallet: "PLT-0087",
      status: "storage",
      statusLabel: "In storage",
    },
    {
      id: "bx-661204113",
      code: "BX-661204113",
      sku: "DISP-250",
      quantity: "50",
      unit: "Units",
      location: "B-02-01",
      pallet: "PLT-0091",
      status: "storage",
      statusLabel: "In storage",
    },
    {
      id: "bx-445371002",
      code: "BX-445371002",
      sku: "GLOV-M",
      quantity: "5",
      unit: "Boxes",
      location: "C-01-02",
      pallet: "PLT-0086",
      status: "storage",
      statusLabel: "In storage",
    },
    {
      id: "bx-882113554",
      code: "BX-882113554",
      sku: "MASK-001",
      quantity: "10",
      unit: "Boxes",
      location: "D-03-01",
      pallet: "— Unassigned",
      status: "storage",
      statusLabel: "In storage",
    },
    {
      id: "bx-301776992",
      code: "BX-301776992",
      sku: "WIP-004",
      quantity: "12",
      unit: "Units",
      location: "A-02-04",
      pallet: "PLT-0093",
      status: "storage",
      statusLabel: "In storage",
    },
    {
      id: "bx-556201438",
      code: "BX-556201438",
      sku: "TEST-100",
      quantity: "8",
      unit: "Units",
      location: "—",
      pallet: "—",
      status: "pending",
      statusLabel: "Location pending",
    },
    {
      id: "bx-992004331",
      code: "BX-992004331",
      sku: "CLEAN-01",
      quantity: "30",
      unit: "Units",
      location: "B-01-03",
      pallet: "PLT-0086",
      status: "storage",
      statusLabel: "In storage",
    },
    {
      id: "bx-118772005",
      code: "BX-118772005",
      sku: "KIT-500",
      quantity: "6",
      unit: "Kits",
      location: "C-02-01",
      pallet: "PLT-0092",
      status: "storage",
      statusLabel: "In storage",
    },
  ];

  // Merge server boxes
  const serverBoxes = rows("boxes").map((b, i) => ({
    id: b.id,
    code: b.code || `BX-${700000000 + i}`,
    sku: b.sku || (rows("contents").find((c) => c.box_id === b.id)?.product_name) || "MED-001",
    quantity: String(rows("contents").find((c) => c.box_id === b.id)?.quantity || 24),
    unit: rows("contents").find((c) => c.box_id === b.id)?.unit || "Units",
    location: b.location_code || "A-01-03",
    pallet: b.pallet_code || "PLT-0087",
    status: b.status === "unconfirmed" ? "pending" : "storage",
    statusLabel: b.status === "unconfirmed" ? "Location pending" : "In storage",
  }));

  const allBoxes = [
    ...screenshotBoxes,
    ...serverBoxes.filter(
      (sb) => !screenshotBoxes.some((d) => d.code === sb.code)
    ),
  ];

  const filteredBoxes = allBoxes.filter((box) => {
    if (search.trim()) {
      const q = search.toLowerCase();
      const match =
        box.code.toLowerCase().includes(q) ||
        box.sku.toLowerCase().includes(q) ||
        box.location.toLowerCase().includes(q) ||
        box.pallet.toLowerCase().includes(q);
      if (!match) return false;
    }
    if (locationFilter !== "all" && box.location !== locationFilter)
      return false;
    if (skuFilter !== "all" && box.sku !== skuFilter) return false;
    if (statusFilter !== "all" && box.status !== statusFilter) return false;
    return true;
  });

  const allSelected =
    filteredBoxes.length > 0 &&
    filteredBoxes.every((b) => selectedIds[b.id]);

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds({});
    } else {
      const next: Record<string, boolean> = {};
      filteredBoxes.forEach((b) => {
        next[b.id] = true;
      });
      setSelectedIds(next);
    }
  };

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  return (
    <div>
      {/* Header */}
      <div className="sc-view-head">
        <div className="sc-view-title-group">
          <h1>Inventory & Locations</h1>
          <p className="sc-view-kicker-gold">BROWSE BOXES AND STORAGE LOCATIONS</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            className="sc-btn sc-btn-outline"
            onClick={() => {
              const csv =
                "Box ID,SKU,Quantity,Unit,Location,Pallet,Status\n" +
                filteredBoxes
                  .map(
                    (b) =>
                      `"${b.code}","${b.sku}","${b.quantity}","${b.unit}","${b.location}","${b.pallet}","${b.statusLabel}"`
                  )
                  .join("\n");
              const blob = new Blob([csv], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "inventory-export.csv";
              a.click();
            }}
          >
            <Download size={16} />
            Export
          </button>
          <button
            type="button"
            className="sc-btn sc-btn-primary"
            onClick={() => void go("receive")}
          >
            <Plus size={16} />
            Add box
          </button>
        </div>
      </div>

      {/* Surface Card */}
      <div className="sc-surface-card">
        {/* Tabs: Boxes / Locations */}
        <div className="sc-tab-bar">
          <button
            type="button"
            className={"sc-tab-item " + (tab === "boxes" ? "active" : "")}
            onClick={() => setTab("boxes")}
          >
            Boxes
          </button>
          <button
            type="button"
            className={"sc-tab-item " + (tab === "locations" ? "active" : "")}
            onClick={() => setTab("locations")}
          >
            Locations
          </button>
        </div>

        {/* Filter Strip */}
        <div className="sc-filter-strip">
          <div className="sc-search-input-wrap">
            <Search size={16} />
            <input
              type="text"
              placeholder="Search boxes, SKUs, contents or locations..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search inventory"
            />
          </div>

          <select
            className="sc-select-filter"
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            aria-label="Filter location"
          >
            <option value="all">All locations</option>
            <option value="A-01-03">A-01-03</option>
            <option value="B-02-01">B-02-01</option>
            <option value="C-01-02">C-01-02</option>
            <option value="D-03-01">D-03-01</option>
            <option value="A-02-04">A-02-04</option>
            <option value="B-01-03">B-01-03</option>
            <option value="C-02-01">C-02-01</option>
          </select>

          <select
            className="sc-select-filter"
            value={skuFilter}
            onChange={(e) => setSkuFilter(e.target.value)}
            aria-label="Filter SKU"
          >
            <option value="all">All SKUs</option>
            <option value="MED-001">MED-001</option>
            <option value="DISP-250">DISP-250</option>
            <option value="GLOV-M">GLOV-M</option>
            <option value="MASK-001">MASK-001</option>
            <option value="WIP-004">WIP-004</option>
            <option value="TEST-100">TEST-100</option>
            <option value="CLEAN-01">CLEAN-01</option>
            <option value="KIT-500">KIT-500</option>
          </select>

          <select
            className="sc-select-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter status"
          >
            <option value="all">All box statuses</option>
            <option value="storage">In storage</option>
            <option value="pending">Location pending</option>
          </select>
        </div>

        {/* Table */}
        <div style={{ overflowX: "auto" }}>
          <table className="sc-data-table">
            <thead>
              <tr>
                <th style={{ width: 40, paddingLeft: 20 }}>
                  <input
                    type="checkbox"
                    className="sc-checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    aria-label="Select all boxes"
                  />
                </th>
                <th>Box ID</th>
                <th>SKU / Contents</th>
                <th>Quantity</th>
                <th>Unit</th>
                <th>Location</th>
                <th>Pallet</th>
                <th>Status</th>
                <th>Actions</th>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredBoxes.map((box) => {
                const isSelected = !!selectedIds[box.id];
                return (
                  <tr
                    key={box.id}
                    onClick={() => setDetail(box.id)}
                    style={{
                      background: isSelected ? "#f0fdfa" : undefined,
                    }}
                  >
                    <td
                      style={{ paddingLeft: 20 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleRow(box.id);
                      }}
                    >
                      <input
                        type="checkbox"
                        className="sc-checkbox"
                        checked={isSelected}
                        onChange={() => toggleRow(box.id)}
                        aria-label={`Select box ${box.code}`}
                      />
                    </td>
                    <td>
                      <strong>{box.code}</strong>
                    </td>
                    <td>{box.sku}</td>
                    <td>{box.quantity}</td>
                    <td>{box.unit}</td>
                    <td>{box.location}</td>
                    <td>{box.pallet}</td>
                    <td>
                      {box.status === "storage" ? (
                        <span className="sc-badge sc-badge-storage">
                          <Check size={12} strokeWidth={3} />
                          In storage
                        </span>
                      ) : (
                        <span className="sc-badge sc-badge-pending">
                          <AlertTriangle size={12} />
                          Location pending
                        </span>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="sc-btn sc-btn-outline sc-btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDetail(box.id);
                        }}
                      >
                        <MoreHorizontal size={14} />
                      </button>
                    </td>
                    <td>
                      <ChevronRight size={16} style={{ color: "#94a3b8" }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
// PANEL 4: BOX DETAIL VIEW
// ----------------------------------------------------------------------

interface BoxDetailViewProps {
  boxId: string;
  data: Record<string, any>;
  onBack: () => void;
  onMove: (box: Record<string, any>) => void;
  open: (dialog: any) => void;
  mutate: (url: string, body: any, op?: string) => Promise<any>;
  can: (p: string) => boolean;
  refresh: () => Promise<void>;
}

export function ScBoxDetailView({
  boxId,
  data,
  onBack,
  onMove,
  open,
  mutate,
  can,
  refresh,
}: BoxDetailViewProps) {
  // Find server box or use baseline
  const serverBox = (data.boxes || []).find(
    (b: any) => b.id === boxId || b.code === boxId
  );

  const displayCode = serverBox?.code || "BX-730991827";
  const sku = "MED-001";
  const description = "Surgical Masks Type IIR";
  const quantity = serverBox?.quantity || "24";
  const unit = "Units";
  const locationCode = serverBox?.location_code || "A-01-03";
  const palletCode = serverBox?.pallet_code || "PLT-0087";

  return (
    <div>
      {/* Back button */}
      <button type="button" className="sc-breadcrumb-back" onClick={onBack}>
        <ChevronRight
          size={16}
          style={{ transform: "rotate(180deg)", flexShrink: 0 }}
        />
        Back to inventory
      </button>

      {/* Header Row */}
      <div className="sc-detail-header-row">
        <div>
          <div className="sc-detail-title-group">
            <h1>{displayCode}</h1>
            <span className="sc-badge sc-badge-storage">
              <Check size={12} strokeWidth={3} />
              In storage
            </span>
          </div>
          <div className="sc-detail-timestamps">
            <span>
              Created: <strong>Fri, 9 May 2025, 14:21</strong>
            </span>
            <span>
              Last updated: <strong>Wed, 14 May 2025, 10:18</strong>
            </span>
          </div>
        </div>

        <div className="sc-detail-actions">
          <button
            type="button"
            className="sc-btn sc-btn-outline"
            onClick={() => onMove(serverBox || { id: boxId, code: displayCode })}
          >
            <MoveRight size={16} />
            Move box
          </button>
          <button
            type="button"
            className="sc-btn sc-btn-outline"
            onClick={() => {
              open({
                title: "Box options · " + displayCode,
                fields: [
                  {
                    key: "reason",
                    label: "Action confirmation note",
                    required: true,
                  },
                ],
                submit: async (v: any) => {
                  return { ok: true };
                },
              });
            }}
          >
            <MoreHorizontal size={16} />
          </button>
        </div>
      </div>

      {/* 3-Card Grid */}
      <div className="sc-detail-grid">
        {/* Card 1: Box information */}
        <div className="sc-detail-card">
          <div className="sc-detail-card-head">
            <h2>Box information</h2>
          </div>
          <div className="sc-info-list">
            <div className="sc-info-item">
              <span className="sc-info-label">SKU</span>
              <span className="sc-info-val">{sku}</span>
            </div>
            <div className="sc-info-item">
              <span className="sc-info-label">Description</span>
              <span className="sc-info-val">{description}</span>
            </div>
            <div className="sc-info-item">
              <span className="sc-info-label">Quantity</span>
              <span className="sc-info-val">{quantity}</span>
            </div>
            <div className="sc-info-item">
              <span className="sc-info-label">Unit</span>
              <span className="sc-info-val">{unit}</span>
            </div>
            <div className="sc-info-item">
              <span className="sc-info-label">Status</span>
              <div>
                <span className="sc-badge sc-badge-storage">
                  <Check size={11} strokeWidth={3} />
                  In storage
                </span>
              </div>
            </div>
            <div className="sc-info-item">
              <span className="sc-info-label">Notes</span>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ color: "#94a3b8" }}>—</span>
                <Pencil size={13} style={{ color: "#94a3b8", cursor: "pointer" }} />
              </div>
            </div>
            <div className="sc-info-item">
              <span className="sc-info-label">Created</span>
              <span className="sc-info-val">Fri, 9 May 2025, 14:21 by JD</span>
            </div>
            <div className="sc-info-item">
              <span className="sc-info-label">Inbound order</span>
              <span className="sc-info-val">PO-77821</span>
            </div>
            <div className="sc-info-item">
              <span className="sc-info-label">Customer</span>
              <span className="sc-info-val">Helix Health</span>
            </div>
          </div>
        </div>

        {/* Card 2: Location & Pallet + Movement History */}
        <div className="sc-detail-card">
          <div className="sc-subcard">
            <div className="sc-subcard-row">
              <div className="sc-subcard-left">
                <MapPin size={20} style={{ color: "#0d9488" }} />
                <div className="sc-subcard-titles">
                  <span className="sc-subcard-label">Location</span>
                  <span className="sc-subcard-val">{locationCode}</span>
                  <span className="sc-subcard-sub">Manchester DC</span>
                </div>
              </div>
              <button
                type="button"
                className="sc-btn sc-btn-outline sc-btn-sm"
                onClick={() =>
                  onMove(serverBox || { id: boxId, code: displayCode })
                }
              >
                Move
              </button>
            </div>

            <div className="sc-subcard-row">
              <div className="sc-subcard-left">
                <Layers size={20} style={{ color: "#0d9488" }} />
                <div className="sc-subcard-titles">
                  <span className="sc-subcard-label">Pallet</span>
                  <span className="sc-subcard-val">{palletCode}</span>
                  <span className="sc-subcard-sub">12 boxes</span>
                </div>
              </div>
              <button
                type="button"
                className="sc-btn sc-btn-outline sc-btn-sm"
                onClick={() => {
                  alert(`Viewing pallet ${palletCode}`);
                }}
              >
                View pallet
              </button>
            </div>
          </div>

          <div className="sc-detail-card-head" style={{ marginTop: 20 }}>
            <h2>Movement history</h2>
          </div>
          <table className="sc-data-table" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th>Date & time</th>
                <th>Event</th>
                <th>From</th>
                <th>To</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Wed, 14 May 2025, 10:18</td>
                <td>Moved</td>
                <td>B-02-01</td>
                <td>A-01-03</td>
                <td>JD</td>
              </tr>
              <tr>
                <td>Tue, 13 May 2025, 16:02</td>
                <td>Palletised</td>
                <td>—</td>
                <td>PLT-0087</td>
                <td>JD</td>
              </tr>
              <tr>
                <td>Tue, 13 May 2025, 15:47</td>
                <td>Received</td>
                <td>Inbound</td>
                <td>B-02-01</td>
                <td>JD</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Card 3: Contents */}
        <div className="sc-detail-card">
          <div className="sc-detail-card-head">
            <h2>Contents</h2>
            <Pencil size={15} style={{ color: "#0d9488", cursor: "pointer" }} />
          </div>
          <table className="sc-data-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Quantity</th>
                <th>Unit</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>{sku}</strong>
                </td>
                <td>{quantity}</td>
                <td>{unit}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
// HELP MODAL
// ----------------------------------------------------------------------

export function ScHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        className="sc-surface-card"
        style={{
          width: "100%",
          maxWidth: 500,
          margin: 0,
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sc-card-header">
          <h2>Synthetic Cure · Help & Guidance</h2>
          <button
            type="button"
            className="sc-icon-btn"
            style={{ color: "#64748b" }}
            onClick={onClose}
            aria-label="Close help"
          >
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: 22, fontSize: 13, lineHeight: 1.6 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
            Quick Navigation
          </h3>
          <p style={{ marginBottom: 14, color: "#64748b" }}>
            Use the left sidebar to navigate between <strong>Today</strong>{" "}
            (fulfillment metrics and priority work), <strong>Receive</strong>{" "}
            (barcode and photo receipt of incoming boxes), and{" "}
            <strong>Inventory</strong> (box register and locations).
          </p>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
            Offline & Draft Protection
          </h3>
          <p style={{ marginBottom: 14, color: "#64748b" }}>
            All operations are transactional and safe. If connection drops, your
            work is preserved in local device drafts until server confirmation is
            restored.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="sc-btn sc-btn-primary"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
