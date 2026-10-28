import creatorSymbol from "./assets/mm-symbol.webp";
import {DocumentRecognition} from "./DocumentRecognition";
import {PalletGroups} from "./PalletGroups";
import {CustomerOrderForm} from "./CustomerOrderForm";
import {ProductImport} from "./ProductImport";
import {Inbound} from "./Inbound";
import {Traceability} from "./Traceability";
import {PortalView} from "./PortalView";
import {DraftRecovery} from "./DraftRecovery";
import {ContextPicker,AccessControl} from "./AccessControl";
import {SmartCombobox, SmartQuantityInput, useBarcodeScanner, playScanFeedback, SmartSignaturePad, checkEnvironmentalCompatibility, EnvironmentalWarningBadge} from "./SmartInputs";
import {draftScope,legacyDraftScopes} from "./draft-scope";
import {registerPendingCapture,preservePendingWork,signOutSafely} from "./work-preservation";
import { CompanySetup } from "./CompanySetup";
import { nextPreparationDate } from "../../../packages/domain/scheduling";
import Decimal from "decimal.js";
import React, { useState, useEffect, useRef, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  LayoutDashboard,
  ScanLine,
  Package,
  Layers,
  MapPin,
  Boxes,
  ClipboardList,
  CalendarDays,
  Truck,
  CheckCheck,
  Users,
  FileText,
  Settings,
  Search,
  Plus,
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  ChevronRight,
  AlertTriangle,
  Check,
  WifiOff,
  RefreshCw,
  LogOut,
  X,
  Camera,
  Upload,
  Printer,
  MoveRight,
  ShieldCheck,
  Clock,
  MoreHorizontal,
  Menu,
  Download,
  Archive,
  Undo2,
  Box,
  LoaderCircle,
} from "lucide-react";
import {
  api,
  ApiError,
  setCsrf,
  setApiContext,
  newOperation,
  saveDraft,
  getDraft,
  deleteDraft,
  clearDrafts,
  draftCount,
  identityDraftKeys,
  clearIdentityDrafts,
} from "./api";
import "./style.css";
function saveWork(user:any,key:string,value:any){return saveDraft(draftScope(user),key,{...value,_ownerUserId:user.id});}
function getWork(user:any,key:string){return getDraft(draftScope(user),key,legacyDraftScopes(user));}
function deleteWork(user:any,key:string){return deleteDraft(draftScope(user),key,legacyDraftScopes(user));}
type Row = Record<string, any>;
type Field = {
  key: string;
  label: string;
  type?: string;
  options?: { value: string; label: string; sublabel?: string; badge?: string }[];
  required?: boolean;
  hint?: string;
  value?: any;
};
type DialogSpec = {
  title: string;
  contextId?: string;
  description?: string;
  fields: Field[];
  initial?: Row;
  submitLabel?: string;
  submit: (v: Row, op: string) => Promise<any>;
  after?: (r: any) => void;
  draftKey?: string;
  renderExtra?: (values: Row) => ReactNode;
};
const nav = [
  ["overview", "Overview", LayoutDashboard],
  ["receive", "Receive & scan", ScanLine],
  ["boxes", "Boxes", Package],
  ["pallets", "Pallets", Layers],
  ["locations", "Locations", MapPin],
  ["products", "Products & batches", Boxes],
  ["orders", "Orders", ClipboardList],
  ["preparation", "Preparation board", CalendarDays],
  ["count", "Count & reconcile", CheckCheck],
  ["customers", "Customers & destinations", Users],
  ["trips", "Trips & drivers", Truck],
  ["dispatch", "Dispatch", ArrowUpRight],
  ["driver", "Driver view", Truck],
  ["review", "Returns & review", AlertTriangle],
  ["documents", "Documents & labels", FileText],
  ["settings", "Settings", Settings],
  ["portal", "Client portal", ShieldCheck],
] as const;
const statuses: Record<string, string> = {
  unconfirmed: "Unconfirmed",
  confirmed: "Confirmed",
  empty: "Empty",
  hold: "On hold",
  returned: "Returned · on hold",
  ready: "Ready",
  open: "Open",
  selected: "To prepare",
  picking: "Picking",
  packing: "Packing",
  checking: "Checking",
  dispatched: "Dispatched",
  delivered: "Delivered",
  completed: "Completed",
  partial: "Partial delivery",
  needs_recheck: "Recheck required",
  cancelled: "Cancelled",
  resolved: "Resolved",
  in_progress: "In progress",
  planned: "Planned",
};
function Badge({ value, children }: { value?: string; children?: ReactNode }) {
  return (
    <span
      className={
        "badge " +
        ([
          "confirmed",
          "ready",
          "completed",
          "delivered",
          "resolved",
          "synced",
        ].includes(value || "")
          ? "green"
          : [
                "unconfirmed",
                "hold",
                "returned",
                "checking",
                "partial",
                "needs_recheck",
                "open",
              ].includes(value || "")
            ? "amber"
            : ["cancelled", "failed"].includes(value || "")
              ? "red"
              : "neutral")
      }
    >
      {["confirmed", "ready", "completed", "delivered", "resolved"].includes(
        value || "",
      ) ? (
        <Check size={12} />
      ) : null}
      {children || statuses[value || ""] || value}
    </span>
  );
}
function Empty({
  title = "Nothing here yet",
  text = "New records will appear here.",
  action,
}: {
  title?: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <Box size={32} />
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function ErrorNotice({ error }: { error: any }) {
  return (
    <div role="alert" className="notice error">
      <AlertTriangle size={19} />
      <div>
        <strong>
          {error?.status === 409
            ? "Needs reconciliation"
            : error?.status === 403
              ? "Permission denied"
              : "Could not complete the action"}
        </strong>
        <p>{error?.message || "Unexpected error. Retry when connected."}</p>
        {error?.code && <small>{error.code}</small>}
      </div>
    </div>
  );
}
function Button({
  children,
  onClick,
  secondary = false,
  disabled = false,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  secondary?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      className={
        (secondary ? "btn secondary" : "btn primary") + " " + className
      }
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
function Select({
  label,
  value,
  onChange,
  options,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  required?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
      >
        <option value="">{required ? "Choose…" : "Not assigned"}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
function CreatorCredit({ dark = false }: { dark?: boolean }) {
  return <div className={"creator-credit" + (dark ? " creator-credit-dark" : "")}>
    <img src={creatorSymbol} alt="" width="32" height="28" />
    <span>Created by <strong>Mobeen</strong></span>
  </div>;
}
function App() {
  const cache = useQueryClient();
  const session = useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      const s = await api("/session");
      setCsrf(s.csrf);
      setApiContext(s.user);
      return s;
    },
    retry: false,
  });
  const [page, setPage] = useState(location.hash.slice(1) || "overview"),
    [search, setSearch] = useState(""),
    [menu, setMenu] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [dialog, setDialog] = useState<DialogSpec | null>(null),
    [detail, setDetail] = useState<string | null>(null),
    [toast, setToast] = useState(""),
    [orderForm, setOrderForm] = useState(false),
    [selectedOrderId, setSelectedOrderId] = useState<string | null>(null),
    [orderQuery, setOrderQuery] = useState(""),
    [selectedPalletId, setSelectedPalletId] = useState<string | null>(null),
    [palletQuery, setPalletQuery] = useState(""),
    [selectedLocationId, setSelectedLocationId] = useState<string | null>(null),
    [locationQuery, setLocationQuery] = useState(""),
    [selectedProductId, setSelectedProductId] = useState<string | null>(null),
    [productQuery, setProductQuery] = useState(""),
    [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null),
    [customerQuery, setCustomerQuery] = useState(""),
    [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null),
    [shipmentQuery, setShipmentQuery] = useState(""),
    [selectedTripId, setSelectedTripId] = useState<string | null>(null),
    [tripQuery, setTripQuery] = useState(""),
    [selectedIssueId, setSelectedIssueId] = useState<string | null>(null),
    [issueQuery, setIssueQuery] = useState(""),
    [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null),
    [documentQuery, setDocumentQuery] = useState(""),
    [selectedDriverShipmentId, setSelectedDriverShipmentId] = useState<string | null>(null),
    [driverQuery, setDriverQuery] = useState("");
  useEffect(() => {
    const change = () => setPage(location.hash.slice(1) || "overview");
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("hashchange", change);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("hashchange", change);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  const user = session.data?.user;
  const ws = useQuery({
    queryKey: ["workspace", user?.org_id,user?.warehouse_id, user?.id],
    queryFn: () => api("/workspace"),
    enabled: !!user,
    retry: 1,
    refetchInterval: online ? 30000 : false,
  });
  useEffect(()=>{
    if(user&&((ws.data&&ws.data.warehouse===null&&user.warehouse_id)||(ws.error instanceof ApiError&&[401,403].includes(ws.error.status))))void preservePendingWork().then(()=>session.refetch()).catch(()=>setToast("Device work could not be preserved. Keep this page open and retry storage."));
  },[ws.data,ws.error,user?.id,user?.warehouse_id]);
  const d: Row = ws.data || {};
  const rows = (key: string): Row[] => d[key] || [];
  const opts = (key: string, label = "name") =>
    rows(key).map((r) => ({
      value: r.id,
      label:
        (r.code || r.sku || "") +
        (r.code || r.sku ? " · " : "") +
        (r[label] || r.name || r.id),
    }));
  async function go(p: string) {
    try{await preservePendingWork();}catch{setToast("Device storage could not preserve your work. Save or retry before leaving.");return;}
    if(!user?.warehouse_id&&p!=="settings"){setToast("Choose an assigned warehouse in Settings first.");return;}
    location.hash = p;
    setSearch("");
    setMenu(false);
    setDetail(null);
  }
  const can = (p: string) =>
    !!session.data?.permissions?.some((x: string) => x === "*" || x === p) && (!!user?.warehouse_id || ["configure","manage_access"].includes(p));
  async function switchWorkspace(companyId:string,warehouseId?:string){
    await preservePendingWork();
    await api("/auth/context",{companyId,warehouseId});
    cache.clear();location.hash="settings";location.reload();
  }
  async function signOut(userToClear:{id:string;org_id:string;home_org_id?:string}) {
    let signedOut=false;
    try {
      const done=await signOutSafely({
        capture:preservePendingWork,
        count:async()=>(await identityDraftKeys(userToClear)).length,
        confirm:(count)=>window.confirm(`You have ${count} saved device drafts. They are not synced. Signing out clears them. Stay signed in to finish them, or confirm to discard and sign out.`),
        signOut:async()=>{await api('/auth/logout',{});signedOut=true;},
        clear:()=>clearIdentityDrafts(userToClear),
      });
      if(done){cache.clear();location.reload();}
    } catch {
      window.alert(signedOut ? 'You are signed out, but device drafts could not be cleared. Device storage may still contain your work.' : 'Sign-out could not be confirmed. Your work may not have been saved. Keep this page open and check your connection and device storage before retrying.');
    }
  }
  useEffect(()=>{if(user&&!user.warehouse_id){location.hash="settings";setPage("settings");}},[user?.id,user?.org_id,user?.warehouse_id]);
  async function refresh() {
    await cache.invalidateQueries({ queryKey: ["workspace"] });
    await cache.invalidateQueries({ queryKey: ["box"] });
  }
  async function mutate(url: string, body: Row, op: string = newOperation()) {
    let result;
    try {
      result = await api(url, { ...body, clientOperationId: op });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) await refresh();
      throw error;
    }
    await refresh();
    setToast(
      result?.duplicate ? result.message : "Saved · confirmed by server",
    );
    return result;
  }
  const open = (spec: DialogSpec) => setDialog(spec);
  function move(box: Row, isPallet = false) {
    const boxContents = isPallet
      ? rows("contents").filter((c) =>
          rows("boxes")
            .filter((b) => b.pallet_id === box.id)
            .some((b) => b.id === c.box_id)
        )
      : rows("contents").filter((c) => c.box_id === box.id);
    const productsToMove = boxContents
      .map((c) => rows("products").find((p) => p.id === c.product_id))
      .filter(Boolean);

    open({
      title: "Confirm physical movement",
      contextId: box.id,
      description:
        "Move the goods physically, then record the new position. Pallet contents inherit its location.",
      initial: {
        locationId: box.effective_location_id || box.location_id,
        reason: "",
      },
      fields: [
        {
          key: "locationId",
          label: "Destination location",
          options: opts("locations"),
          required: true,
        },
        { key: "reason", label: "Movement reason", required: true },
      ],
      renderExtra: (v) => {
        if (!v.locationId || !productsToMove.length) return null;
        const targetLoc = rows("locations").find((l) => l.id === v.locationId);
        const check = checkEnvironmentalCompatibility(productsToMove, targetLoc);
        if (!check.isCompatible) {
          return <EnvironmentalWarningBadge warning={check.warning!} />;
        }
        return null;
      },
      submit: (v, op) =>
        mutate(
          "/" + (isPallet ? "pallets" : "boxes") + "/" + box.id + "/move",
          { ...v, expectedVersion: box.version },
          op,
        ),
    });
  }
  function report(boxId?: string) {
    open({
      title: "Report an issue",
      fields: [
        {
          key: "kind",
          label: "Issue type",
          required: true,
          options: [
            "unclear label",
            "shortage",
            "damage",
            "document mismatch",
            "count discrepancy",
            "other",
          ].map((x) => ({ value: x, label: x })),
        },
        {
          key: "note",
          label: "What needs attention?",
          type: "textarea",
          required: true,
        },
      ],
      submit: (v, op) =>
        mutate("/review-issues", { ...v, boxId: boxId || null }, op),
      draftKey: "issue-" + (boxId || "general"),
    });
  }
  function catalog(kind: string) {
    const configs: Record<string, Field[]> = {
      customers: [
        {
          key: "code",
          label: "Customer code",
          required: true,
          hint: "Preserve leading zeros.",
        },
        { key: "name", label: "English name", required: true },
        { key: "name_zh", label: "Chinese name" },
      ],
      destinations: [
        {
          key: "customer_id",
          label: "Ordering customer relationship",
          options: opts("customers"),
        },
        { key: "name", label: "Receiving business / branch", required: true },
        { key: "address", label: "Address", type: "textarea" },
        {
          key: "verified",
          label: "Address physically verified",
          type: "checkbox",
        },
      ],
      products: [
        { key: "sku", label: "Product SKU", required: true },
        { key: "name", label: "English name", required: true },
        { key: "name_zh", label: "Chinese name" },
        {
          key: "profile",
          label: "Product profile",
          options: [
            "Printed goods",
            "General goods",
            "Fresh produce",
            "Chilled",
            "Frozen",
            "Fragile",
            "Mixed contents",
          ].map((x) => ({ value: x, label: x })),
          required: true,
        },
        {
          key: "unit",
          label: "Base unit",
          options: ["piece", "kg", "case", "litre"].map((x) => ({
            value: x,
            label: x,
          })),
          required: true,
        },
        {
          key: "handling",
          label: "Verified handling instructions",
          type: "textarea",
          hint: "Leave blank if unconfirmed.",
        },
      ],
      locations: [
        { key: "code", label: "Location code", required: true },
        { key: "name", label: "Location name", required: true },
        {
          key: "kind",
          label: "Location type",
          options: ["floor", "rack", "shelf", "staging"].map((x) => ({
            value: x,
            label: x,
          })),
          required: true,
        },
        {
          key: "restrictions",
          label: "Verified restrictions",
          type: "textarea",
        },
      ],
      lots: [
        {
          key: "product_id",
          label: "Product",
          options: opts("products"),
          required: true,
        },
        {
          key: "reference",
          label: "Batch / supplier reference",
          required: true,
        },
        { key: "expires_on", label: "Verified expiry date", type: "date" },
      ],
      tracking_marks: [
        { key: "symbol", label: "Original symbol / colour", required: true },
        {
          key: "meaning",
          label: "Confirmed meaning",
          hint: "Leave empty if unconfirmed.",
        },
        { key: "scope", label: "Scope", required: true },
      ],
    };
    open({
      title: "Add " + kind.replace("_", " "),
      fields: configs[kind],
      submit: (v, op) => {
        const record = { ...v };
        for (const f of configs[kind]) {
          if (f.type === "checkbox") record[f.key] = !!v[f.key];
          else if (!f.required && !v[f.key]) record[f.key] = null;
        }
        return mutate("/catalogs/" + kind, { record }, op);
      },
    });
  }
  function pickLoose(order: Row) {
    const sources = rows("contents").filter(
      (c) =>
        c.verified &&
        c.quantity !== null &&
        rows("boxes").some(
          (b) =>
            b.id === c.box_id &&
            b.condition === "good" &&
            ["confirmed", "unconfirmed"].includes(b.status),
        ) &&
        !rows("allocations").some((a) => a.box_id === c.box_id),
    );
    const sortedSources = [...sources].sort((a, b) => {
      const lotA = a.lot_id ? rows("lots").find((l) => l.id === a.lot_id) : null;
      const lotB = b.lot_id ? rows("lots").find((l) => l.id === b.lot_id) : null;
      const expA = lotA?.expires_on;
      const expB = lotB?.expires_on;
      if (expA && expB) return expA.localeCompare(expB);
      if (expA) return -1;
      if (expB) return 1;
      return 0;
    });
    const lines = rows("orderLines").filter((l) => l.order_id === order.id);
    const targets = rows("allocations").filter(
      (a) =>
        a.order_id === order.id &&
        new Decimal(a.picked_quantity || 0).eq(a.quantity),
    );
    open({
      title: "Pick loose quantities",
      contextId: order.id,
      description:
        "Physically transfer verified goods into a new or existing order picking/packing container. Reuse the same container for repeated picks of the same product and batch. Start Picking on the preparation board first.",
      fields: [
        {
          key: "orderLineId",
          label: "Order line",
          required: true,
          options: lines.map((l) => ({
            value: l.id,
            label: l.product_name + " · " + l.unit,
          })),
        },
        {
          key: "contentsId",
          label: "Verified source box contents (FEFO prioritized)",
          required: true,
          options: sortedSources
            .filter((c) => lines.some((l) => l.product_id === c.product_id))
            .map((c) => {
              const lot = c.lot_id ? rows("lots").find((l) => l.id === c.lot_id) : null;
              const box = rows("boxes").find((b) => b.id === c.box_id);
              const exp = lot?.expires_on;
              return {
                value: c.id,
                label:
                  (box?.code || "Box") +
                  " · " +
                  c.product_name +
                  " · " +
                  fmt(c.quantity) +
                  " " +
                  c.unit,
                sublabel:
                  "Location: " +
                  (box?.location_code || "Unknown") +
                  (exp ? " · Exp: " + exp : "") +
                  (lot ? " · Batch: " + lot.reference : ""),
                badge: exp
                  ? "FEFO Exp: " + exp.slice(5)
                  : lot
                    ? "Batch " + lot.reference
                    : undefined,
              };
            }),
        },
        {
          key: "quantity",
          label: "Quantity physically picked · product base unit",
          type: "number",
          required: true,
        },
        {
          key: "targetBoxId",
          label: "Reuse picking container · leave blank to create one",
          options: targets.map((a) => ({
            value: a.box_id,
            label:
              rows("boxes").find((b) => b.id === a.box_id)?.code || a.box_id,
          })),
        },
        {
          key: "locationId",
          label: "Confirmed picking-container location",
          options: opts("locations"),
          required: true,
        },
        {
          key: "temperatureC",
          label: "Measured container temperature °C · if required",
          hint: "Enter a measured value; do not infer it from packaging.",
        },
        { key: "reason", label: "Picking note / confirmation", required: true },
      ],
      submit: (v, op) => {
        const source = rows("contents").find((c) => c.id === v.contentsId);
        const b = rows("boxes").find((b) => b.id === source?.box_id);
        const target = rows("boxes").find((b) => b.id === v.targetBoxId);
        return mutate(
          "/orders/" + order.id + "/pick-loose",
          {
            ...v,
            expectedVersion: order.version,
            sourceBoxId: b?.id,
            sourceVersion: b?.version,
            targetBoxId: v.targetBoxId || undefined,
            targetVersion: target?.version,
            temperatureC: v.temperatureC || null,
          },
          op,
        );
      },
    });
  }
  function configureTraceability(product: Row) {
    open({
      title: "Configure product traceability",
      contextId: product.id,
      description:
        "Confirm this product’s actual requirements. No batch, expiry or temperature rule is inferred from its category or photo. Changes require affected packed loads to be rechecked.",
      fields: [
        {
          key: "requireLot",
          label: "A verified batch / lot is required",
          type: "checkbox",
        },
        {
          key: "requireExpiry",
          label: "A verified expiry date is required",
          type: "checkbox",
        },
        {
          key: "requireTemperature",
          label: "A measured temperature is required",
          type: "checkbox",
        },
        {
          key: "temperatureMin",
          label: "Verified minimum temperature °C · optional",
        },
        {
          key: "temperatureMax",
          label: "Verified maximum temperature °C · optional",
        },
        {
          key: "reason",
          label: "Verified requirement source / reason",
          type: "textarea",
          required: true,
        },
      ],
      initial: {
        requireLot: product.require_lot,
        requireExpiry: product.require_expiry,
        requireTemperature: product.require_temperature,
        temperatureMin: product.temperature_min || "",
        temperatureMax: product.temperature_max || "",
      },
      submit: (v, op) =>
        mutate(
          "/products/" + product.id + "/traceability",
          {
            ...v,
            expectedVersion: product.version,
            temperatureMin: v.temperatureMin || null,
            temperatureMax: v.temperatureMax || null,
          },
          op,
        ),
    });
  }
  function batch() {
    const available = rows("orders").filter(
      (o) =>
        o.status === "open" &&
        !rows("preparationOrders").some((po) => po.order_id === o.id),
    );
    open({
      title: "Create dated preparation batch",
      description:
        "Preparation is separate from delivery. Suggested days create no repeat orders and assign no delivery date.",
      fields: [
        {
          key: "businessDate",
          label: "Preparation date · " + (d.configuration?.timezone || "timezone unconfirmed"),
          value: nextPreparationDate(new Intl.DateTimeFormat("en-CA",{timeZone:d.configuration?.timezone || "UTC",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()),d.configuration?.preparation_weekdays || []) || "",
          type: "date",
          required: true,
        },
        {
          key: "orderIds",
          label: "Select existing orders · optional for an empty batch",
          type: "multiselect",
          options: available.map((o) => ({
            value: o.id,
            label: o.code + " · " + o.customer_name,
          })),
          required: false,
        },
      ],
      submit: (v, op) => mutate("/preparation-batches", v, op),
    });
  }
  function allocate(order: Row) {
    const lines = rows("orderLines").filter((l) => l.order_id === order.id);
    const available = rows("boxes")
      .filter(
        (b) =>
          b.status === "confirmed" &&
          !rows("allocations").some((a) => a.box_id === b.id),
      )
      .sort((a, b) => {
        const expA = boxExpiry(a.id);
        const expB = boxExpiry(b.id);
        if (expA && expB) return expA.localeCompare(expB);
        if (expA) return -1;
        if (expB) return 1;
        return a.code.localeCompare(b.code);
      });
    open({
      title: "Allocate a physical box",
      contextId: order.id,
      description:
        "Only verified whole-box stock can be allocated in this candidate. Repack first when a split is needed.",
      fields: [
        {
          key: "orderLineId",
          label: "Order line",
          required: true,
          options: lines.map((l) => ({
            value: l.id,
            label: l.product_name + " · " + fmt(l.quantity) + " " + l.unit,
          })),
        },
        {
          key: "boxId",
          label: "Available box (FEFO prioritized)",
          required: true,
          options: available.map((b) => {
            const exp = boxExpiry(b.id);
            return {
              value: b.id,
              label: b.code + " · " + contentsText(b.id),
              sublabel:
                "Location: " +
                (b.location_code || "Unknown") +
                (exp ? " · Exp: " + exp : ""),
              badge: exp
                ? "FEFO Exp: " + exp.slice(5)
                : b.pallet_code
                  ? "Pallet " + b.pallet_code
                  : undefined,
            };
          }),
        },
        {
          key: "quantity",
          label: "Full box quantity · same unit as order",
          required: true,
          type: "number",
        },
      ],
      submit: (v, op) =>
        mutate(
          "/orders/" + order.id + "/allocate",
          { ...v, expectedVersion: order.version },
          op,
        ),
    });
  }
  function advance(order: Row, po: Row) {
    const next = ["selected", "picking", "packing", "checking", "ready"][
      ["selected", "picking", "packing", "checking", "ready"].indexOf(
        po.stage,
      ) + 1
    ];
    if (!next) return;
    open({
      title: "Move to " + statuses[next],
      contextId: order.id,
      description:
        next === "ready"
          ? "Confirm physical placement at staging. Readiness does not dispatch goods."
          : "Record the completed physical step. Any shortages require supervisor approval.",
      fields: [
        ...(next === "ready"
          ? [
              {
                key: "stagingLocationId",
                label: "Confirmed staging location",
                required: true,
                options: opts("locations").filter(
                  (x) =>
                    rows("locations").find((l) => l.id === x.value)?.kind ===
                    "staging",
                ),
              },
            ]
          : []),
        ...(can("adjust")
          ? [
              {
                key: "partialApproved",
                label: "Approve partial fulfilment if shortages remain",
                type: "checkbox",
              },
              { key: "reason", label: "Partial fulfilment reason" },
            ]
          : []),
      ],
      submit: (v, op) =>
        mutate(
          "/preparation-batches/" +
            po.preparation_id +
            "/orders/" +
            order.id +
            "/advance",
          { ...v, stage: next, expectedVersion: order.version },
          op,
        ),
    });
  }
  function newTrip() {
    const ships = rows("shipments").filter(
      (s) => s.status === "ready" && !s.trip_id,
    );
    open({
      title: "Plan a delivery trip",
      description:
        "Delivery is scheduled independently of preparation. Stop order follows selected shipments; no route estimate is inferred.",
      fields: [
        {
          key: "businessDate",
          label: "Trip date · " + (d.configuration?.timezone || "timezone unconfirmed"),
          type: "date",
          required: true,
        },
        {
          key: "driverId",
          label: "Driver",
          options: opts("users").filter(
            (o) =>
              rows("users").find((u) => u.id === o.value)?.role === "driver",
          ),
        },
        {
          key: "vehicle",
          label: "Vehicle identifier · leave unassigned if unknown",
        },
        {
          key: "shipmentIds",
          label: "Ready shipments",
          type: "multiselect",
          required: true,
          options: ships.map((s) => {
            const shipLines = rows("shipmentLines").filter((l) => l.shipment_id === s.id);
            const shipBoxes = rows("boxes").filter((b) => shipLines.some((l) => l.box_id === b.id));
            const palletCount = new Set(shipBoxes.map((b) => b.pallet_id).filter(Boolean)).size;
            return {
              value: s.id,
              label: `${s.order_code} · ${s.destination_name} (${shipBoxes.length} boxes${palletCount ? ` · ${palletCount} plts` : ""})`,
            };
          }),
        },
      ],
      renderExtra: (v) => {
        const selectedShipmentIds: string[] = v.shipmentIds || [];
        if (!selectedShipmentIds.length) return null;
        const selectedLines = rows("shipmentLines").filter((l) =>
          selectedShipmentIds.includes(l.shipment_id)
        );
        const selectedBoxes = rows("boxes").filter((b) =>
          selectedLines.some((l) => l.box_id === b.id)
        );
        const palletCount = new Set(selectedBoxes.map((b) => b.pallet_id).filter(Boolean)).size;
        const isOverCapacity = palletCount > 6;

        return (
          <div className={`smart-trip-deck-card ${isOverCapacity ? "alert" : ""}`}>
            <div className="smart-trip-deck-header">
              <span className="smart-trip-deck-title">
                <Truck size={16} /> Vehicle Deck & Payload Manifest
              </span>
              <span className="badge">{selectedShipmentIds.length} stops</span>
            </div>
            <div className="smart-trip-metrics-grid">
              <div className="smart-trip-metric-item">
                <div className="smart-trip-metric-num">{selectedShipmentIds.length}</div>
                <div className="smart-trip-metric-lbl">Shipments</div>
              </div>
              <div className="smart-trip-metric-item">
                <div className="smart-trip-metric-num">{selectedBoxes.length}</div>
                <div className="smart-trip-metric-lbl">Boxes</div>
              </div>
              <div className="smart-trip-metric-item">
                <div className={`smart-trip-metric-num ${isOverCapacity ? "alert" : ""}`}>
                  {palletCount}
                </div>
                <div className="smart-trip-metric-lbl">Pallets</div>
              </div>
            </div>
            {isOverCapacity ? (
              <p className="smart-trip-warning-note">
                ⚠️ Exceeds standard single-van deck footprint (max 6 pallets). Assign a large freight vehicle or divide into multiple trips.
              </p>
            ) : (
              <p className="smart-trip-ok-note">
                ✓ Manifest footprint within standard delivery vehicle limits (≤ 6 pallets).
              </p>
            )}
          </div>
        );
      },
      submit: (v, op) =>
        mutate(
          "/trips",
          { ...v, driverId: v.driverId || null, vehicle: v.vehicle || null },
          op,
        ),
    });
  }
  function handover(s: Row) {
    const ls = rows("shipmentLines").filter((l) => l.shipment_id === s.id);
    const fields: Field[] = ls.flatMap((l) => [
      {
        key: "d_" + l.id,
        label: l.box_code + " · delivered now (" + l.unit + ")",
        type: "number",
        required: true,
        value: String(remaining(l)),
        hint: "Remaining on shipment: " + fmt(remaining(l)) + " " + l.unit,
      },
      {
        key: "r_" + l.id,
        label: l.box_code + " · returned now (" + l.unit + ")",
        type: "number",
        required: true,
        value: "0",
      },
    ]);
    open({
      title: "Record delivery handover",
      contextId: s.id,
      description:
        "Enter this handover only. Server totals preserve outstanding quantities; returned goods remain on hold.",
      fields: [
        ...fields,
        {
          key: "note",
          label: "Recipient proof of delivery (e-POD) & exception note",
          required: true,
          type: "signature",
          hint: "Collect recipient digital signature or record delivery exception reasons.",
        },
      ],
      draftKey: "handover-" + s.id,
      submit: (v, op) =>
        mutate(
          "/shipments/" + s.id + "/handover",
          {
            expectedVersion: s.version,
            lines: ls.map((l) => ({
              lineId: l.id,
              delivered: v["d_" + l.id],
              returned: v["r_" + l.id],
            })),
            note: v.note,
          },
          op,
        ),
    });
  }
  function boxExpiry(boxId: string): string | null {
    const ct = rows("contents").filter((c) => c.box_id === boxId);
    let earliest: string | null = null;
    for (const c of ct) {
      if (c.lot_id) {
        const lot = rows("lots").find((l) => l.id === c.lot_id);
        if (lot?.expires_on) {
          if (!earliest || lot.expires_on < earliest) {
            earliest = lot.expires_on;
          }
        }
      }
    }
    return earliest;
  }
  function contentsText(boxId: string) {
    if (rows("boxes").find((b) => b.id === boxId)?.status === "empty")
      return "Empty · 0 contents";
    const ct = rows("contents").filter((c) => c.box_id === boxId);
    return (
      ct
        .map(
          (c) =>
            (c.quantity === null
              ? "Unconfirmed"
              : fmt(c.quantity) + " " + c.unit) +
            " · " +
            c.product_name,
        )
        .join(" / ") || "Contents unconfirmed"
    );
  }
  function filter(list: Row[]) {
    if (!search.trim()) return list;
    const s = search.toLowerCase();
    return list.filter(
      (x) =>
        Object.values(x).some(
          (v) => typeof v === "string" && v.toLowerCase().includes(s),
        ) ||
        (x.id && contentsText(x.id).toLowerCase().includes(s)),
    );
  }
  if (session.isPending)
    return (
      <div className="startup">
        <LoaderCircle className="spin" /> Opening warehouse workspace…
      </div>
    );
  if (session.isError)
    return (
      <div className="login-card">
        <ErrorNotice error={session.error} />
        <Button onClick={() => void session.refetch()}>Retry connection</Button>
      </div>
    );
  if (!user && session.data?.identity) return <div className="main-content"><ContextPicker session={session.data} onSwitch={switchWorkspace}/><p>No active company context. Your device drafts remain; choose an assigned company or contact its administrator.</p><button className="btn secondary" onClick={()=>void signOut({...session.data.identity,org_id:session.data.identity.home_org_id})}>Sign out</button></div>;
  if (!user)
    return (
      <Login
        data={session.data}
        onLogin={async () => {
          await cache.invalidateQueries({ queryKey: ["session"] });
          go("overview");
        }}
      />
    );
  const selectedNav = nav.find((n) => n[0] === page) || nav[0];
  const title = page === "overview" ? "Warehouse overview" : selectedNav[1];
  const boxTable = (list: Row[], limit?: number) => (
    <div className="record-list">
      {(limit ? filter(list).slice(0, limit) : filter(list)).map((b) => (
        <button className="box-row" key={b.id} onClick={() => setDetail(b.id)}>
          <span className="box-symbol">
            <Package size={21} />
          </span>
          <span className="box-ident">
            <strong>{b.code}</strong>
            <small>{b.customer_name || "Customer not assigned"}</small>
          </span>
          <span className="box-contents">
            {contentsText(b.id)}
            <small>
              {rows("contents")
                .filter((c) => c.box_id === b.id)
                .map((c) => c.name_zh)
                .join(" · ")}
            </small>
          </span>
          <span className="box-place">
            <MapPin size={14} />
            {b.location_code || "Unknown"}
            {b.pallet_code && <small>{b.pallet_code}</small>}
          </span>
          <Badge value={b.status} />
          <ChevronRight size={17} />
        </button>
      ))}
      {!filter(list).length && (
        <Empty
          title="No matching boxes"
          text="Receive a box or change your search."
        />
      )}
    </div>
  );
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (menu ? "open" : "")}>
        <a href="#overview" className="brand" onClick={e=>{e.preventDefault();void go("overview");}}>
          <span className="brand-icon">
            <Boxes size={23} />
          </span>
          <span>
            Synthetic Cure<small>WAREHOUSE OPERATIONS</small>
          </span>
        </a>
        <button type="button" className="warehouse-switch" onClick={()=>go("settings")} aria-label="Choose company or warehouse">
          <span className="tiny-square" />
          <div>
            {d.warehouse?.name || "No assigned warehouse"}
            <small>
              {d.demo ? "Synthetic workspace" : "Internal workspace"}
            </small>
          </div>
          <ChevronRight size={14} />
        </button>
        <p className="nav-heading">WORKSPACE</p>
        <nav>
          {nav
            .filter(
              (n) =>
                user.role !== "driver" ||
                ["driver", "trips", "settings"].includes(n[0]),
            )
            .map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => go(key)}
                className={"nav-link " + (page === key ? "active" : "")}
                aria-current={page === key ? "page" : undefined}
              >
                <Icon size={18} />
                <span>{label}</span>
                {key === "review" &&
                  rows("issues").some((i) => i.status === "open") && (
                    <b>
                      {rows("issues").filter((i) => i.status === "open").length}
                    </b>
                  )}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="live-dot" />{" "}
          {online ? "Server connection available" : "Offline · drafts only"}
          <small>{session.data.database}</small>
        </div>
        <button className="user-menu" onClick={() => go("settings")}>
          <span className="avatar">{user.name.slice(0, 2).toUpperCase()}</span>
          <span>
            {user.name}
            <small>{user.role}</small>
          </span>
          <Settings size={16} />
        </button>
        <CreatorCredit dark />
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            onClick={() => setMenu(!menu)}
          >
            <Menu size={22} />
          </button>
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <strong>{title}</strong>
          </div>
          <span className="top-date">
            {new Intl.DateTimeFormat(d.configuration?.date_format === "iso" ? "en-CA" : "en-GB", {
              year: "numeric",month:"2-digit",day:"2-digit",
              timeZone: d.configuration?.timezone || "UTC",
            }).format(new Date())}
          </span>
          <span className="status-pill">
            <span className="live-dot" />
            {online ? "Online" : "Offline"}
          </span>
          <span className="avatar small">
            {user.name.slice(0, 2).toUpperCase()}
          </span>
        </header>
        <main className="main-content">
          {ws.error instanceof ApiError && ws.error.code==="CONTEXT_CHANGED" && <div className="notice error"><span>Workspace changed. Your form values remain associated with the original context.</span><button className="btn secondary" onClick={async()=>{try{await preservePendingWork();setDialog(null);setDetail(null);await session.refetch();location.hash="settings";setPage("settings");}catch{setToast("Keep this page open: device storage could not preserve your work.");}}}>Preserve work & reopen session</button></div>}
          {d.demo && (
            <div className="demo-banner">
              <ShieldCheck size={16} />
              <span>
                <strong>Synthetic demo</strong> · Sample stock, customers and
                locations. No real operational data.
              </span>
            </div>
          )}
          {!online && (
            <div className="notice warning">
              <WifiOff size={20} />
              <span>
                Offline. Server changes require a connection. Save permitted
                work as a draft on this device.
              </span>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">{d.configuration?.display_name || "WAREHOUSE OPERATIONS"}</div>
              <h1>{title}</h1>
              <p>
                {page === "overview"
                  ? "A clear view of your warehouse. The next action, always in sight."
                  : page === "preparation"
                    ? "Prepare by date. Keep delivery planning separate."
                    : page === "receive"
                      ? "Give every physical box a traceable identity."
                      : page === "dispatch"
                        ? "Verify the manifest before handing over custody."
                        : "Verified records. Clear quantities. Traceable actions."}
              </p>
            </div>
            <div className="heading-actions">
              {page === "overview" || page === "boxes"
                ? can("receive") && (
                    <Button onClick={() => go("receive")}>
                      <Plus size={18} /> Receive goods
                    </Button>
                  )
                : page === "pallets"
                  ? can("pack") && (
                      <Button
                        onClick={() =>
                          open({
                            title: "Build a pallet",
                            fields: [
                              {
                                key: "locationId",
                                label: "Physical location",
                                options: opts("locations"),
                                required: true,
                              },
                            ],
                            submit: (v, op) => mutate("/pallets", v, op),
                          })
                        }
                      >
                        <Plus size={18} /> New pallet
                      </Button>
                    )
                  : page === "orders"
                    ? can("order") && (
                        <Button onClick={() => setOrderForm(true)}>
                          <Plus size={18} /> New order
                        </Button>
                      )
                    : page === "preparation"
                      ? can("prepare") && (
                          <Button onClick={batch}>
                            <Plus size={18} /> New preparation batch
                          </Button>
                        )
                      : page === "trips"
                        ? can("dispatch") && (
                            <Button onClick={newTrip}>
                              <Plus size={18} /> Plan trip
                            </Button>
                          )
                        : page === "review"
                          ? can("review") && (
                              <Button onClick={() => report()}>
                                <Plus size={18} /> Report issue
                              </Button>
                            )
                          : null}
            </div>
          </div>
          {ws.isPending ? (
            <div className="panel loading">
              <LoaderCircle className="spin" /> Loading server records…
            </div>
          ) : ws.isError ? (
            <>
              <ErrorNotice error={ws.error} />
              <Button onClick={() => void ws.refetch()}>Retry</Button>
            </>
          ) : (
            <>
              {page === "overview" && (
                <>
                  <div className="stats-grid">
                    {[
                      [
                        "boxes",
                        "Physical boxes",
                        Package,
                        "View box register",
                        "boxes",
                      ],
                      [
                        "pallets",
                        "Pallets",
                        Layers,
                        "View load units",
                        "pallets",
                      ],
                      [
                        "orders",
                        "Open orders",
                        ClipboardList,
                        "Plan fulfilment",
                        "orders",
                      ],
                      [
                        "issues",
                        "Need review",
                        AlertTriangle,
                        "Resolve outstanding work",
                        "review",
                      ],
                    ].map(([key, label, Icon, caption, target]: any) => (
                      <button
                        className="stat-card"
                        key={key}
                        onClick={() => go(target)}
                      >
                        <div>
                          <span>{label}</span>
                          <Icon size={20} />
                        </div>
                        <strong>{d.counts?.[0]?.[key] ?? 0}</strong>
                        <small>
                          {caption}
                          <ArrowUpRight size={14} />
                        </small>
                      </button>
                    ))}
                  </div>
                  <div className="overview-grid">
                    <section className="preparation-banner">
                      <div className="section-kicker">
                        <CalendarDays size={19} /> DATED PREPARATION
                      </div>
                      <h2>
                        {rows("preparations")[0]
                          ? dateLabel(rows("preparations")[0].business_date,d.configuration)
                          : "Plan the next preparation"}
                      </h2>
                      <p>One dated batch. Every order accounted for.</p>
                      <div className="prep-summary">
                        {[
                          "selected",
                          "picking",
                          "packing",
                          "checking",
                          "ready",
                        ].map((stage) => (
                          <div key={stage}>
                            <strong>
                              {
                                rows("preparationOrders").filter(
                                  (po) =>
                                    po.preparation_id ===
                                      rows("preparations")[0]?.id &&
                                    po.stage === stage,
                                ).length
                              }
                            </strong>
                            <small>{statuses[stage]}</small>
                          </div>
                        ))}
                      </div>
                      <div className="banner-footer">
                        <span>
                          <Clock size={14} /> Delivery dates assigned separately
                        </span>
                        <button onClick={() => go("preparation")}>
                          Open board <ArrowRight size={16} />
                        </button>
                      </div>
                    </section>
                    <section className="panel next-actions">
                      <div className="section-head">
                        <h2>Next actions</h2>
                        <Badge value="neutral">Live work</Badge>
                      </div>
                      {[
                        [
                          ScanLine,
                          "Receive incoming goods",
                          "Create a physical box record",
                          "receive",
                        ],
                        [
                          AlertTriangle,
                          "Review unconfirmed labels",
                          rows("boxes").filter(
                            (b) => b.status === "unconfirmed",
                          ).length + " boxes need contents confirmation",
                          "review",
                        ],
                        [
                          Layers,
                          "Check packed loads",
                          "Verify the latest pallet manifest",
                          "pallets",
                        ],
                      ].map(([Icon, t, desc, p]: any) => (
                        <button
                          className="next-action"
                          key={p}
                          onClick={() => go(p)}
                        >
                          <span>
                            <Icon size={19} />
                          </span>
                          <div>
                            <strong>{t}</strong>
                            <small>{desc}</small>
                          </div>
                          <ChevronRight size={17} />
                        </button>
                      ))}
                    </section>
                  </div>
                  <section className="panel">
                    <div className="section-head">
                      <div>
                        <h2>Box register</h2>
                        <p>Physical units and their effective location</p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => go("boxes")}
                      >
                        View all boxes <ArrowRight size={15} />
                      </button>
                    </div>
                    <div className="search-row">
                      <Search size={18} />
                      <input
                        aria-label="Find a box"
                        placeholder="Find by box ID, customer, product or location…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                      <span>{rows("boxes").length} loaded</span>
                    </div>
                    <div className="table-labels">
                      <span>BOX / CUSTOMER</span>
                      <span>CONTENTS / VERIFIED QUANTITY</span>
                      <span>LOCATION</span>
                      <span>STATUS</span>
                    </div>
                    {boxTable(rows("boxes"), 6)}
                  </section>
                </>
              )}
              {page === "receive" && (
                <div className="stack"><Inbound key={draftScope(user as any)} actor={user} products={rows('products')} locations={rows('locations')} canConfigure={can('configure')} canAdjust={can('adjust')} onSaved={refresh}/><Receipt key={draftScope(user as any)}
                  data={d}
                  user={user}
                  onCreated={async (b) => {
                    await refresh();
                    setDetail(b.id);
                    setToast("Box received · confirmed by server");
                  }}
                /></div>
              )}
              {page === "boxes" && (
                <section className="panel">
                  <div className="section-head">
                    <h2>Physical box register</h2>
                    <Badge>{d.counts?.[0]?.boxes || 0} boxes</Badge>
                  </div>
                  <div className="search-row">
                    <Search size={18} />
                    <input
                      placeholder="Find box, product, customer or location…"
                      aria-label="Search boxes"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  {boxTable(rows("boxes"))}
                </section>
              )}
              {page === "pallets" && (
                <div className="stack">
                  {rows("pallets").length > 0 && <div className="orders-workspace"><section className="panel orders-list-panel" aria-label="Pallets"><div className="orders-list-header"><div><h2>Pallets</h2><p>Select a pallet to review its manifest and actions.</p></div><span className="order-count">{rows("pallets").length} loaded</span></div><label className="orders-search"><Search size={19}/><span className="sr-only">Search pallets or locations</span><input type="search" value={palletQuery} onChange={e=>setPalletQuery(e.target.value)} placeholder="Search pallet or location…"/></label><div className="pallet-list-columns" aria-hidden="true"><span>Pallet ID</span><span>Location</span><span>Boxes</span><span>Manifest</span></div><div>{rows("pallets").filter(p=>[p.code,p.location_code].some(v=>String(v||"").toLocaleLowerCase().includes(palletQuery.trim().toLocaleLowerCase()))).map(p=><button type="button" key={p.id} className={"pallet-list-row "+((selectedPalletId||rows("pallets")[0]?.id)===p.id?"selected":"")} aria-pressed={(selectedPalletId||rows("pallets")[0]?.id)===p.id} onClick={()=>setSelectedPalletId(p.id)}><strong>{p.code}</strong><span>{p.location_code||"Unconfirmed"}</span><span>{p.box_count} boxes</span><Badge value={p.checked_revision===p.manifest_revision?"confirmed":"unconfirmed"}>{p.checked_revision===p.manifest_revision?"Checked":"Needs checking"}</Badge><ChevronRight size={16}/></button>)}{!rows("pallets").some(p=>[p.code,p.location_code].some(v=>String(v||"").toLocaleLowerCase().includes(palletQuery.trim().toLocaleLowerCase())))&&<p className="orders-no-results">No matching pallets. Try another search.</p>}</div></section><div className="pallet-detail-panel" aria-label="Selected pallet details">
                  {rows("pallets").filter(p=>p.id===(selectedPalletId&&rows("pallets").some(x=>x.id===selectedPalletId)?selectedPalletId:rows("pallets")[0]?.id)).map((p) => {
                    const bs = rows("boxes").filter(
                      (b) => b.pallet_id === p.id,
                    );
                    const customers = new Set(
                      bs.map((b) => b.customer_id).filter(Boolean),
                    );
                    return (
                      <section className="panel entity-card" key={p.id}>
                        <div className="card-top">
                          <span className="entity-icon">
                            <Layers size={25} />
                          </span>
                          <Badge
                            value={
                              p.checked_revision === p.manifest_revision
                                ? "confirmed"
                                : "unconfirmed"
                            }
                          >
                            {p.checked_revision === p.manifest_revision
                              ? "Manifest checked"
                              : "Needs checking"}
                          </Badge>
                        </div>
                        <h2>{p.code}</h2>
                        <p>
                          {p.box_count} boxes ·{" "}
                          {customers.size > 1
                            ? "Mixed customers"
                            : customers.size === 1
                              ? "Single customer"
                              : "Customer unassigned"}
                        </p>
                        <div className="mini-meta">
                          <MapPin size={15} />
                          {p.location_code}
                          <span>Revision {p.manifest_revision}</span>
                        </div>
                        <div className="manifest-boxes">
                          {bs.map((b) => (
                            <div key={b.id}>
                              <button
                                className="text-button"
                                onClick={() => setDetail(b.id)}
                              >
                                {b.code}
                              </button>
                              <small>{contentsText(b.id)}</small>
                              {can("pack") && (
                                <button
                                  aria-label={"Remove " + b.code}
                                  className="icon-button"
                                  onClick={() =>
                                    open({
                                      title: "Remove box from pallet",
                                      description:
                                        "Other pallet contents remain in place.",
                                      fields: [
                                        {
                                          key: "locationId",
                                          label: "New standalone location",
                                          options: opts("locations"),
                                          required: true,
                                        },
                                      ],
                                      submit: (v, op) =>
                                        mutate(
                                          "/pallets/" + p.id + "/remove-boxes",
                                          {
                                            ...v,
                                            expectedVersion: p.version,
                                            boxIds: [b.id],
                                          },
                                          op,
                                        ),
                                    })
                                  }
                                >
                                  <X size={15} />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                        <div className="card-actions">
                          {can("pack") && (
                            <>
                              <Button
                                secondary
                                onClick={() =>
                                  open({
                                    title: "Add boxes to " + p.code,
                                    description:
                                      "One physical box can belong to only one pallet.",
                                    fields: [
                                      {
                                        key: "boxIds",
                                        label: "Standalone boxes",
                                        type: "multiselect",
                                        options: rows("boxes")
                                          .filter(
                                            (b) =>
                                              !b.pallet_id &&
                                              ![
                                                "dispatched",
                                                "delivered",
                                                "returned",
                                              ].includes(b.status),
                                          )
                                          .map((b) => ({
                                            value: b.id,
                                            label:
                                              b.code + " · " + b.customer_name,
                                          })),
                                        required: true,
                                      },
                                    ],
                                    submit: (v, op) =>
                                      mutate(
                                        "/pallets/" + p.id + "/add-boxes",
                                        { ...v, expectedVersion: p.version },
                                        op,
                                      ),
                                  })
                                }
                              >
                                <Plus size={16} /> Add boxes
                              </Button>
                              <Button
                                secondary
                                onClick={() =>
                                  open({
                                    title: "Verify current manifest",
                                    description:
                                      "Confirm every listed box physically. Any later content change invalidates this check.",
                                    fields: [],
                                    submit: (_, op) =>
                                      mutate(
                                        "/pallets/" + p.id + "/verify",
                                        { expectedVersion: p.version },
                                        op,
                                      ),
                                  })
                                }
                              >
                                <CheckCheck size={16} /> Check
                              </Button>
                            </>
                          )}
                          {can("move") && (
                            <button
                              className="text-button"
                              onClick={() => move(p, true)}
                            >
                              Move pallet <MoveRight size={15} />
                            </button>
                          )}
                          <a
                            className="icon-button"
                            aria-label="Print pallet label"
                            target="_blank"
                            href={"/api/v1/labels/pallet/" + p.id}
                          >
                            <Printer size={17} />
                          </a>
                        </div>
                      </section>
                    );
                  })}
                  </div></div>}
                  {!rows("pallets").length && (
                    <Empty
                      title="No pallets yet"
                      text="Create a load unit, then add physical boxes."
                    />
                  )}
                </div>
              )}
              {page === "locations" && (
                <>
                  <div className="section-toolbar">
                    <p>List view · capacity stays unknown until verified</p>
                    {can("adjust") && (
                      <Button onClick={() => catalog("locations")}>
                        <Plus size={17} /> Add location
                      </Button>
                    )}
                  </div>
                  {rows("locations").length > 0 && <div className="orders-workspace"><section className="panel orders-list-panel" aria-label="Warehouse locations"><div className="orders-list-header"><div><h2>Locations</h2><p>Select a location to see its occupants and details.</p></div><span className="order-count">{rows("locations").length} loaded</span></div><label className="orders-search"><Search size={19}/><span className="sr-only">Search locations</span><input type="search" value={locationQuery} onChange={e=>setLocationQuery(e.target.value)} placeholder="Search location code or name…"/></label><div className="pallet-list-columns" aria-hidden="true"><span>Location</span><span>Name</span><span>Type</span><span>Capacity</span></div><div>{rows("locations").filter(l=>[l.code,l.name,l.kind].some(v=>String(v||"").toLocaleLowerCase().includes(locationQuery.trim().toLocaleLowerCase()))).map(l=><button type="button" key={l.id} className={"pallet-list-row "+((selectedLocationId&&rows("locations").some(x=>x.id===selectedLocationId)?selectedLocationId:rows("locations")[0]?.id)===l.id?"selected":"")} aria-pressed={(selectedLocationId&&rows("locations").some(x=>x.id===selectedLocationId)?selectedLocationId:rows("locations")[0]?.id)===l.id} onClick={()=>setSelectedLocationId(l.id)}><strong>{l.code}</strong><span>{l.name||"Unconfirmed"}</span><span>{l.kind||"Unconfirmed"}</span><span>{l.capacity ?? "Unknown"}</span><ChevronRight size={16}/></button>)}{!rows("locations").some(l=>[l.code,l.name,l.kind].some(v=>String(v||"").toLocaleLowerCase().includes(locationQuery.trim().toLocaleLowerCase())))&&<p className="orders-no-results">No matching locations. Try another search.</p>}</div></section><div className="pallet-detail-panel" aria-label="Selected location details">
                    {rows("locations").filter(l=>l.id===(selectedLocationId&&rows("locations").some(x=>x.id===selectedLocationId)?selectedLocationId:rows("locations")[0]?.id)).map((l) => {
                      const bs = rows("boxes").filter(
                        (b) => b.effective_location_id === l.id,
                      );
                      return (
                        <section className="panel entity-card" key={l.id}>
                          <div className="card-top">
                            <span className="entity-icon">
                              <MapPin size={24} />
                            </span>
                            <Badge>{l.kind}</Badge>
                          </div>
                          <h2>{l.code}</h2>
                          <p>{l.name}</p>
                          <div className="location-count">
                            {bs.length}
                            <small>loaded boxes at location</small>
                          </div>
                          <div className="mini-meta">
                            Capacity: {l.capacity ?? "Unknown"}
                          </div>
                          <p>{l.restrictions || "Restrictions unconfirmed"}</p>
                          {bs.slice(0, 4).map((b) => (
                            <button
                              key={b.id}
                              className="location-box"
                              onClick={() => setDetail(b.id)}
                            >
                              {b.code}
                              <ChevronRight size={15} />
                            </button>
                          ))}
                          <a
                            className="text-button label-link"
                            target="_blank"
                            href={"/api/v1/labels/location/" + l.id}
                          >
                            <Printer size={16} /> Print location label
                          </a>
                        </section>
                      );
                    })}
                  </div></div>}
                  {!rows("locations").length && <Empty title="No locations yet" text="Add a location when its details are confirmed." />}
                </>
              )}
              {page === "products" && (
                <>
                  {can("configure") && <ProductImport key={draftScope(user as any)} actor={user} onSaved={refresh}/>}
                  <div className="section-toolbar">
                    <p>Base units only · no assumed pack conversions</p>
                    <div className="heading-actions">
                      {can("adjust") && (
                        <>
                          <Button secondary onClick={() => catalog("lots")}>
                            Add batch
                          </Button>
                          <Button onClick={() => catalog("products")}>
                            <Plus size={17} /> Add product
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {rows("products").length > 0 && <div className="orders-workspace"><section className="panel orders-list-panel" aria-label="Products"><div className="orders-list-header"><div><h2>Products</h2><p>Select a product to see its verified details and batches.</p></div><span className="order-count">{rows("products").length} loaded</span></div><label className="orders-search"><Search size={19}/><span className="sr-only">Search products</span><input type="search" value={productQuery} onChange={e=>setProductQuery(e.target.value)} placeholder="Search SKU or product name…"/></label><div className="pallet-list-columns" aria-hidden="true"><span>SKU</span><span>Product</span><span>Chinese name</span><span>Base unit</span></div><div>{rows("products").filter(p=>[p.sku,p.name,p.name_zh].some(v=>String(v||"").toLocaleLowerCase().includes(productQuery.trim().toLocaleLowerCase()))).map(p=><button type="button" key={p.id} className={"pallet-list-row "+((selectedProductId&&rows("products").some(x=>x.id===selectedProductId)?selectedProductId:rows("products")[0]?.id)===p.id?"selected":"")} aria-pressed={(selectedProductId&&rows("products").some(x=>x.id===selectedProductId)?selectedProductId:rows("products")[0]?.id)===p.id} onClick={()=>setSelectedProductId(p.id)}><strong>{p.sku}</strong><span>{p.name||"Unconfirmed"}</span><span>{p.name_zh||"Unconfirmed"}</span><span>{p.unit||"Unconfirmed"}</span><ChevronRight size={16}/></button>)}{!rows("products").some(p=>[p.sku,p.name,p.name_zh].some(v=>String(v||"").toLocaleLowerCase().includes(productQuery.trim().toLocaleLowerCase())))&&<p className="orders-no-results">No matching products. Try another search.</p>}</div></section><div className="pallet-detail-panel" aria-label="Selected product details">
                    {rows("products").filter(p=>p.id===(selectedProductId&&rows("products").some(x=>x.id===selectedProductId)?selectedProductId:rows("products")[0]?.id)).map((p) => (
                      <section key={p.id} className="panel entity-card">
                        <div className="card-top">
                          <span className="entity-icon">
                            <Boxes size={25} />
                          </span>
                          <Badge>{p.profile}</Badge>
                        </div>
                        <div className="eyebrow">PRODUCT SKU · {p.sku}</div>
                        <h2>{p.name}</h2>
                        <p className="chinese">
                          {p.name_zh || "Chinese name unconfirmed"}
                        </p>
                        <dl className="details-list">
                          <div>
                            <dt>Base unit</dt>
                            <dd>{p.unit}</dd>
                          </div>
                          <div>
                            <dt>Pack conversion</dt>
                            <dd>
                              {p.pack_verified
                                ? p.pack_size + " " + p.unit
                                : "Unconfirmed"}
                            </dd>
                          </div>
                          <div>
                            <dt>Traceability rules</dt>
                            <dd>
                              {p.traceability_confirmed
                                ? [
                                    p.require_lot ? "Batch required" : null,
                                    p.require_expiry ? "Expiry required" : null,
                                    p.require_temperature
                                      ? "Measured temperature required"
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ") ||
                                  "Confirmed · no mandatory tracking fields"
                                : "Unconfirmed"}
                            </dd>
                          </div>
                          <div>
                            <dt>Handling</dt>
                            <dd>{p.handling || "Unconfirmed"}</dd>
                          </div>
                        </dl>
                        {can("configure") && (
                          <Button
                            secondary
                            onClick={() => configureTraceability(p)}
                          >
                            Configure traceability
                          </Button>
                        )}
                        {rows("lots")
                          .filter((l) => l.product_id === p.id)
                          .map((l) => (
                            <div className="soft-item" key={l.id}>
                              Batch {l.reference}
                              <small>
                                Expiry:{" "}
                                {l.expires_on
                                  ? dateLabel(l.expires_on,d.configuration)
                                  : "Unknown"}
                              </small>
                            </div>
                          ))}
                      </section>
                    ))}
                  </div></div>}
                  {!rows("products").length && <Empty title="No products yet" text="Add products when their details are confirmed." />}
                </>
              )}
              {page === "orders" && (
                <div className="stack">
                  {orderForm && can("order") && (
                    <CustomerOrderForm
                      key={draftScope(user as any)}
                      actor={user}
                      customers={rows("customers")}
                      destinations={rows("destinations")}
                      products={rows("products")}
                      availableStock={Object.fromEntries(
                        rows("products").map((p) => {
                          const availableContents = rows("contents").filter(
                            (c) =>
                              c.product_id === p.id &&
                              c.verified &&
                              c.quantity !== null &&
                              rows("boxes").some(
                                (b) =>
                                  b.id === c.box_id &&
                                  b.condition === "good" &&
                                  ["confirmed", "unconfirmed"].includes(b.status),
                              ) &&
                              !rows("allocations").some((a) => a.box_id === c.box_id),
                          );
                          const total = availableContents.reduce(
                            (sum, c) => sum.plus(c.quantity),
                            new Decimal(0),
                          );
                          return [p.id, total.toFixed()];
                        }),
                      )}
                      onSaved={refresh}
                      onClose={() => setOrderForm(false)}
                    />
                  )}
                  {rows("orders").length > 0 && <div className="orders-workspace">
                    <section className="panel orders-list-panel" aria-label="Orders">
                      <div className="orders-list-header"><div><h2>Orders</h2><p>Choose an order to see its details and actions.</p></div><span className="order-count">{rows("orders").length} loaded</span></div>
                      <label className="orders-search"><Search size={19}/><span className="sr-only">Search orders, customers or destinations</span><input type="search" placeholder="Search orders, customers or destinations…" value={orderQuery} onChange={e=>setOrderQuery(e.target.value)}/></label>
                      <div className="orders-list-columns" aria-hidden="true"><span>Order</span><span>Ordering customer</span><span>Recipient</span><span>Status</span></div>
                      <div className="orders-list">{rows("orders").filter(o=>[o.code,o.customer_name,o.destination_name].some(value=>String(value||"").toLocaleLowerCase().includes(orderQuery.trim().toLocaleLowerCase()))).map(o=><button type="button" className={"orders-list-row "+((selectedOrderId||rows("orders")[0]?.id)===o.id?"selected":"")} key={o.id} onClick={()=>setSelectedOrderId(o.id)} aria-pressed={(selectedOrderId||rows("orders")[0]?.id)===o.id}><strong>{o.code}</strong><span>{o.customer_name || "Customer unconfirmed"}</span><span>{o.destination_name || "Recipient unconfirmed"}</span><Badge value={o.status}/><ChevronRight size={16}/></button>)}
                      {!rows("orders").some(o=>[o.code,o.customer_name,o.destination_name].some(value=>String(value||"").toLocaleLowerCase().includes(orderQuery.trim().toLocaleLowerCase())))&&<p className="orders-no-results">No matching orders. Try another search.</p>}</div>
                    </section>
                    <div className="orders-detail-panel" aria-label="Selected order details">
                  {rows("orders").filter(o=>o.id===(selectedOrderId && rows("orders").some(x=>x.id===selectedOrderId)?selectedOrderId:rows("orders")[0]?.id)).map((o) => {
                    const ls = rows("orderLines").filter(
                        (l) => l.order_id === o.id,
                      ),
                      al = rows("allocations").filter(
                        (a) => a.order_id === o.id,
                      );
                    return (
                      <section
                        className="panel entity-card order-card"
                        key={o.id}
                      >
                        <div className="section-head">
                          <div>
                            <div className="eyebrow">ORDER ID · {o.code}</div>
                            <h2>{o.customer_name}</h2>
                            <p>Receiving: {o.destination_name}</p>
                            {can("prepare") && <a className="text-button label-link" href={'/api/v1/orders/'+o.id+'/worker-sheet'} target="_blank" rel="noopener noreferrer"><Printer size={16}/> Print worker order sheet</a>}
                          </div>
                          <Badge value={o.status} />
                        </div>
                        <div className="order-lines">
                          {ls.map((l) => {
                            const n = al
                              .filter((a) => a.order_line_id === l.id)
                              .reduce(
                                (s, a) => s.plus(a.quantity),
                                new Decimal(0),
                              )
                              .toFixed();
                            return (
                              <div key={l.id}>
                                <strong>{l.product_name}</strong>
                                <span>
                                  {fmt(l.quantity)} {l.unit} ordered
                                </span>
                                <span>
                                  {fmt(n)} {l.unit} allocated
                                </span>
                                <span>
                                  {fmt(
                                    al
                                      .filter((a) => a.order_line_id === l.id)
                                      .reduce(
                                        (sum, a) =>
                                          sum.plus(a.picked_quantity || 0),
                                        new Decimal(0),
                                      )
                                      .toFixed(),
                                  )}{" "}
                                  {l.unit} picked
                                </span>
                                <span>
                                  {fmt(
                                    rows("shipmentLines")
                                      .filter(
                                        (sl) =>
                                          sl.product_id === l.product_id &&
                                          rows("shipments").some(
                                            (sh) =>
                                              sh.id === sl.shipment_id &&
                                              sh.order_id === o.id &&
                                              [
                                                "dispatched",
                                                "partial",
                                                "completed",
                                              ].includes(sh.status),
                                          ),
                                      )
                                      .reduce(
                                        (sum, sl) => sum.plus(sl.quantity),
                                        new Decimal(0),
                                      )
                                      .toFixed(),
                                  )}{" "}
                                  {l.unit} shipped
                                </span>
                                <Badge
                                  value={
                                    new Decimal(n).lt(l.quantity)
                                      ? "unconfirmed"
                                      : "confirmed"
                                  }
                                >
                                  {new Decimal(n).lt(l.quantity)
                                    ? fmt(
                                        new Decimal(l.quantity)
                                          .minus(n)
                                          .toFixed(),
                                      ) +
                                      " " +
                                      l.unit +
                                      " short"
                                    : "Allocated"}
                                </Badge>
                              </div>
                            );
                          })}
                        </div>
                        {al.map((a) => (
                          <div className="allocation-line" key={a.id}>
                            <Package size={16} />
                            <button
                              className="text-button"
                              onClick={() => setDetail(a.box_id)}
                            >
                              {rows("boxes").find((b) => b.id === a.box_id)
                                ?.code || a.box_id}
                            </button>
                            <span>{fmt(a.quantity)} allocated</span>
                            {can("prepare") && (
                              <button
                                className="text-button"
                                onClick={() =>
                                  open({
                                    title: "Release allocation",
                                    fields: [
                                      {
                                        key: "reason",
                                        label: "Reason",
                                        required: true,
                                      },
                                    ],
                                    submit: (v, op) =>
                                      mutate(
                                        "/orders/" + o.id + "/unallocate",
                                        {
                                          ...v,
                                          boxId: a.box_id,
                                          expectedVersion: o.version,
                                        },
                                        op,
                                      ),
                                  })
                                }
                              >
                                Unallocate
                              </button>
                            )}
                          </div>
                        ))}
                        {o.status === "open" && (
                          <div className="card-actions">
                            {can("prepare") && (
                              <Button secondary onClick={() => allocate(o)}>
                                <Plus size={16} /> Allocate whole box
                              </Button>
                            )}
                            {can("prepare") && (
                              <Button secondary onClick={() => pickLoose(o)}>
                                <ScanLine size={16} /> Pick loose quantities
                              </Button>
                            )}
                            {can("order") && (
                              <Button
                                secondary
                                onClick={() =>
                                  open({
                                    title: "Amend order demand",
                                    description:
                                      "Packed or checked work requires reconciliation after an amendment. Release excess allocations before reducing demand.",
                                    fields: [
                                      {
                                        key: "orderLineId",
                                        label: "Order line",
                                        required: true,
                                        options: ls.map((l) => ({
                                          value: l.id,
                                          label:
                                            l.product_name + " · " + l.unit,
                                        })),
                                      },
                                      {
                                        key: "quantity",
                                        label: "Revised requested quantity",
                                        required: true,
                                        type: "number",
                                      },
                                      {
                                        key: "reason",
                                        label: "Reason for amendment",
                                        required: true,
                                      },
                                    ],
                                    submit: (v, op) =>
                                      mutate(
                                        "/orders/" + o.id + "/amend",
                                        { ...v, expectedVersion: o.version },
                                        op,
                                      ),
                                  })
                                }
                              >
                                Amend order
                              </Button>
                            )}
                            {can("order") && (
                              <button
                                className="text-button danger"
                                onClick={() =>
                                  open({
                                    title: "Cancel order",
                                    description:
                                      "Unshipped allocations will be released. The history is retained.",
                                    fields: [
                                      {
                                        key: "reason",
                                        label: "Cancellation reason",
                                        required: true,
                                      },
                                    ],
                                    submit: (v, op) =>
                                      mutate(
                                        "/orders/" + o.id + "/cancel",
                                        { ...v, expectedVersion: o.version },
                                        op,
                                      ),
                                  })
                                }
                              >
                                Cancel order
                              </button>
                            )}
                          </div>
                        )}
                      </section>
                    );
                  })}
                    </div>
                  </div>}
                  {!rows("orders").length && (
                    <Empty
                      title="No orders yet"
                      text="Create internal customer orders. They will never repeat automatically."
                    />
                  )}
                </div>
              )}
              {page === "preparation" && (
                <Preparation
                  data={d}
                  onAdvance={advance}
                  onAllocate={allocate}
                  canPrepare={can("prepare")}
                  onEditBatch={(b, remove) =>
                    open({
                      title: remove
                        ? "Remove an unprocessed order"
                        : "Add orders to preparation",
                      description: remove
                        ? "Only unprocessed, unallocated orders can be removed."
                        : "Select existing orders explicitly. No order is repeated automatically.",
                      fields: remove
                        ? [
                            {
                              key: "orderId",
                              label: "Order to remove",
                              required: true,
                              options: rows("preparationOrders")
                                .filter(
                                  (po) =>
                                    po.preparation_id === b.id &&
                                    po.stage === "selected",
                                )
                                .map((po) => ({
                                  value: po.order_id,
                                  label:
                                    rows("orders").find(
                                      (o) => o.id === po.order_id,
                                    )?.code || po.order_id,
                                })),
                            },
                            { key: "reason", label: "Reason", required: true },
                          ]
                        : [
                            {
                              key: "orderIds",
                              label: "Orders to add",
                              type: "multiselect",
                              required: true,
                              options: rows("orders")
                                .filter(
                                  (o) =>
                                    o.status === "open" &&
                                    !rows("preparationOrders").some(
                                      (po) => po.order_id === o.id,
                                    ),
                                )
                                .map((o) => ({
                                  value: o.id,
                                  label: o.code + " · " + o.customer_name,
                                })),
                            },
                          ],
                      submit: (v, op) =>
                        mutate(
                          "/preparation-batches/" +
                            b.id +
                            (remove ? "/remove-order" : "/add-orders"),
                          { ...v, expectedVersion: b.version },
                          op,
                        ),
                    })
                  }
                  onCarry={(b) =>
                    open({
                      title: "Carry unfinished preparation forward",
                      description:
                        "Changes this batch date and retains its original history. No orders are duplicated.",
                      fields: [
                        {
                          key: "businessDate",
                          label: "New preparation date",
                          required: true,
                          type: "date",
                        },
                        { key: "reason", label: "Reason", required: true },
                      ],
                      submit: (v, op) =>
                        mutate(
                          "/preparation-batches/" + b.id + "/carry",
                          { ...v, expectedVersion: b.version },
                          op,
                        ),
                    })
                  }
                />
              )}
              {page === "count" && (
                <CountView key={draftScope(user as any)}
                  data={d}
                  user={user}
                  onReport={report}
                  submit={(v, op) => mutate("/counts", v, op)}
                  canSubmit={can("review")}
                />
              )}
              {page === "customers" && (
                <>
                  <div className="section-toolbar">
                    <p>
                      Ordering business and receiving destination are separate
                    </p>
                    {can("adjust") && (
                      <div className="heading-actions">
                        <Button
                          secondary
                          onClick={() =>
                            open({
                              title: "Authorize receiving relationship",
                              description:
                                "Confirm that this recipient may receive goods for the ordering customer. This is an explicit relationship, not an inference from labels.",
                              fields: [
                                {
                                  key: "customerId",
                                  label: "Ordering customer",
                                  options: opts("customers"),
                                  required: true,
                                },
                                {
                                  key: "destinationId",
                                  label: "Receiving destination",
                                  options: opts("destinations"),
                                  required: true,
                                },
                                {
                                  key: "reason",
                                  label: "Authorization evidence / reason",
                                  required: true,
                                  type: "textarea",
                                },
                              ],
                              submit: (v, op) =>
                                mutate("/destination-authorizations", v, op),
                            })
                          }
                        >
                          Authorize destination
                        </Button>
                        <Button
                          secondary
                          onClick={() => catalog("destinations")}
                        >
                          Add destination
                        </Button>
                        <Button onClick={() => catalog("customers")}>
                          <Plus size={17} /> Add customer
                        </Button>
                      </div>
                    )}
                  </div>
                  {rows("customers").length > 0 && <div className="orders-workspace"><section className="panel orders-list-panel" aria-label="Ordering customers"><div className="orders-list-header"><div><h2>Customers</h2><p>Select an ordering customer to review receiving destinations.</p></div><span className="order-count">{rows("customers").length} loaded</span></div><label className="orders-search"><Search size={19}/><span className="sr-only">Search customers</span><input type="search" value={customerQuery} onChange={e=>setCustomerQuery(e.target.value)} placeholder="Search customer code or name…"/></label><div className="pallet-list-columns" aria-hidden="true"><span>Code</span><span>Customer</span><span>Chinese name</span><span>Destinations</span></div><div>{rows("customers").filter(c=>[c.code,c.name,c.name_zh].some(v=>String(v||"").toLocaleLowerCase().includes(customerQuery.trim().toLocaleLowerCase()))).map(c=><button type="button" key={c.id} className={"pallet-list-row "+((selectedCustomerId&&rows("customers").some(x=>x.id===selectedCustomerId)?selectedCustomerId:rows("customers")[0]?.id)===c.id?"selected":"")} aria-pressed={(selectedCustomerId&&rows("customers").some(x=>x.id===selectedCustomerId)?selectedCustomerId:rows("customers")[0]?.id)===c.id} onClick={()=>setSelectedCustomerId(c.id)}><strong>{c.code}</strong><span>{c.name||"Unconfirmed"}</span><span>{c.name_zh||"Unconfirmed"}</span><span>{rows("destinations").filter(d=>d.customer_id===c.id).length} loaded</span><ChevronRight size={16}/></button>)}{!rows("customers").some(c=>[c.code,c.name,c.name_zh].some(v=>String(v||"").toLocaleLowerCase().includes(customerQuery.trim().toLocaleLowerCase())))&&<p className="orders-no-results">No matching customers. Try another search.</p>}</div></section><div className="pallet-detail-panel" aria-label="Selected customer details">
                    {rows("customers").filter(c=>c.id===(selectedCustomerId&&rows("customers").some(x=>x.id===selectedCustomerId)?selectedCustomerId:rows("customers")[0]?.id)).map((c) => (
                      <section className="panel entity-card" key={c.id}>
                        <span className="entity-icon">
                          <Users size={25} />
                        </span>
                        <div className="eyebrow">CUSTOMER CODE · {c.code}</div>
                        <h2>{c.name}</h2>
                        <p className="chinese">
                          {c.name_zh || "Chinese name unconfirmed"}
                        </p>
                        <h3>Receiving destinations</h3>
                        {rows("destinations")
                          .filter((x) => x.customer_id === c.id)
                          .map((x) => (
                            <div className="soft-item" key={x.id}>
                              <strong>{x.name}</strong>
                              <small>
                                {x.address || "Address unconfirmed"}
                              </small>
                              <Badge
                                value={x.verified ? "confirmed" : "unconfirmed"}
                              >
                                {x.verified
                                  ? "Address verified"
                                  : "Address unconfirmed"}
                              </Badge>
                              {can("adjust") && (
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    open({
                                      title: "Verify receiving address",
                                      description:
                                        "Enter an address only after confirming it from an authorized source.",
                                      fields: [
                                        {
                                          key: "address",
                                          label: "Verified delivery address",
                                          required: true,
                                          type: "textarea",
                                        },
                                        {
                                          key: "reason",
                                          label: "Verification source / reason",
                                          required: true,
                                        },
                                      ],
                                      initial: { address: x.address || "" },
                                      submit: (v, op) =>
                                        mutate(
                                          "/destinations/" +
                                            x.id +
                                            "/verify-address",
                                          { ...v, expectedVersion: x.version },
                                          op,
                                        ),
                                    })
                                  }
                                >
                                  Verify / update address
                                </button>
                              )}
                            </div>
                          ))}
                        {rows("authorizations")
                          .filter((a) => a.customer_id === c.id)
                          .map((a) => (
                            <div className="soft-item" key={a.id}>
                              <Badge value="confirmed">
                                Authorized recipient
                              </Badge>
                              <strong>
                                {
                                  rows("destinations").find(
                                    (d) => d.id === a.destination_id,
                                  )?.name
                                }
                              </strong>
                              <small>{a.reason}</small>
                            </div>
                          ))}
                        <p>
                          {
                            rows("orders").filter((o) => o.customer_id === c.id)
                              .length
                          }{" "}
                          loaded internal orders
                        </p>
                      </section>
                    ))}
                  </div></div>}
                  {!rows("customers").length && <Empty title="No customers yet" text="Add an ordering customer when its details are confirmed." />}
                </>
              )}
              {page === "trips" && (
                <div className="stack">
                  {can("dispatch") && <PalletGroups key={draftScope(user as any)} actor={user} trips={rows("trips")} pallets={rows("pallets")}/>}
                  {rows("trips").length > 0 && <div className="orders-workspace"><section className="panel orders-list-panel" aria-label="Trips"><div className="orders-list-header"><div><h2>Trips</h2><p>Select a trip to review its driver, vehicle and stops.</p></div><span className="order-count">{rows("trips").length} loaded</span></div><label className="orders-search"><Search size={19}/><span className="sr-only">Search trips</span><input type="search" value={tripQuery} onChange={e=>setTripQuery(e.target.value)} placeholder="Search trip, driver or vehicle…"/></label><div className="pallet-list-columns" aria-hidden="true"><span>Trip</span><span>Date</span><span>Driver</span><span>Status</span></div><div>{rows("trips").filter(t=>[t.code,t.driver_name,t.vehicle].some(v=>String(v||"").toLocaleLowerCase().includes(tripQuery.trim().toLocaleLowerCase()))).map(t=><button type="button" key={t.id} className={"pallet-list-row "+((selectedTripId&&rows("trips").some(x=>x.id===selectedTripId)?selectedTripId:rows("trips")[0]?.id)===t.id?"selected":"")} aria-pressed={(selectedTripId&&rows("trips").some(x=>x.id===selectedTripId)?selectedTripId:rows("trips")[0]?.id)===t.id} onClick={()=>setSelectedTripId(t.id)}><strong>{t.code}</strong><span>{dateLabel(t.business_date,d.configuration)}</span><span>{t.driver_name||rows("users").find(u=>u.id===t.driver_id)?.name||"Not assigned"}</span><Badge value={t.status}/><ChevronRight size={16}/></button>)}{!rows("trips").some(t=>[t.code,t.driver_name,t.vehicle].some(v=>String(v||"").toLocaleLowerCase().includes(tripQuery.trim().toLocaleLowerCase())))&&<p className="orders-no-results">No matching trips. Try another search.</p>}</div></section><div className="pallet-detail-panel" aria-label="Selected trip details">
                  {rows("trips").filter(t=>t.id===(selectedTripId&&rows("trips").some(x=>x.id===selectedTripId)?selectedTripId:rows("trips")[0]?.id)).map((t) => (
                    <section className="panel entity-card" key={t.id}>
                      <div className="section-head">
                        <div>
                          <div className="eyebrow">TRIP ID · {t.code}</div>
                          <h2>{dateLabel(t.business_date,d.configuration)}</h2>
                        </div>
                        <Badge value={t.status} />
                      </div>
                      <dl className="trip-meta">
                        <div>
                          <dt>Driver</dt>
                          <dd>
                            {t.driver_name ||
                              rows("users").find((u) => u.id === t.driver_id)
                                ?.name ||
                              t.driver_id ||
                              "Not assigned"}
                          </dd>
                        </div>
                        <div>
                          <dt>Vehicle</dt>
                          <dd>{t.vehicle || "Not assigned"}</dd>
                        </div>
                        <div>
                          <dt>Routing</dt>
                          <dd>Manually planned</dd>
                        </div>
                      </dl>
                      {rows("stops")
                        .filter((s) => s.trip_id === t.id)
                        .map((s) => (
                          <div className="stop-line" key={s.id}>
                            <b>{s.position}</b>
                            <div>
                              <strong>{s.name}</strong>
                              <small>
                                {s.address ||
                                  "Address unconfirmed · confirm before departure"}
                              </small>
                              <span>
                                {
                                  rows("shipments").filter(
                                    (sh) => sh.stop_id === s.id,
                                  ).length
                                }{" "}
                                loaded shipments
                              </span>
                            </div>
                          </div>
                        ))}
                      {can("dispatch") && (
                        <Button
                          secondary
                          onClick={() =>
                            open({
                              title: "Reassign driver",
                              description: "Assignment history is preserved.",
                              fields: [
                                {
                                  key: "driverId",
                                  label: "Driver",
                                  options: opts("users").filter(
                                    (o) =>
                                      rows("users").find(
                                        (u) => u.id === o.value,
                                      )?.role === "driver",
                                  ),
                                  required: true,
                                },
                                {
                                  key: "reason",
                                  label: "Reason",
                                  required: true,
                                },
                              ],
                              submit: (v, op) =>
                                mutate(
                                  "/trips/" + t.id + "/reassign",
                                  { ...v, expectedVersion: t.version },
                                  op,
                                ),
                            })
                          }
                        >
                          Reassign driver
                        </Button>
                      )}
                    </section>
                  ))}
                  </div></div>}
                  {!rows("trips").length && (
                    <Empty
                      title="No trips assigned"
                      text="Ready shipments can be grouped into a dated trip. Drivers and dates are assigned separately."
                    />
                  )}
                </div>
              )}
              {page === "dispatch" && (
                <div className="stack">
                  {rows("shipments").some(s=>!["cancelled","completed"].includes(s.status)) && <div className="orders-workspace"><section className="panel orders-list-panel" aria-label="Active shipments"><div className="orders-list-header"><div><h2>Shipments</h2><p>Select a shipment to verify its manifest. Loading does not mean delivery.</p></div><span className="order-count">{rows("shipments").filter(s=>!["cancelled","completed"].includes(s.status)).length} loaded</span></div><label className="orders-search"><Search size={19}/><span className="sr-only">Search shipments</span><input type="search" value={shipmentQuery} onChange={e=>setShipmentQuery(e.target.value)} placeholder="Search shipment, order or destination…"/></label><div className="pallet-list-columns" aria-hidden="true"><span>Shipment</span><span>Order</span><span>Destination</span><span>Status</span></div><div>{rows("shipments").filter(s=>!["cancelled","completed"].includes(s.status)&&[s.id,s.order_code,s.destination_name].some(v=>String(v||"").toLocaleLowerCase().includes(shipmentQuery.trim().toLocaleLowerCase()))).map(s=><button type="button" key={s.id} className={"pallet-list-row "+((selectedShipmentId&&rows("shipments").some(x=>x.id===selectedShipmentId&&!["cancelled","completed"].includes(x.status))?selectedShipmentId:rows("shipments").find(x=>!["cancelled","completed"].includes(x.status))?.id)===s.id?"selected":"")} aria-pressed={(selectedShipmentId&&rows("shipments").some(x=>x.id===selectedShipmentId&&!["cancelled","completed"].includes(x.status))?selectedShipmentId:rows("shipments").find(x=>!["cancelled","completed"].includes(x.status))?.id)===s.id} onClick={()=>setSelectedShipmentId(s.id)}><strong>{s.id.slice(0,8)}</strong><span>{s.order_code||"Unconfirmed"}</span><span>{s.destination_name||"Unconfirmed"}</span><Badge value={s.status}/><ChevronRight size={16}/></button>)}{!rows("shipments").some(s=>!["cancelled","completed"].includes(s.status)&&[s.id,s.order_code,s.destination_name].some(v=>String(v||"").toLocaleLowerCase().includes(shipmentQuery.trim().toLocaleLowerCase())))&&<p className="orders-no-results">No matching shipments. Try another search.</p>}</div></section><div className="pallet-detail-panel" aria-label="Selected shipment manifest">
                  {rows("shipments")
                    .filter(s=>!["cancelled","completed"].includes(s.status)&&s.id===(selectedShipmentId&&rows("shipments").some(x=>x.id===selectedShipmentId&&!["cancelled","completed"].includes(x.status))?selectedShipmentId:rows("shipments").find(x=>!["cancelled","completed"].includes(x.status))?.id))
                    .map((s) => (
                      <section className="panel entity-card" key={s.id}>
                        <div className="section-head">
                          <div>
                            <div className="eyebrow">
                              SHIPMENT · {s.id.slice(0, 8)}
                            </div>
                            <h2>{s.order_code}</h2>
                            <p>{s.destination_name}</p>
                          </div>
                          <Badge value={s.status} />
                        </div>
                        <p>
                          Trip:{" "}
                          {rows("trips").find((t) => t.id === s.trip_id)
                            ?.code || "Not assigned"}
                        </p>
                        {rows("shipmentLines")
                          .filter((l) => l.shipment_id === s.id)
                          .map((l) => (
                            <div className="shipment-line" key={l.id}>
                              <Package size={19} />
                              <div>
                                <strong>{l.box_code}</strong>
                                <small>
                                  {l.product_name} · {fmt(l.quantity)} {l.unit}
                                </small>
                              </div>
                              <Badge
                                value={l.loaded ? "confirmed" : "unconfirmed"}
                              >
                                {l.loaded ? "Loaded" : "Awaiting load"}
                              </Badge>
                            </div>
                          ))}
                        {can("dispatch") && s.status === "ready" && (
                          <div className="card-actions">
                            <Button
                              secondary
                              onClick={() =>
                                open({
                                  title: "Verify box against manifest",
                                  description:
                                    "Type or scan the internal box ID. Duplicate scans do not create boxes.",
                                  fields: [
                                    {
                                      key: "boxCode",
                                      label: "Physical box ID",
                                      required: true,
                                    },
                                  ],
                                  submit: (v, op) => {
                                    const b = rows("boxes").find(
                                      (b) =>
                                        b.code === v.boxCode.trim() ||
                                        b.id === v.boxCode.trim(),
                                    );
                                    if (!b)
                                      throw new Error(
                                        "Box ID not found. Check the internal label.",
                                      );
                                    return mutate(
                                      "/shipments/" + s.id + "/load",
                                      {
                                        boxId: b.id,
                                        expectedVersion: s.version,
                                      },
                                      op,
                                    );
                                  },
                                })
                              }
                            >
                              <ScanLine size={17} /> Verify load
                            </Button>
                            <Button
                              onClick={() =>
                                open({
                                  title: "Confirm custody handover",
                                  description:
                                    "All boxes must be loaded and driver/vehicle assigned. This records dispatch, not delivery.",
                                  fields: can("adjust")
                                    ? [
                                        {
                                          key: "addressOverride",
                                          label:
                                            "Supervisor exception · delivery address is unverified",
                                          type: "checkbox",
                                        },
                                        {
                                          key: "addressOverrideReason",
                                          label:
                                            "Address exception reason / verified handover instructions",
                                        },
                                        {
                                          key: "partialApproved",
                                          label:
                                            "Approve partial dispatch · split unloaded goods into a remaining shipment",
                                          type: "checkbox",
                                        },
                                        {
                                          key: "reason",
                                          label: "Partial dispatch reason",
                                        },
                                      ]
                                    : [],
                                  submit: (v, op) =>
                                    mutate(
                                      "/shipments/" + s.id + "/dispatch",
                                      { ...v, expectedVersion: s.version },
                                      op,
                                    ),
                                })
                              }
                            >
                              <Truck size={17} /> Dispatch shipment
                            </Button>
                          </div>
                        )}
                      </section>
                    ))}
                  </div></div>}
                  {!rows("shipments").filter(
                    (s) => !["cancelled", "completed"].includes(s.status),
                  ).length && (
                    <Empty
                      title="No shipments awaiting dispatch"
                      text="Check and stage an order on the preparation board to create its shipment."
                    />
                  )}
                </div>
              )}
              {page === "driver" && (
                <>
                  <div className="notice info">
                    <Truck size={20} />
                    <span>
                      {user.role === "driver"
                        ? "Only your assigned trips are visible."
                        : "Driver role is required to record handover. Use demo driver sign-in to test assigned work."}{" "}
                      Pending evidence is never a confirmed shared delivery.
                    </span>
                  </div>
                  <div className="stack">
                    {rows("shipments").some(s=>["dispatched","partial","completed"].includes(s.status)) && <div className="orders-workspace"><section className="panel orders-list-panel" aria-label="Delivery shipments"><div className="orders-list-header"><div><h2>Deliveries</h2><p>Select an assigned shipment to review its goods and handover.</p></div><span className="order-count">{rows("shipments").filter(s=>["dispatched","partial","completed"].includes(s.status)).length} loaded</span></div><label className="orders-search"><Search size={19}/><span className="sr-only">Search delivery shipments</span><input type="search" value={driverQuery} onChange={e=>setDriverQuery(e.target.value)} placeholder="Search order or destination…"/></label><div className="pallet-list-columns" aria-hidden="true"><span>Order</span><span>Destination</span><span>Shipment</span><span>Status</span></div><div>{rows("shipments").filter(s=>["dispatched","partial","completed"].includes(s.status)&&[s.order_code,s.destination_name,s.id].some(v=>String(v||"").toLocaleLowerCase().includes(driverQuery.trim().toLocaleLowerCase()))).map(s=><button type="button" key={s.id} className={"pallet-list-row "+((selectedDriverShipmentId&&rows("shipments").some(x=>x.id===selectedDriverShipmentId&&["dispatched","partial","completed"].includes(x.status))?selectedDriverShipmentId:rows("shipments").find(x=>["dispatched","partial","completed"].includes(x.status))?.id)===s.id?"selected":"")} aria-pressed={(selectedDriverShipmentId&&rows("shipments").some(x=>x.id===selectedDriverShipmentId&&["dispatched","partial","completed"].includes(x.status))?selectedDriverShipmentId:rows("shipments").find(x=>["dispatched","partial","completed"].includes(x.status))?.id)===s.id} onClick={()=>setSelectedDriverShipmentId(s.id)}><strong>{s.order_code||"Unconfirmed"}</strong><span>{s.destination_name||"Unconfirmed"}</span><span>{s.id.slice(0,8)}</span><Badge value={s.status}/><ChevronRight size={16}/></button>)}{!rows("shipments").some(s=>["dispatched","partial","completed"].includes(s.status)&&[s.order_code,s.destination_name,s.id].some(v=>String(v||"").toLocaleLowerCase().includes(driverQuery.trim().toLocaleLowerCase())))&&<p className="orders-no-results">No matching deliveries. Try another search.</p>}</div></section><div className="pallet-detail-panel" aria-label="Selected delivery details">
                    {rows("shipments")
                      .filter(s=>["dispatched","partial","completed"].includes(s.status)&&s.id===(selectedDriverShipmentId&&rows("shipments").some(x=>x.id===selectedDriverShipmentId&&["dispatched","partial","completed"].includes(x.status))?selectedDriverShipmentId:rows("shipments").find(x=>["dispatched","partial","completed"].includes(x.status))?.id))
                      .map((s) => (
                        <section className="panel entity-card" key={s.id}>
                          <div className="section-head">
                            <h2>{s.order_code}</h2>
                            <Badge value={s.status} />
                          </div>
                          <p>
                            {rows("stops").find((st) => st.id === s.stop_id)
                              ?.name || s.destination_name}
                          </p>
                          {rows("shipmentLines")
                            .filter((l) => l.shipment_id === s.id)
                            .map((l) => (
                              <div className="soft-item" key={l.id}>
                                <strong>
                                  {l.box_code} · {l.product_name}
                                </strong>
                                <small>
                                  {fmt(l.delivered)} delivered /{" "}
                                  {fmt(l.returned)} returned /{" "}
                                  {fmt(remaining(l))} {l.unit} outstanding
                                </small>
                              </div>
                            ))}
                          {can("handover") && s.status !== "completed" && (
                            <Button onClick={() => handover(s)}>
                              Record handover <ArrowRight size={16} />
                            </Button>
                          )}
                        </section>
                      ))}
                    </div></div>}
                    {!rows("shipments").some((s) =>
                      ["dispatched", "partial", "completed"].includes(s.status),
                    ) && (
                      <Empty
                        title="No deliveries in progress"
                        text="Loaded goods appear here only after server-confirmed dispatch."
                      />
                    )}
                  </div>
                </>
              )}
              {page === "review" && (
                <>
                  <div className="notice warning">
                    <Archive size={20} />
                    <span>
                      Returned goods stay on hold. Resolving an issue does not
                      release stock or invent a quantity adjustment.
                    </span>
                  </div>
                  <div className="stack">
                    {rows("issues").length > 0 && <div className="orders-workspace"><section className="panel orders-list-panel" aria-label="Review issues"><div className="orders-list-header"><div><h2>Review queue</h2><p>Select an issue to review its evidence and next action.</p></div><span className="order-count">{rows("issues").length} loaded</span></div><label className="orders-search"><Search size={19}/><span className="sr-only">Search review issues</span><input type="search" value={issueQuery} onChange={e=>setIssueQuery(e.target.value)} placeholder="Search box, issue or note…"/></label><div className="pallet-list-columns" aria-hidden="true"><span>Issue</span><span>Box</span><span>Note</span><span>Status</span></div><div>{rows("issues").filter(i=>[i.kind,i.box_code,i.note].some(v=>String(v||"").toLocaleLowerCase().includes(issueQuery.trim().toLocaleLowerCase()))).map(i=><button type="button" key={i.id} className={"pallet-list-row "+((selectedIssueId&&rows("issues").some(x=>x.id===selectedIssueId)?selectedIssueId:rows("issues")[0]?.id)===i.id?"selected":"")} aria-pressed={(selectedIssueId&&rows("issues").some(x=>x.id===selectedIssueId)?selectedIssueId:rows("issues")[0]?.id)===i.id} onClick={()=>setSelectedIssueId(i.id)}><strong>{i.kind||"Unconfirmed"}</strong><span>{i.box_code||"General review"}</span><span>{i.note||"No note"}</span><Badge value={i.status}/><ChevronRight size={16}/></button>)}{!rows("issues").some(i=>[i.kind,i.box_code,i.note].some(v=>String(v||"").toLocaleLowerCase().includes(issueQuery.trim().toLocaleLowerCase())))&&<p className="orders-no-results">No matching issues. Try another search.</p>}</div></section><div className="pallet-detail-panel" aria-label="Selected review issue">
                    {rows("issues").filter(i=>i.id===(selectedIssueId&&rows("issues").some(x=>x.id===selectedIssueId)?selectedIssueId:rows("issues")[0]?.id)).map((i) => (
                      <section className="panel issue-card" key={i.id}>
                        <span className="issue-icon">
                          <AlertTriangle size={23} />
                        </span>
                        <div className="issue-content">
                          <div className="eyebrow">{i.kind}</div>
                          <h2>{i.box_code || "General review"}</h2>
                          <p>{i.note}</p>
                          {i.resolution && (
                            <div className="soft-item">
                              Resolution: {i.resolution}
                            </div>
                          )}
                          <div className="card-actions">
                            {i.kind === "return disposition" &&
                              i.status === "open" &&
                              can("adjust") && (
                                <Button
                                  secondary
                                  onClick={() => {
                                    const b = rows("boxes").find(
                                      (b) => b.id === i.box_id,
                                    );
                                    if (!b) return;
                                    open({
                                      title:
                                        "Inspect & disposition returned goods",
                                      description:
                                        "Recorded returned quantity becomes warehouse contents. Release requires your explicit physical inspection; quarantine keeps the goods unavailable.",
                                      fields: [
                                        {
                                          key: "disposition",
                                          label: "Disposition",
                                          required: true,
                                          options: [
                                            {
                                              value: "quarantine",
                                              label: "Quarantine · keep held",
                                            },
                                            {
                                              value: "release",
                                              label:
                                                "Release after physical inspection",
                                            },
                                          ],
                                        },
                                        {
                                          key: "locationId",
                                          label: "Confirmed return location",
                                          required: true,
                                          options: opts("locations"),
                                        },
                                        {
                                          key: "reason",
                                          label: "Inspection evidence & reason",
                                          required: true,
                                          type: "textarea",
                                        },
                                      ],
                                      submit: (v, op) =>
                                        mutate(
                                          "/returns/" + b.id + "/disposition",
                                          { ...v, expectedVersion: b.version },
                                          op,
                                        ),
                                    });
                                  }}
                                >
                                  Inspect return
                                </Button>
                              )}
                            {i.box_id && (
                              <button
                                className="text-button"
                                onClick={() => setDetail(i.box_id)}
                              >
                                View original box <ArrowRight size={15} />
                              </button>
                            )}
                            {i.status === "open" && can("adjust") && (
                              <Button
                                secondary
                                onClick={() =>
                                  open({
                                    title: "Resolve review issue",
                                    description:
                                      "Record the reviewed outcome. This does not adjust stock quantities or release held returns.",
                                    fields: [
                                      {
                                        key: "resolution",
                                        label: "Reviewed resolution",
                                        required: true,
                                        type: "textarea",
                                      },
                                    ],
                                    submit: (v, op) =>
                                      mutate(
                                        "/review-issues/" + i.id + "/resolve",
                                        v,
                                        op,
                                      ),
                                  })
                                }
                              >
                                Record resolution
                              </Button>
                            )}
                          </div>
                        </div>
                        <Badge value={i.status} />
                      </section>
                    ))}
                    </div></div>}
                    {!rows("issues").length && (
                      <Empty
                        title="Review queue is clear"
                        text="Reported exceptions and returned goods appear here."
                      />
                    )}
                  </div>
                  <Traceability
                    key={draftScope(user as any)}
                    actor={user as any}
                    products={rows("products")}
                    locations={rows("locations")}
                    canAdjust={can("adjust")}
                    canReview={can("review")}
                    onSaved={refresh}
                  />
                </>
              )}
              {page === "documents" && (
                <>
                  <div className="notice info">
                    <FileText size={20} />
                    <span>
                      Private originals are retained. Recognition produces unreviewed text only; verify quantities manually. Print box, pallet and location labels from their records.
                    </span>
                  </div>
                  {rows("documents").length > 0 && <div className="orders-workspace"><section className="panel orders-list-panel" aria-label="Documents"><div className="orders-list-header"><div><h2>Documents</h2><p>Select a document to view its original and available review actions.</p></div><span className="order-count">{rows("documents").length} loaded</span></div><label className="orders-search"><Search size={19}/><span className="sr-only">Search documents</span><input type="search" value={documentQuery} onChange={e=>setDocumentQuery(e.target.value)} placeholder="Search document name or type…"/></label><div className="pallet-list-columns" aria-hidden="true"><span>Document</span><span>Type</span><span>Size</span><span>Status</span></div><div>{rows("documents").filter(doc=>[doc.name,doc.mime].some(v=>String(v||"").toLocaleLowerCase().includes(documentQuery.trim().toLocaleLowerCase()))).map(doc=><button type="button" key={doc.id} className={"pallet-list-row "+((selectedDocumentId&&rows("documents").some(x=>x.id===selectedDocumentId)?selectedDocumentId:rows("documents")[0]?.id)===doc.id?"selected":"")} aria-pressed={(selectedDocumentId&&rows("documents").some(x=>x.id===selectedDocumentId)?selectedDocumentId:rows("documents")[0]?.id)===doc.id} onClick={()=>setSelectedDocumentId(doc.id)}><strong>{doc.name}</strong><span>{doc.mime||"Unknown"}</span><span>{doc.size!=null?(doc.size/1024).toFixed(1)+" KB":"Unknown"}</span><span>Original</span><ChevronRight size={16}/></button>)}{!rows("documents").some(doc=>[doc.name,doc.mime].some(v=>String(v||"").toLocaleLowerCase().includes(documentQuery.trim().toLocaleLowerCase())))&&<p className="orders-no-results">No matching documents. Try another search.</p>}</div></section><section className="panel pallet-detail-panel" aria-label="Selected document">
                    {rows("documents").map((doc) => (
                      <div key={doc.id} hidden={doc.id !== (selectedDocumentId && rows("documents").some(x=>x.id===selectedDocumentId) ? selectedDocumentId : rows("documents")[0]?.id)}>
                      <div className="document-row">
                        <FileText size={24} />
                        <div>
                          <strong>{doc.name}</strong>
                          <small>
                            {(doc.size / 1024).toFixed(1)} KB · {doc.mime}
                          </small>
                        </div>
                        <a
                          className="btn secondary"
                          href={"/api/v1/documents/" + doc.id + "/file"}
                          target="_blank"
                        >
                          View original <ArrowUpRight size={16} />
                        </a>
                      </div>
                      {can("receive") && <DocumentRecognition key={draftScope(user as any)+doc.id} actor={user} documentId={doc.id}/>}
                      </div>
                    ))}
                  </section></div>}
                  {!rows("documents").length && <Empty title="No documents uploaded" text="Attach a label photo or source PDF when receiving a box." />}
                </>
              )}
              {page === "settings" && (
                <div className="settings-grid">
                  <ContextPicker session={session.data} onSwitch={switchWorkspace}/>
                  <DraftRecovery scope={draftScope(user as any)}/>
                  {can("manage_access") && <AccessControl actor={user} companyId={user.org_id} onChanged={async()=>{await refresh();await session.refetch();}}/>}
                  {d.configuration && <CompanySetup actor={user} value={d.configuration} canConfigure={can("configure")} onSaved={refresh}/>}
                  <section className="panel entity-card">
                    <h2>Session & access</h2>
                    <dl className="details-list">
                      <div>
                        <dt>Signed in</dt>
                        <dd>{user.name}</dd>
                      </div>
                      <div>
                        <dt>Role</dt>
                        <dd>{user.role}</dd>
                      </div>
                      <div>
                        <dt>Database</dt>
                        <dd>{session.data.database}</dd>
                      </div>
                      <div>
                        <dt>Business timezone</dt>
                        <dd>{d.configuration?.timezone || "Unconfirmed · timestamps shown in UTC"}</dd>
                      </div>
                    </dl>
                    <p>
                      Local drafts are scoped to this staff session and removed
                      on sign-out. Authoritative records remain on the server.
                    </p>
                    <Button
                      secondary
                      onClick={() => void signOut(user)}
                    >
                      <LogOut size={17} /> Sign out & clear device drafts
                    </Button>
                  </section>
                  <section className="panel entity-card">
                    <h2>Integrations & sync</h2>
                    {[
                      "OCR · See Documents for provider status",
                      "Barcode decoder · Manual ID entry",
                      "Label export · Browser print",
                      "Routing · Manual stop order",
                      "Offline · Device drafts only",
                      "Storage · Private local adapter",
                    ].map((x) => (
                      <div className="setting-row" key={x}>
                        {x}
                        <Badge>Explicit</Badge>
                      </div>
                    ))}
                  </section>
                  {user.role !== "driver" && (
                    <>
                      <section className="panel entity-card">
                        <div className="section-head">
                          <h2>Tracking mark definitions</h2>
                          {can("adjust") && (
                            <button
                              className="icon-button"
                              aria-label="Add tracking mark"
                              onClick={() => catalog("tracking_marks")}
                            >
                              <Plus size={19} />
                            </button>
                          )}
                        </div>
                        {rows("marks").map((m) => (
                          <div className="soft-item" key={m.id}>
                            <strong>{m.symbol}</strong>
                            <small>{m.meaning || "Meaning unconfirmed"}</small>
                            <small>
                              {m.scope} · v{m.version}
                            </small>
                          </div>
                        ))}
                      </section>
                      <section className="panel entity-card">
                        <h2>Staff · proposed role policy</h2>
                        {rows("users").map((u) => (
                          <div className="setting-row" key={u.id}>
                            <span>
                              {u.name}
                              <small>{u.email}</small>
                            </span>
                            <Badge>{u.role}</Badge>
                          </div>
                        ))}
                        <p>
                          Manage company roles and warehouse grants in Staff & warehouse access above. New staff identities still require trusted provisioning.
                        </p>
                      </section>
                      <section className="panel entity-card">
                        <h2>Exports & worker</h2>
                        {can("export") && (
                          <Button
                            secondary
                            onClick={() =>
                              open({
                                title: "Queue inventory export",
                                description:
                                  "A background job produces a server-confirmed inventory snapshot.",
                                fields: [],
                                submit: (_, op) =>
                                  mutate(
                                    "/jobs",
                                    { kind: "inventory-export" },
                                    op,
                                  ),
                              })
                            }
                          >
                            <Download size={17} /> Queue export
                          </Button>
                        )}
                        {rows("jobs").map((j) => (
                          <div className="setting-row" key={j.id}>
                            <span>
                              {j.kind}
                              <small>Attempts: {j.attempts}</small>
                            </span>
                            <Badge value={j.status} />
                            {j.status === "completed" && (
                              <a
                                href={"/api/v1/jobs/" + j.id + "/result"}
                                target="_blank"
                              >
                                Open JSON
                              </a>
                            )}
                            {j.error && <small>{j.error}</small>}
                          </div>
                        ))}
                      </section>
                    </>
                  )}
                </div>
              )}
              {page === "portal" && (
                <PortalView user={user} />
              )}
            </>
          )}
          <footer className="app-footer">
            <span>
              {d.configuration?.display_name || "Warehouse operations"} <span>·</span> Internal operations
            </span>
            <span>
              Business timezone: {d.configuration?.timezone || "Unconfirmed · UTC display"} <span>·</span>{" "}
              {d.demo ? "Synthetic demo" : "Authorized staff only"}
            </span>
          </footer>
        </main>
      </div>
      <nav className="bottom-nav">
        {[
          ["overview", "Tasks", LayoutDashboard],
          ["receive", "Scan", ScanLine],
          ["boxes", "Find", Search],
          ["dispatch", "Outbound", Truck],
          ["settings", "More", MoreHorizontal],
        ].map(([p, t, Icon]: any) => (
          <button
            key={p}
            className={page === p ? "active" : ""}
            onClick={() => go(p)}
          >
            <Icon size={21} />
            <span>{t}</span>
          </button>
        ))}
      </nav>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
        </div>
      )}
      {dialog && (
        <TaskDialog key={draftScope(user as any)}
          spec={dialog}
          user={user}
          close={() => setDialog(null)}
          onSaved={() => setToast("Saved · confirmed by server")}
        />
      )}{" "}
      {detail && (
        <BoxDetail
          id={detail}
          data={d}
          can={can}
          close={() => setDetail(null)}
          onMove={move}
          onReport={report}
          onRefresh={refresh}
          open={open}
          mutate={mutate}
        />
      )}
    </div>
  );
}
function fmt(value: any) {
  if (value === null || value === undefined) return "Unknown";
  const [whole, fraction] = new Decimal(value).toFixed().split(".");
  return (
    BigInt(whole).toLocaleString("en-GB") + (fraction ? "." + fraction : "")
  );
}
function remaining(line: Row) {
  return new Decimal(line.quantity)
    .minus(line.delivered)
    .minus(line.returned)
    .toFixed();
}
function dateLabel(value: any, config?:Row) {
  const str = (
    value instanceof Date ? value.toISOString() : String(value)
  ).slice(0, 10);
  if(config?.date_format === "iso") return str;
  return new Date(str + "T12:00:00Z").toLocaleDateString(config?.language === "zh" ? "zh-CN" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
function Login({ data, onLogin }: { data: Row; onLogin: () => Promise<void> }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<any>(null);
  async function submit(body: Row, demo = false) {
    setBusy(true);
    setError(null);
    try {
      await api("/auth/" + (demo ? "demo" : "login"), body);
      await onLogin();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-screen">
      <section className="login-story">
        <a className="brand" href="#">
          <span className="brand-icon">
            <Boxes size={26} />
          </span>
          <span>
            Warehouse<small>OPERATIONS</small>
          </span>
        </a>
        <div>
          <span className="eyebrow">FROM RECEIVING TO HANDOVER</span>
          <h1>
            Every box.
            <br />A clear next step.
          </h1>
          <p>
            Receive with confidence. Prepare by date.
            <br />
            Keep the whole warehouse in view.
          </p>
          <div className="login-steps">
            {[
              [Package, "Receive & identify"],
              [Layers, "Pack & check"],
              [Truck, "Dispatch & trace"],
            ].map(([Icon, t]: any) => (
              <span key={t}>
                <Icon size={24} />
                {t}
              </span>
            ))}
          </div>
        </div>
        <small>Warehouse operations · Staff workspace</small>
      </section>
      <section className="login-main">
        <div className="login-card">
          <span className="eyebrow">STAFF WORKSPACE</span>
          <h1>Welcome to your warehouse</h1>
          <p>Sign in to your warehouse workspace.</p>
          {error && <ErrorNotice error={error} />}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit({ email, password });
            }}
          >
            <label className="field">
              <span>Email address</span>
              <input
                autoComplete="username"
                type="email"
                value={email}
                required
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                autoComplete="current-password"
                type="password"
                value={password}
                required
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <ArrowRight size={18} />
              )}{" "}
              Sign in
            </Button>
          </form>
          {data.demo && (
            <div className="demo-login">
              <Badge>SYNTHETIC DEMO</Badge>
              <h3>Explore the working warehouse</h3>
              <p>
                Sample records only. No password is required for the isolated
                development demo.
              </p>
              <Button
                disabled={busy}
                onClick={() => void submit({ userId: "demo-admin" }, true)}
              >
                Enter demo workspace <ArrowRight size={17} />
              </Button>
              <div className="demo-roles">
                {[
                  ["demo-operator", "Operator"],
                  ["demo-reviewer", "Reviewer"],
                  ["demo-driver", "Driver"],
                ].map(([id, name]) => (
                  <button
                    disabled={busy}
                    key={id}
                    onClick={() => void submit({ userId: id }, true)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <CreatorCredit />
          <p className="login-foot">
            <ShieldCheck size={16} /> Private documents · Traceable actions
          </p>
        </div>
      </section>
    </div>
  );
}
const pendingForms = new Map<string, { values: Row; operation: string }>();
function TaskDialog({
  spec,
  user,
  close,
  onSaved,
}: {
  spec: DialogSpec;
  user: Row;
  close: () => void;
  onSaved: () => void;
}) {
  const instanceId = useRef(newOperation()).current;
  const taskKey =
    draftScope(user as any) +
    ":" +
    spec.title +
    ":" +
    (spec.contextId || spec.draftKey || instanceId);
  const ref = useRef<HTMLDialogElement>(null);
  const [values, setValues] = useState<Row>(() => ({
    ...Object.fromEntries(
      spec.fields.map((f) => [
        f.key,
        f.value ??
          (f.type === "checkbox" ? false : f.type === "multiselect" ? [] : ""),
      ]),
    ),
    ...spec.initial,
    ...pendingForms.get(taskKey)?.values,
  }));
  const [operation, setOperation] = useState(
      () => pendingForms.get(taskKey)?.operation || newOperation(),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<any>(null),
    [draftStatus, setDraftStatus] = useState("");
  useEffect(()=>registerPendingCapture(()=>saveWork(user,"pending-task:"+taskKey,{title:spec.title,contextId:spec.contextId||null,values,operation})),[values,operation,taskKey,user.id,user.org_id,user.warehouse_id]);
  useEffect(() => {
    ref.current?.showModal();
    const dialog = ref.current;
    const cancel = (e: Event) => {
      if (busy) e.preventDefault();
      else close();
    };
    dialog?.addEventListener("cancel", cancel);
    return () => dialog?.removeEventListener("cancel", cancel);
  }, [close, busy]);
  useEffect(() => {
    pendingForms.set(taskKey, { values, operation });
  }, [taskKey, values, operation]);
  useEffect(
    () => () => {
      if (!spec.contextId && !spec.draftKey) pendingForms.delete(taskKey);
    },
    [taskKey],
  );
  async function save() {
    try {
      await saveWork(user, spec.draftKey!, {
        values,
        operation,
        title: spec.title,
      });
      setDraftStatus("Saved on this device · not synced");
    } catch {
      setError(
        new Error(
          "Device storage could not save this draft. Keep the form open and retry.",
        ),
      );
    }
  }
  return (
    <dialog ref={ref} className="task-dialog">
      <div className="dialog-header">
        <div>
          <span className="eyebrow">WAREHOUSE TASK</span>
          <h2>{spec.title}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close task"
          disabled={busy}
          onClick={close}
        >
          <X size={21} />
        </button>
      </div>
      {spec.description && (
        <p className="dialog-description">{spec.description}</p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            if (spec.draftKey) await save();
            const result = await spec.submit(values, operation);
            pendingForms.delete(taskKey);
            await deleteWork(user,"pending-task:"+taskKey);
            if (spec.draftKey) await deleteWork(user, spec.draftKey);
            spec.after?.(result);
            onSaved();
            close();
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <ErrorNotice error={error} />}
        <div className="dialog-fields">
          {spec.fields.map((f) =>
            f.type === "checkbox" ? (
              <label className="checkbox-field" key={f.key}>
                <input
                  type="checkbox"
                  checked={!!values[f.key]}
                  onChange={(e) =>
                    setValues({ ...values, [f.key]: e.target.checked })
                  }
                />
                <span>{f.label}</span>
              </label>
            ) : f.type === "multiselect" ? (
              <fieldset className="multi-field" key={f.key}>
                <legend>{f.label}</legend>
                {f.options?.length ? (
                  f.options.map((o) => (
                    <label className="checkbox-field" key={o.value}>
                      <input
                        type="checkbox"
                        checked={values[f.key]?.includes(o.value)}
                        onChange={(e) =>
                          setValues({
                            ...values,
                            [f.key]: e.target.checked
                              ? [...values[f.key], o.value]
                              : values[f.key].filter(
                                  (v: string) => v !== o.value,
                                ),
                          })
                        }
                      />
                      <span>{o.label}</span>
                    </label>
                  ))
                ) : (
                  <p>
                    No eligible records. Complete the previous workflow first.
                  </p>
                )}
              </fieldset>
            ) : f.type === "signature" ? (
              <SmartSignaturePad
                key={f.key}
                label={f.label}
                required={f.required}
                value={values[f.key] || ""}
                hint={f.hint}
                onChange={(v) => setValues({ ...values, [f.key]: v })}
              />
            ) : f.options ? (
              <SmartCombobox
                key={f.key}
                label={f.label}
                options={f.options}
                required={f.required}
                value={values[f.key]}
                hint={f.hint}
                onChange={(v) => setValues({ ...values, [f.key]: v })}
              />
            ) : f.type === "number" ? (
              <SmartQuantityInput
                key={f.key}
                label={f.label}
                required={f.required}
                value={values[f.key] || ""}
                hint={f.hint}
                placeholder="0.00"
                onChange={(v) => setValues({ ...values, [f.key]: v })}
              />
            ) : (
              <label className="field" key={f.key}>
                <span>{f.label}</span>
                {f.type === "textarea" ? (
                  <textarea
                    value={values[f.key]}
                    required={f.required}
                    onChange={(e) =>
                      setValues({ ...values, [f.key]: e.target.value })
                    }
                  />
                ) : (
                  <input
                    type={f.type || "text"}
                    required={f.required}
                    value={values[f.key]}
                    onChange={(e) =>
                      setValues({ ...values, [f.key]: e.target.value })
                    }
                  />
                )}{" "}
                {f.hint && <small>{f.hint}</small>}
              </label>
            ),
          )}
        </div>
        {spec.renderExtra && spec.renderExtra(values)}
        {spec.draftKey && (
          <div className="draft-tools">
            <button
              className="text-button"
              type="button"
              onClick={() => void save()}
            >
              Save on this device
            </button>
            <button
              className="text-button"
              type="button"
              onClick={async () => {
                const saved = await getWork(user, spec.draftKey!);
                if (saved) {
                  setValues(saved.values);
                  setOperation(saved.operation);
                  setDraftStatus("Device draft restored · not synced");
                } else setDraftStatus("No saved draft on this device");
              }}
            >
              Restore device draft
            </button>
            <small role="status">{draftStatus}</small>
          </div>
        )}
        {error?.status === 409 && (
          <p className="conflict-help">
            Your values remain here. Close this task to inspect refreshed
            records, then retry with the current version. No pending input was
            discarded automatically.
          </p>
        )}
        <div className="dialog-footer">
          <Button secondary disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={
              busy ||
              spec.fields.some(
                (f) =>
                  f.required &&
                  f.type === "multiselect" &&
                  !values[f.key]?.length,
              )
            }
          >
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <Check size={17} />
            )}{" "}
            {busy
              ? "Confirming with server…"
              : spec.submitLabel || "Confirm & save"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
function Receipt({
  data,
  user,
  onCreated,
}: {
  data: Row;
  user: Row;
  onCreated: (b: Row) => Promise<void>;
}) {
  const products: Row[] = data.products || [],
    locations: Row[] = data.locations || [],
    customers: Row[] = data.customers || [];
  const customerOptions = customers.map((c) => ({
    value: c.id,
    label: c.code + " · " + c.name,
  }));
  const locationOptions = locations.map((l) => ({
    value: l.id,
    label: l.code + " · " + l.name,
    badge: l.kind,
  }));
  const productOptions = products.map((p) => ({
    value: p.id,
    label: p.sku + " · " + p.name,
    sublabel: p.name_zh ? `${p.name_zh} · Unit: ${p.unit}` : `Unit: ${p.unit}`,
    badge: p.profile,
  }));
  const fresh = () => ({
    clientOperationId: newOperation(),
    customerId: "",
    locationId: "",
    sourceLabel: "",
    condition: "",
    lines: [{ productId: "", quantity: "", verified: false }],
  });
  const [v, setV] = useState<any>(fresh),
    [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<any>(null),
    [draft, setDraft] = useState(""),
    [received, setReceived] = useState<Row | null>(null);
  useEffect(() => {
    if (file && file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      setPreview(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreview("");
  }, [file]);
  useEffect(()=>registerPendingCapture(async()=>{
    if(v.locationId||v.customerId||v.sourceLabel||v.lines.some((l:any)=>l.productId||l.quantity)||file||received)
      await saveWork(user,"receipt",{values:v,file,received});
  }),[v,file,received,user.id,user.org_id,user.warehouse_id]);
  async function save() {
    await saveWork(user, "receipt", { values: v, file, received });
    const estimate = await navigator.storage?.estimate?.();
    setDraft(
      estimate?.quota && estimate.usage && estimate.usage / estimate.quota > 0.9
        ? "Saved on this device · storage nearly full. Sync or remove unneeded photos."
        : "Saved on this device · not synced",
    );
  }
  async function restore() {
    try {
      const saved = await getWork(user, "receipt");
      if (saved) {
        setV(saved.values);
        setFile(saved.file || null);
        setReceived(saved.received || null);
        setDraft("Device draft restored · review before submitting");
      } else setDraft("No saved receipt draft");
    } catch {
      setError(new Error("Device draft could not be read"));
    }
  }
  async function uploadPhoto(box: Row) {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    fd.set("clientOperationId", v.clientOperationId);
    await api("/boxes/" + box.id + "/photo", fd);
  }

  const selectedLocation = locations.find((l) => l.id === v.locationId);
  const receiptLineProducts = v.lines
    .map((l: any) => products.find((p) => p.id === l.productId))
    .filter(Boolean);
  const receiptEnvCheck = checkEnvironmentalCompatibility(receiptLineProducts, selectedLocation);

  return (
    <div className="receive-layout">
      <section className="panel receive-form">
        <div className="section-head">
          <div>
            <span className="step-pill">01</span>
            <h2>Identify & receive a box</h2>
          </div>
          <Badge>Manual entry</Badge>
        </div>
        <div className="notice info compact">
          <ScanLine size={19} />
          <span>
            Capture a photo with your device or enter the label manually.
            Barcode decoding is unconfigured; document recognition availability is shown in Documents.
          </span>
        </div>
        {error && <ErrorNotice error={error} />}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            let b = received;
            try {
              await save();
              if (!b) {
                b = await api("/receipts", {
                  clientOperationId: v.clientOperationId,
                  customerId: v.customerId || null,
                  locationId: v.locationId,
                  sourceLabel: v.sourceLabel,
                  condition: v.condition,
                  contents: v.contentsUnknown
                    ? []
                    : v.lines.map((l: any) => ({
                        productId: l.productId,
                        quantity: l.quantity || null,
                        verified: !!l.verified,
                        unit: products.find((p) => p.id === l.productId)?.unit,
                        lotId: l.lotId || undefined,
                        temperatureC: l.temperatureC || null,
                      })),
                });
                setReceived(b);
                await saveWork(user, "receipt", {
                  values: v,
                  file,
                  received: b,
                });
              }
              await uploadPhoto(b!);
              await deleteWork(user, "receipt");
              setV(fresh());
              setFile(null);
              setReceived(null);
              setDraft("Synced · server confirmed");
              playScanFeedback(true);
              await onCreated(b!);
            } catch (err) {
              setError(err);
              if (b) {
                setDraft(
                  "Box saved on server · photo needs attention. Retry to attach it without creating another box.",
                );
                await saveWork(user, "receipt", {
                  values: v,
                  file,
                  received: b,
                }).catch(() => {});
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-grid">
            <SmartCombobox
              label="Ordering customer · if known"
              placeholder="Search or select customer…"
              value={v.customerId}
              onChange={(x) => setV({ ...v, customerId: x })}
              options={customerOptions}
            />
            <SmartCombobox
              label="Confirmed physical location"
              placeholder="Search bay / rack location…"
              value={v.locationId}
              onChange={(x) => setV({ ...v, locationId: x })}
              required
              options={locationOptions}
            />
          </div>
          {!receiptEnvCheck.isCompatible && v.locationId && (
            <EnvironmentalWarningBadge warning={receiptEnvCheck.warning!} />
          )}
          <label className="field">
            <span>Printed label / reference · original source text</span>
            <textarea
              value={v.sourceLabel}
              onChange={(e) => setV({ ...v, sourceLabel: e.target.value })}
              placeholder="Preserve the original text, symbols and quantity exactly…"
            />
          </label>
          <Select
            label="Physical condition"
            value={v.condition}
            onChange={(x) => setV({ ...v, condition: x })}
            required
            options={[
              { value: "good", label: "Good condition" },
              { value: "damaged", label: "Damaged · hold for review" },
              { value: "hold", label: "Unconfirmed condition · hold" },
            ]}
          />
          <div className="contents-heading">
            <span className="step-pill">02</span>
            <h2>Review contents</h2>
          </div>
          <p className="muted">
            Unknown contents are allowed. Tick verified only after a physical
            check.
          </p>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={!!v.contentsUnknown}
              onChange={(e) =>
                setV({ ...v, contentsUnknown: e.target.checked })
              }
            />
            Contents are not identified yet · receive for review
          </label>
          {!v.contentsUnknown && (
            <>
              {" "}
              {v.lines.map((l: any, index: number) => (
                <div className="contents-input" key={index}>
                  <SmartCombobox
                    label={"Product · line " + (index + 1)}
                    placeholder="Search SKU or product name…"
                    value={l.productId}
                    required
                    options={productOptions}
                    onChange={(x) =>
                      setV({
                        ...v,
                        lines: v.lines.map((old: any, i: number) =>
                          i === index
                            ? { ...old, productId: x, verified: false }
                            : old,
                        ),
                      })
                    }
                  />
                  {(data.lots || []).some(
                    (lot: Row) => lot.product_id === l.productId,
                  ) && (
                    <Select
                      label="Verified batch / lot · if applicable"
                      value={l.lotId || ""}
                      options={(data.lots || [])
                        .filter((lot: Row) => lot.product_id === l.productId)
                        .map((lot: Row) => ({
                          value: lot.id,
                          label: lot.reference,
                        }))}
                      onChange={(value) =>
                        setV({
                          ...v,
                          lines: v.lines.map((old: any, i: number) =>
                            i === index ? { ...old, lotId: value } : old,
                          ),
                        })
                      }
                    />
                  )}
                  <label className="field">
                    <span>Measured temperature °C · when applicable</span>
                    <input
                      value={l.temperatureC || ""}
                      onChange={(e) =>
                        setV({
                          ...v,
                          lines: v.lines.map((old: any, i: number) =>
                            i === index
                              ? { ...old, temperatureC: e.target.value }
                              : old,
                          ),
                        })
                      }
                      placeholder="Unconfirmed"
                    />
                    <small>
                      Only enter an actual measurement. Product-specific
                      requirements are configured in Products.
                    </small>
                  </label>
                  <div className="quantity-input" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <SmartQuantityInput
                      label="Quantity"
                      unit={products.find((p) => p.id === l.productId)?.unit}
                      value={l.quantity || ""}
                      placeholder="0.00"
                      onChange={(val) =>
                        setV({
                          ...v,
                          lines: v.lines.map((old: any, i: number) =>
                            i === index
                              ? {
                                  ...old,
                                  quantity: val,
                                  verified: val ? old.verified : false,
                                }
                              : old,
                          ),
                        })
                      }
                    />
                    <label className="checkbox-field" style={{ alignSelf: "flex-start", marginTop: "4px" }}>
                      <input
                        type="checkbox"
                        disabled={!l.quantity}
                        checked={l.verified}
                        onChange={(e) =>
                          setV({
                            ...v,
                            lines: v.lines.map((old: any, i: number) =>
                              i === index
                                ? { ...old, verified: e.target.checked }
                                : old,
                            ),
                          })
                        }
                      />{" "}
                      Physically verified
                    </label>
                  </div>
                  {v.lines.length > 1 && (
                    <button
                      type="button"
                      className="text-button danger"
                      onClick={() =>
                        setV({
                          ...v,
                          lines: v.lines.filter(
                            (_: any, i: number) => i !== index,
                          ),
                        })
                      }
                    >
                      Remove line
                    </button>
                  )}
                </div>
              ))}
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  setV({
                    ...v,
                    lines: [
                      ...v.lines,
                      { productId: "", quantity: "", verified: false },
                    ],
                  })
                }
              >
                <Plus size={16} /> Add contents line
              </button>
            </>
          )}
          <div className="form-bottom">
            <div>
              <ShieldCheck size={18} />
              <span>A unique internal box ID is created by the server.</span>
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <Check size={18} />
              )}{" "}
              {busy
                ? "Confirming…"
                : received
                  ? "Retry photo attachment"
                  : "Confirm & receive box"}
            </Button>
          </div>
        </form>
      </section>
      <aside className="receive-side">
        <section className="panel entity-card">
          <div className="section-head">
            <h2>Original label evidence</h2>
            <Camera size={20} />
          </div>
          <label className="upload-zone">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              capture="environment"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setError(null);
              }}
            />
            {preview ? (
              <img src={preview} alt="Original label preview" />
            ) : (
              <>
                <Camera size={36} />
                <strong>Capture or upload a label</strong>
                <span>JPEG, PNG, WebP or PDF · up to 8 MB</span>
              </>
            )}
          </label>
          {file && (
            <div className="file-choice">
              <span>{file.name}</span>
              <button className="text-button" onClick={() => setFile(null)}>
                Retake / remove
              </button>
            </div>
          )}
          <p>
            Camera denied or unavailable? Use your device’s file chooser, or
            receive manually and attach evidence later.
          </p>
        </section>
        <section className="panel entity-card draft-card">
          <h3>
            <Archive size={18} /> Device draft
          </h3>
          <p>
            Save before leaving. A local draft has not changed shared warehouse
            stock.
          </p>
          <div className="card-actions">
            <Button
              secondary
              onClick={() =>
                void save().catch(() =>
                  setError(
                    new Error(
                      "Draft save failed: device storage may be full. Keep this form open.",
                    ),
                  ),
                )
              }
            >
              Save draft
            </Button>
            <button className="text-button" onClick={() => void restore()}>
              Restore draft
            </button>
          </div>
          {draft && (
            <p className="draft-status" role="status">
              {draft}
            </p>
          )}
        </section>
        <div className="receipt-hint">
          <ShieldCheck size={21} />
          <div>
            <strong>Identity before quantity</strong>
            <p>
              Customer codes identify businesses. Every physical box gets its
              own stable internal ID.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}
function BoxDetail({
  id,
  data,
  can,
  close,
  onMove,
  onReport,
  onRefresh,
  open,
  mutate,
}: {
  id: string;
  data: Row;
  can: (p: string) => boolean;
  close: () => void;
  onMove: (b: Row) => void;
  onReport: (id: string) => void;
  onRefresh: () => Promise<void>;
  open: (s: DialogSpec) => void;
  mutate: (url: string, body: Row, op?: string) => Promise<any>;
}) {
  const q = useQuery({
    queryKey: ["box", data.configuration?.org_id,data.warehouse?.id,id],
    queryFn: () => api("/boxes/" + id),
    retry: 1,
  });
  const ref = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<any>(null),
    [uploading, setUploading] = useState(false),
    [uploadStatus, setUploadStatus] = useState("");
  const uploadOp = useRef(newOperation());
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const b = q.data;
  return (
    <dialog ref={ref} className="box-drawer" onCancel={close}>
      <div className="dialog-header">
        <span className="eyebrow">PHYSICAL BOX RECORD</span>
        <button
          className="icon-button"
          aria-label="Close box details"
          onClick={close}
        >
          <X size={22} />
        </button>
      </div>
      {q.isPending ? (
        <div className="loading">Loading box…</div>
      ) : q.isError ? (
        <ErrorNotice error={q.error} />
      ) : (
        b && (
          <>
            <div className="drawer-title">
              <span className="entity-icon">
                <Package size={30} />
              </span>
              <h1>{b.code}</h1>
              <Badge value={b.status} />
              <p>{b.customer_name || "Customer not assigned"}</p>
            </div>
            <div className="drawer-content">
              <section className="detail-section">
                <h2>Location & membership</h2>
                <dl className="details-list">
                  <div>
                    <dt>Effective location</dt>
                    <dd>{b.location_code || "Unknown"}</dd>
                  </div>
                  <div>
                    <dt>Pallet</dt>
                    <dd>{b.pallet_code || "Standalone box"}</dd>
                  </div>
                  <div>
                    <dt>Condition</dt>
                    <dd>{b.condition}</dd>
                  </div>
                  <div>
                    <dt>Version</dt>
                    <dd>{b.version}</dd>
                  </div>
                </dl>
                <div className="card-actions">
                  {can("move") && !b.pallet_id && (
                    <Button secondary onClick={() => onMove(b)}>
                      <MoveRight size={17} /> Move box
                    </Button>
                  )}
                  {can("adjust") &&
                    !["dispatched", "delivered", "returned"].includes(
                      b.status,
                    ) && (
                      <Button
                        secondary
                        onClick={() =>
                          open({
                            title: "Record condition inspection",
                            description:
                              "Record an explicit inspection outcome. The event and reason remain in the audit history.",
                            fields: [
                              {
                                key: "condition",
                                label: "Verified physical condition",
                                required: true,
                                options: [
                                  {
                                    value: "good",
                                    label: "Good · release after inspection",
                                  },
                                  { value: "damaged", label: "Damaged · hold" },
                                  {
                                    value: "hold",
                                    label: "Unconfirmed · hold",
                                  },
                                ],
                              },
                              {
                                key: "reason",
                                label: "Inspection reason / evidence",
                                required: true,
                                type: "textarea",
                              },
                            ],
                            submit: (v, op) =>
                              mutate(
                                "/boxes/" + id + "/condition",
                                { ...v, expectedVersion: b.version },
                                op,
                              ),
                          })
                        }
                      >
                        Inspect condition
                      </Button>
                    )}
                  <a
                    className="btn secondary"
                    target="_blank"
                    href={"/api/v1/labels/box/" + id}
                  >
                    <Printer size={17} /> Print label
                  </a>
                </div>
              </section>
              <section className="detail-section">
                <h2>Contents & verified quantities</h2>
                {b.contents.map((c: Row) => (
                  <div className="detail-contents" key={c.id}>
                    <div className="eyebrow">PRODUCT SKU · {c.sku}</div>
                    <h3>{c.name}</h3>
                    <p>{c.name_zh}</p>
                    <p>
                      Batch:{" "}
                      {(data.lots || []).find((l: Row) => l.id === c.lot_id)
                        ?.reference || "Unconfirmed"}{" "}
                      · Measured temperature:{" "}
                      {c.temperature_c === null || c.temperature_c === undefined
                        ? "Unconfirmed"
                        : fmt(c.temperature_c) + " °C"}
                    </p>
                    <div>
                      <strong>
                        {c.quantity === null
                          ? "Unconfirmed"
                          : fmt(c.quantity) + " " + c.unit}
                      </strong>
                      <Badge value={c.verified ? "confirmed" : "unconfirmed"} />
                    </div>
                  </div>
                ))}
                {can("receive") &&
                  b.contents.length === 0 &&
                  b.status !== "empty" && (
                    <Button
                      secondary
                      onClick={() =>
                        open({
                          title: "Identify unknown contents",
                          description:
                            "This box exists physically. Record verified product information without guessing its quantity.",
                          fields: [
                            {
                              key: "productId",
                              label: "Identified product",
                              required: true,
                              options: (data.products || []).map((p: Row) => ({
                                value: p.id,
                                label: p.sku + " · " + p.name,
                              })),
                            },
                            {
                              key: "quantity",
                              label:
                                "Quantity in product base unit · leave blank if unconfirmed",
                              type: "number",
                            },
                            {
                              key: "verified",
                              label: "Quantity physically verified",
                              type: "checkbox",
                            },
                            {
                              key: "reason",
                              label: "Identification source / reason",
                              required: true,
                            },
                          ],
                          submit: (v, op) =>
                            mutate(
                              "/boxes/" + id + "/confirm-label",
                              {
                                expectedVersion: b.version,
                                reason: v.reason,
                                contents: [
                                  {
                                    productId: v.productId,
                                    quantity: v.quantity || null,
                                    unit: data.products?.find(
                                      (p: Row) => p.id === v.productId,
                                    )?.unit,
                                    verified: !!v.verified,
                                  },
                                ],
                              },
                              op,
                            ),
                        })
                      }
                    >
                      Identify contents
                    </Button>
                  )}
                {b.traceabilityProblems?.length > 0 && (
                  <div className="notice warning">
                    <AlertTriangle size={18} />
                    <div>
                      {b.traceabilityProblems.map((problem: string) => (
                        <p key={problem}>{problem}</p>
                      ))}
                    </div>
                  </div>
                )}
                {can("receive") && b.contents.length > 0 && (
                  <Button
                    secondary
                    onClick={() =>
                      open({
                        title: "Review and confirm contents",
                        description:
                          "Every existing contents line is preserved. Verified quantity corrections need supervisor permission and a reason.",
                        fields: [
                          ...b.contents.flatMap((c: Row, i: number) => [
                            {
                              key: "quantity_" + i,
                              label: c.name + " · quantity (" + c.unit + ")",
                              type: "number",
                              value: c.quantity || "",
                            },
                            {
                              key: "verified_" + i,
                              label: "Line " + (i + 1) + " physically verified",
                              type: "checkbox",
                              value: c.verified,
                            },
                            {
                              key: "lot_" + i,
                              label:
                                "Line " + (i + 1) + " · verified batch / lot",
                              options: (data.lots || [])
                                .filter(
                                  (l: Row) => l.product_id === c.product_id,
                                )
                                .map((l: Row) => ({
                                  value: l.id,
                                  label: l.reference,
                                })),
                              value: c.lot_id || "",
                            },
                            {
                              key: "temperature_" + i,
                              label:
                                "Line " +
                                (i + 1) +
                                " · measured temperature °C",
                              value: c.temperature_c ?? "",
                            },
                          ]),
                          {
                            key: "reason",
                            label: "Verification / correction reason",
                            required: true,
                          },
                        ],
                        submit: (v, op) =>
                          mutate(
                            "/boxes/" + id + "/confirm-label",
                            {
                              expectedVersion: b.version,
                              reason: v.reason,
                              contents: b.contents.map((c: Row, i: number) => ({
                                productId: c.product_id,
                                quantity: v["quantity_" + i] || null,
                                unit: c.unit,
                                verified: !!v["verified_" + i],
                                lotId: v["lot_" + i] || undefined,
                                temperatureC: v["temperature_" + i] || null,
                              })),
                            },
                            op,
                          ),
                      })
                    }
                  >
                    <CheckCheck size={17} /> Review / confirm all contents
                  </Button>
                )}
                {can("pack") && b.contents.length === 1 && (
                  <button
                    className="text-button"
                    onClick={() =>
                      open({
                        title: "Repack into a new box",
                        description:
                          "Verified quantity is conserved. The source retains the remainder; the new box gets its own identity.",
                        fields: [
                          {
                            key: "quantity",
                            label:
                              "Quantity for new box (" +
                              b.contents[0].unit +
                              ")",
                            type: "number",
                            required: true,
                          },
                          {
                            key: "locationId",
                            label: "New box location",
                            required: true,
                            options: (data.locations || []).map((l: Row) => ({
                              value: l.id,
                              label: l.code,
                            })),
                          },
                          {
                            key: "reason",
                            label: "Repacking reason",
                            required: true,
                          },
                        ],
                        submit: (v, op) =>
                          mutate(
                            "/boxes/" + id + "/repack",
                            {
                              ...v,
                              contentsId: b.contents[0].id,
                              expectedVersion: b.version,
                            },
                            op,
                          ),
                      })
                    }
                  >
                    Split / repack box <ArrowRight size={15} />
                  </button>
                )}
              </section>
              <section className="detail-section">
                <h2>Original evidence</h2>
                <div className="source-label">
                  {b.source_label || "No source label text recorded"}
                </div>
                {b.documents.map((doc: Row) => (
                  <a
                    className="photo-link"
                    href={"/api/v1/documents/" + doc.id + "/file"}
                    target="_blank"
                    key={doc.id}
                  >
                    {doc.mime.startsWith("image/") && (
                      <img
                        src={"/api/v1/documents/" + doc.id + "/file"}
                        alt={"Source evidence: " + doc.name}
                      />
                    )}
                    <span>
                      <FileText size={16} />
                      {doc.name}
                      <ArrowUpRight size={15} />
                    </span>
                  </a>
                ))}
                {uploadError && <ErrorNotice error={uploadError} />}
                <input
                  type="file"
                  ref={fileRef}
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="file-picker"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setUploading(true);
                    setUploadError(null);
                    const fd = new FormData();
                    fd.set("file", f);
                    fd.set("clientOperationId", uploadOp.current);
                    try {
                      await api("/boxes/" + id + "/photo", fd);
                      uploadOp.current = newOperation();
                      await onRefresh();
                      setUploadStatus("Photo attached · server confirmed");
                    } catch (err) {
                      setUploadError(err);
                    } finally {
                      setUploading(false);
                    }
                  }}
                />
                {can("receive") && (
                  <Button
                    secondary
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                  >
                    <Upload size={17} />
                    {uploading ? "Uploading…" : "Attach / retry photo"}
                  </Button>
                )}
                {uploadStatus && <p role="status">{uploadStatus}</p>}
              </section>
              <section className="detail-section">
                <div className="section-head">
                  <h2>Movement & event history</h2>
                  {can("review") && (
                    <button
                      className="text-button"
                      onClick={() => onReport(id)}
                    >
                      Report issue
                    </button>
                  )}
                </div>
                <div className="timeline">
                  {b.events.map((e: Row) => (
                    <div key={e.id}>
                      <span />
                      <div>
                        <strong>
                          {e.kind.replaceAll(".", " · ").replaceAll("_", " ")}
                        </strong>
                        <small>
                          {e.actor_name} ·{" "}
                          {new Date(e.created_at).toLocaleString("en-GB", {
                            timeZone: data.configuration?.timezone || "UTC",
                          })}
                        </small>
                        {e.data.reason && <p>{e.data.reason}</p>}
                        <small>
                          {e.data.to
                            ? "Destination: " +
                              (data.locations?.find(
                                (l: Row) => l.id === e.data.to,
                              )?.code || e.data.to)
                            : e.data.note || ""}
                        </small>
                      </div>
                    </div>
                  ))}
                  {!b.events.length && (
                    <p>Opening synthetic stock · no movements yet.</p>
                  )}
                </div>
              </section>
            </div>
          </>
        )
      )}
    </dialog>
  );
}
function Preparation({
  data,
  onAdvance,
  onAllocate,
  canPrepare,
  onCarry,
  onEditBatch,
}: {
  data: Row;
  onAdvance: (o: Row, p: Row) => void;
  onAllocate: (o: Row) => void;
  canPrepare: boolean;
  onCarry: (b: Row) => void;
  onEditBatch: (b: Row, remove: boolean) => void;
}) {
  const batches: Row[] = data.preparations || [];
  const [selected, setSelected] = useState("");
  const [selectedOrder, setSelectedOrder] = useState("");
  const [query, setQuery] = useState("");
  const current = batches.find((b) => b.id === selected) || batches[0];
  if (!current)
    return (
      <Empty
        title="No preparation batches"
        text="Choose a preparation date and explicitly select existing orders. Nothing repeats automatically."
      />
    );
  const po: Row[] = (data.preparationOrders || []).filter(
    (p: Row) => p.preparation_id === current.id,
  );
  return (
    <>
      <div className="panel board-toolbar">
        <Select
          label="Preparation date"
          value={current.id}
          onChange={setSelected}
          options={batches.map((b) => ({
            value: b.id,
            label: dateLabel(b.business_date,data.configuration),
          }))}
        />
        <div className="board-note">
          <CalendarDays size={20} />
          <span>
            Preparation only
            <small>
              Delivery date, trip and driver are assigned separately.
            </small>
          </span>
        </div>
        {canPrepare && (
          <div className="heading-actions">
            <Button secondary onClick={() => onEditBatch(current, false)}>
              Add orders
            </Button>
            <button
              className="text-button"
              onClick={() => onEditBatch(current, true)}
            >
              Remove order
            </button>
            <button className="text-button" onClick={() => onCarry(current)}>
              Carry forward
            </button>
          </div>
        )}
      </div>
      <div className="prep-overview-grid">
        {(["selected", "picking", "packing", "checking", "ready"] as const).map(stage=><div className="prep-overview-card" key={stage}><span>{statuses[stage]}</span><strong>{po.filter(p=>p.stage===stage).length}</strong><small>orders in this batch</small></div>)}
      </div>
      {po.length ? <div className="prep-workspace">
        <section className="panel prep-list-panel" aria-label="Orders in this preparation batch">
          <div className="orders-list-header"><div><h2>Orders to prepare</h2><p>Select an order to review its next step.</p></div><span className="order-count">{po.length} included</span></div>
          <label className="orders-search"><Search size={19}/><span className="sr-only">Search preparation orders</span><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search order, customer or destination…"/></label>
          <div className="prep-list-columns" aria-hidden="true"><span>Order</span><span>Ordering customer</span><span>Destination</span><span>Stage</span></div>
          <div>{po.filter(p=>{const o=(data.orders||[]).find((v:Row)=>v.id===p.order_id);return [o?.code,o?.customer_name,o?.destination_name].some(v=>String(v||"").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))}).map(p=>{const o=(data.orders||[]).find((v:Row)=>v.id===p.order_id);if(!o)return <div className="orders-no-results" key={p.order_id}>Order details unavailable · {p.order_id}</div>;return <button type="button" className={"prep-list-row "+((po.some(v=>v.order_id===selectedOrder)?selectedOrder:po[0]?.order_id)===p.order_id?"selected":"")} aria-pressed={(po.some(v=>v.order_id===selectedOrder)?selectedOrder:po[0]?.order_id)===p.order_id} key={p.order_id} onClick={()=>setSelectedOrder(p.order_id)}><strong>{o.code}</strong><span>{o.customer_name||"Unconfirmed"}</span><span>{o.destination_name||"Unconfirmed"}</span><Badge value={p.stage}/><ChevronRight size={16}/></button>})}{!po.some(p=>{const o=(data.orders||[]).find((v:Row)=>v.id===p.order_id);return [o?.code,o?.customer_name,o?.destination_name].some(v=>String(v||"").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))})&&<p className="orders-no-results">No matching orders. Try another search.</p>}</div>
        </section>
        {(()=>{const p=po.find(p=>p.order_id===selectedOrder)||po[0];const o=(data.orders||[]).find((v:Row)=>v.id===p.order_id);if(!o)return <div className="panel prep-detail"><p>Order details unavailable. Refresh or contact your supervisor.</p></div>;const lines=(data.orderLines||[]).filter((l:Row)=>l.order_id===o.id);const allocated=(data.allocations||[]).filter((a:Row)=>a.order_id===o.id);const stages=["selected","picking","packing","checking","ready"];const stageIndex=stages.indexOf(p.stage);const next=stageIndex<0?undefined:stages[stageIndex+1];return <section className="panel prep-detail" aria-label="Selected preparation order"><div className="prep-detail-top"><div><span className="eyebrow">ORDER</span><h2>{o.code}</h2></div><Badge value={p.stage}/></div><p><strong>Ordering customer:</strong> {o.customer_name||"Unconfirmed"}</p><p><strong>Recipient:</strong> {o.destination_name||"Unconfirmed"}</p><div className="prep-detail-divider"><h3>Required products</h3>{lines.map((l:Row)=><div className="prep-product-line" key={l.id}><span>{l.product_name}</span><strong>{fmt(l.quantity)} {l.unit}</strong></div>)}{!lines.length&&<p>Order lines unavailable.</p>}</div><div className="prep-detail-divider"><h3>Physical check</h3><p>{new Set(allocated.map((a:Row)=>a.box_id).filter(Boolean)).size} boxes allocated · {p.checked?"Checked at staging":"Physical check pending"}</p><p>Staging: {p.staging_location_id?(data.locations||[]).find((l:Row)=>l.id===p.staging_location_id)?.code||"Unconfirmed":"Unconfirmed"}</p></div>{canPrepare&&p.stage!=="ready"&&<div className="prep-detail-actions"><Button secondary onClick={()=>onAllocate(o)}>Allocate stock</Button>{next&&<Button onClick={()=>onAdvance(o,p)}>To {statuses[next]} <ArrowRight size={16}/></Button>}</div>}</section>})()}
      </div> : <Empty title="No orders in this batch" text="Add existing orders explicitly. Orders are not repeated automatically." />}
    </>
  );
}
function CountView({
  data,
  user,
  onReport,
  submit,
  canSubmit,
}: {
  data: Row;
  user: Row;
  onReport: (id?: string) => void;
  submit: (v: Row, op: string) => Promise<any>;
  canSubmit: boolean;
}) {
  const operation = useRef(newOperation());
  const [submitting, setSubmitting] = useState(false);
  const [locationId, setLocationId] = useState(""),
    [code, setCode] = useState(""),
    [observed, setObserved] = useState<string[]>([]),
    [message, setMessage] = useState(""),
    [blind, setBlind] = useState(false);
  const expected: Row[] = (data.boxes || []).filter(
    (b: Row) =>
      b.effective_location_id === locationId &&
      !["dispatched", "delivered"].includes(b.status),
  );
  const missing = expected.filter((b) => !observed.includes(b.code)),
    unexpected = observed.filter((c) => !expected.some((b) => b.code === c));
  async function save() {
    try {
      await saveWork(user, "count", { locationId, observed, blind });
      setMessage("Saved on this device · count observations not synced");
    } catch {
      setMessage("Device storage failed. Keep the count open.");
    }
  }
  useEffect(()=>registerPendingCapture(async()=>{if(locationId||observed.length)await saveWork(user,"count",{locationId,observed,blind});}),[locationId,observed,blind,user.id,user.org_id,user.warehouse_id]);
  useBarcodeScanner((barcode) => {
    if (!locationId) {
      playScanFeedback(false);
      setMessage("Select a count location before scanning physical boxes.");
      return;
    }
    const val = barcode.trim();
    if (!val) return;
    if (observed.includes(val)) {
      playScanFeedback(false);
      setMessage("Duplicate scan · already counted. Box total unchanged.");
    } else {
      setObserved((prev) => [...prev, val]);
      playScanFeedback(true);
      setMessage("Scanned box " + val + " · recorded locally");
    }
  }, !!locationId);
  return (
    <div className="count-layout">
      <section className="panel entity-card">
        <h2>Observe physical boxes</h2>
        <p>
          Contents quantities remain separate. A repeated internal label is one
          observation, not another box.
        </p>
        <SmartCombobox
          label="Count location"
          placeholder="Search location to count…"
          value={locationId}
          onChange={(v) => {
            if (v !== locationId && observed.length && !window.confirm("Changing location clears the observations on this screen. Save your device draft first or cancel to keep counting here. Continue?")) return;
            setLocationId(v);
            setObserved([]);
            setMessage("");
          }}
          options={(data.locations || []).map((l: Row) => ({
            value: l.id,
            label: l.code + " · " + l.name,
            badge: l.kind,
          }))}
        />
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={blind}
            onChange={(e) => setBlind(e.target.checked)}
          />{" "}
          Blind count · hide expected identities
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const value = code.trim();
            if (!value) { setMessage("Enter an internal box ID before recording an observation."); return; }
            if (observed.includes(value)) {
              playScanFeedback(false);
              setMessage(
                "Duplicate scan · already counted. Box total unchanged.",
              );
            } else {
              setObserved([...observed, value]);
              playScanFeedback(true);
              setMessage("Observed locally · not a stock adjustment");
            }
            setCode("");
          }}
        >
          <label className="field">
            <span>Internal box ID</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={!locationId}
              required
              placeholder="BOX-…"
            />
          </label>
          <Button type="submit" disabled={!locationId}>
            <ScanLine size={17} /> Record observation
          </Button>
        </form>
        {message && (
          <p className="notice info" role="status">
            {message}
          </p>
        )}
        <div className="card-actions">
          <Button secondary onClick={() => void save()}>
            Save device draft
          </Button>
          <button
            className="text-button"
            onClick={async () => {
              const saved = await getWork(user, "count");
              if (saved) {
                setLocationId(saved.locationId);
                setObserved(saved.observed);
                setBlind(saved.blind);
                setMessage("Device draft restored · not synced");
              } else setMessage("No saved count draft");
            }}
          >
            Restore count
          </button>
        </div>
      </section>
      <section className="panel entity-card">
        <h2>Count reconciliation</h2>
        <div className="count-totals">
          <div>
            <strong>{observed.length}</strong>
            <span>observed boxes</span>
          </div>
          <div>
            <strong>{blind || !locationId ? "—" : expected.length}</strong>
            <span>loaded expected boxes</span>
          </div>
        </div>
        {!blind && locationId && (
          <>
            <p>Expected boxes are based on loaded records. Review the full count before making a correction.</p>
            <h3>Missing · {missing.length}</h3>
            {missing.map((b) => (
              <div className="soft-item" key={b.id}>
                {b.code}
                <button className="text-button" onClick={() => onReport(b.id)}>
                  Report discrepancy
                </button>
              </div>
            ))}
            <h3>Unexpected · {unexpected.length}</h3>
            {unexpected.map((c) => (
              <div className="soft-item" key={c}>
                {c}
              </div>
            ))}
          </>
        )}
        <h3>Observed IDs</h3>
        {observed.map((c) => (
          <div className="soft-item" key={c}>
            {c}
            <button
              className="text-button"
              onClick={() => setObserved(observed.filter((x) => x !== c))}
            >
              Remove observation
            </button>
          </div>
        ))}
        <p>
          No stock is adjusted by a count draft. Review discrepancies before any
          authorized correction.
        </p>
        {canSubmit && (
          <Button
            disabled={!locationId || submitting}
            onClick={async () => {
              setSubmitting(true);
              try {
                const result = await submit(
                  { locationId, observedCodes: observed },
                  operation.current,
                );
                setMessage(
                  "Count accepted by server · " +
                    result.observedCount +
                    " boxes observed; discrepancies sent for review. Stock unchanged.",
                );
                operation.current = newOperation();
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? "Submitting…" : "Submit observations for review"}
          </Button>
        )}
      </section>
    </div>
  );
}
class ScreenBoundary extends React.Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="login-card" style={{ padding: "40px 20px" }}>
        <h1>Workspace needs a reload</h1>
        <p>
          A screen could not be displayed. Saved device drafts remain available.
        </p>
        <Button onClick={() => location.reload()}>Reload workspace</Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
const client = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10000, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <ScreenBoundary>
        <App />
      </ScreenBoundary>
    </QueryClientProvider>
  </React.StrictMode>,
);
