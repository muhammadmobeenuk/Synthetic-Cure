import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  Download,
  RefreshCw,
  Layers,
  Package,
  CheckCircle,
  AlertTriangle,
  ShieldAlert,
  Clock,
  Warehouse,
  ChevronRight,
  Sparkles,
  SlidersHorizontal,
} from "lucide-react";
import { api } from "./api";
import type { OperationsReportData } from "../../../packages/contracts/reports";

export function ReportsView({ user }: { user: any }) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [activePreviewSlide, setActivePreviewSlide] = useState(1);
  const [downloading, setDownloading] = useState(false);

  // Query operational metrics
  const {
    data: reportEnvelope,
    isLoading,
    isRefetching,
    error,
    refetch,
  } = useQuery<{ ok: boolean; data: OperationsReportData }>({
    queryKey: ["operations-report", startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      const queryStr = params.toString() ? `?${params.toString()}` : "";
      return api(`/reports/operations/data${queryStr}`);
    },
  });

  const report = reportEnvelope?.data;

  const handleDownloadPptx = async () => {
    try {
      setDownloading(true);
      const params = new URLSearchParams();
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      const queryStr = params.toString() ? `?${params.toString()}` : "";
      const url = `/api/v1/reports/operations/pptx${queryStr}`;

      const link = document.createElement("a");
      link.href = url;
      link.setAttribute(
        "download",
        `synthetic-cure-operations-briefing-${new Date().toISOString().split("T")[0]}.pptx`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      setTimeout(() => setDownloading(false), 1200);
    }
  };

  const slides = [
    {
      num: 1,
      title: "Cover & Operational Context",
      desc: "Executive warehouse summary, shift context, and KPI highlights.",
      tag: "OVERVIEW",
      badgeClr: "bg-indigo-900/60 text-indigo-300 border-indigo-700/50",
    },
    {
      num: 2,
      title: "Inbound POs & Dock Intake",
      desc: "Verified purchase orders, physical box receipts, and discrepancy breakdown.",
      tag: "INBOUND",
      badgeClr: "bg-blue-900/60 text-blue-300 border-blue-700/50",
    },
    {
      num: 3,
      title: "Picking & Fulfillment Throughput",
      desc: "Verified order picks, base units fulfilled, shortage exceptions, and substitutions.",
      tag: "FULFILLMENT",
      badgeClr: "bg-emerald-900/60 text-emerald-300 border-emerald-700/50",
    },
    {
      num: 4,
      title: "Stock-Owner Balances & Ledger",
      desc: "Multi-tenant stock segregation, loose and container inventory balances.",
      tag: "INVENTORY",
      badgeClr: "bg-purple-900/60 text-purple-300 border-purple-700/50",
    },
    {
      num: 5,
      title: "Quarantine Holds & Compliance",
      desc: "Active safety holds by severity, quarantined lots/serials, and audit trails.",
      tag: "QUALITY",
      badgeClr: "bg-rose-900/60 text-rose-300 border-rose-700/50",
    },
    {
      num: 6,
      title: "Shift Handover & Action Items",
      desc: "Open task queues, urgent priorities, and supervisor shift checklist.",
      tag: "HANDOVER",
      badgeClr: "bg-amber-900/60 text-amber-300 border-amber-700/50",
    },
  ];

  return (
    <div className="space-y-6 pb-12 text-slate-100">
      {/* Header Banner */}
      <div className="rounded-2xl border border-slate-700/60 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 p-6 shadow-xl backdrop-blur-md">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-semibold tracking-wider text-indigo-400 uppercase">
                <Sparkles className="h-3 w-3" />
                Floor Operations Briefing Deck
              </span>
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                Authoritative Data
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              PowerPoint Operations Report (.pptx)
            </h1>
            <p className="max-w-2xl text-sm text-slate-400">
              Generate presentation-ready, dark-themed briefing decks for shift supervisors, floor managers, and team handovers.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => refetch()}
              disabled={isLoading || isRefetching}
              className="inline-flex min-h-[48px] items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2.5 text-sm font-medium text-slate-200 transition-all hover:border-slate-600 hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
              <span>Refresh Metrics</span>
            </button>

            <button
              onClick={handleDownloadPptx}
              disabled={downloading || isLoading}
              className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/30 transition-all hover:from-indigo-500 hover:to-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              <Download className={`h-4 w-4 ${downloading ? "animate-bounce" : ""}`} />
              <span>{downloading ? "Generating PPTX..." : "Download PowerPoint Deck (.pptx)"}</span>
            </button>
          </div>
        </div>

        {/* Date Filter Bar */}
        <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-slate-700/60 pt-4 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-indigo-400" />
            <span className="font-semibold text-slate-300">Reporting Scope:</span>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-slate-400">From:</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="min-h-[40px] rounded-lg border border-slate-700 bg-slate-800/90 px-3 py-1 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="text-slate-400">To:</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="min-h-[40px] rounded-lg border border-slate-700 bg-slate-800/90 px-3 py-1 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {(startDate || endDate) && (
            <button
              onClick={() => {
                setStartDate("");
                setEndDate("");
              }}
              className="text-xs text-indigo-400 underline hover:text-indigo-300"
            >
              Clear dates
            </button>
          )}

          <div className="ml-auto flex items-center gap-2 text-slate-500">
            <Warehouse className="h-3.5 w-3.5 text-slate-400" />
            <span>
              Warehouse: <strong className="text-slate-300">{report?.warehouse.name || "Active Warehouse"}</strong> ({report?.warehouse.code || "WH"})
            </span>
          </div>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {/* Inbound Intake Card */}
        <div className="rounded-xl border border-slate-700/60 bg-slate-800/60 p-4 shadow-md backdrop-blur-sm">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold tracking-wider uppercase">Inbound POs</span>
            <Package className="h-4 w-4 text-blue-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-white">
            {isLoading ? "..." : report?.inbound.purchaseOrdersCount ?? 0}
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
            <span>Boxes Checked: {report?.inbound.receivedBoxesCount ?? 0}</span>
            <span className={report?.inbound.discrepanciesCount ? "text-amber-400" : "text-emerald-400"}>
              {report?.inbound.discrepanciesCount ?? 0} disc
            </span>
          </div>
        </div>

        {/* Picking Throughput Card */}
        <div className="rounded-xl border border-slate-700/60 bg-slate-800/60 p-4 shadow-md backdrop-blur-sm">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold tracking-wider uppercase">Picks Verified</span>
            <CheckCircle className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-emerald-400">
            {isLoading ? "..." : report?.picking.totalPicksVerified ?? 0}
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
            <span>Units: {report?.picking.totalUnitsPicked ?? "0"}</span>
            <span className="text-slate-400">Totes: {report?.picking.totesDispatchedCount ?? 0}</span>
          </div>
        </div>

        {/* Inventory ATP Card */}
        <div className="rounded-xl border border-slate-700/60 bg-slate-800/60 p-4 shadow-md backdrop-blur-sm">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold tracking-wider uppercase">Available Stock</span>
            <Layers className="h-4 w-4 text-indigo-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-indigo-300">
            {isLoading ? "..." : report?.inventory.totalAvailableQuantity ?? "0"}
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
            <span>On-Hand: {report?.inventory.totalOnHandQuantity ?? "0"}</span>
            <span>Alloc: {report?.inventory.totalReservedQuantity ?? "0"}</span>
          </div>
        </div>

        {/* Quality Holds Card */}
        <div className="rounded-xl border border-slate-700/60 bg-slate-800/60 p-4 shadow-md backdrop-blur-sm">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold tracking-wider uppercase">Active Holds</span>
            <ShieldAlert className="h-4 w-4 text-rose-400" />
          </div>
          <div
            className={`mt-2 text-2xl font-bold ${(report?.quality.activeHoldsCount ?? 0) > 0 ? "text-rose-400" : "text-slate-300"}`}
          >
            {isLoading ? "..." : report?.quality.activeHoldsCount ?? 0}
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
            <span className="text-rose-400 font-medium">Critical: {report?.quality.holdSeverityBreakdown.critical ?? 0}</span>
            <span>Major: {report?.quality.holdSeverityBreakdown.major ?? 0}</span>
          </div>
        </div>

        {/* Shift Tasks Card */}
        <div className="rounded-xl border border-slate-700/60 bg-slate-800/60 p-4 shadow-md backdrop-blur-sm">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-semibold tracking-wider uppercase">Open Tasks</span>
            <Clock className="h-4 w-4 text-amber-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-amber-400">
            {isLoading ? "..." : report?.tasks.openTasksCount ?? 0}
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
            <span>Claimed: {report?.tasks.claimedTasksCount ?? 0}</span>
            <span className="text-rose-400">Blocked: {report?.tasks.blockedTasksCount ?? 0}</span>
          </div>
        </div>
      </div>

      {/* Slide Deck Structure & Live Preview */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Slide Deck Structure (6 Slides)</h2>
          <span className="text-xs text-slate-400">
            Click any slide to view its content layout
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {slides.map((s) => (
            <button
              key={s.num}
              onClick={() => setActivePreviewSlide(s.num)}
              className={`flex flex-col justify-between rounded-xl border p-4 text-left transition-all ${
                activePreviewSlide === s.num
                  ? "border-indigo-500 bg-slate-800/90 ring-2 ring-indigo-500/40 shadow-lg"
                  : "border-slate-700/70 bg-slate-800/40 hover:border-slate-600 hover:bg-slate-800/60"
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-400">SLIDE {s.num}</span>
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${s.badgeClr}`}>
                    {s.tag}
                  </span>
                </div>
                <h3 className="mt-2 text-sm font-semibold text-white line-clamp-1">{s.title}</h3>
                <p className="mt-1 text-xs text-slate-400 line-clamp-2">{s.desc}</p>
              </div>

              <div className="mt-3 flex items-center gap-1 text-[11px] font-medium text-indigo-400">
                <span>View layout</span>
                <ChevronRight className="h-3 w-3" />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Selected Slide Detail Preview Card */}
      <div className="rounded-2xl border border-slate-700/60 bg-slate-900/90 p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 font-bold text-white text-sm">
              {activePreviewSlide}
            </span>
            <div>
              <h3 className="text-lg font-bold text-white">
                {slides[activePreviewSlide - 1].title}
              </h3>
              <p className="text-xs text-slate-400">
                {slides[activePreviewSlide - 1].desc}
              </p>
            </div>
          </div>
          <span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-300">
            Format: 16:9 PresentationML (.pptx)
          </span>
        </div>

        {/* Dynamic Preview Content */}
        {activePreviewSlide === 1 && (
          <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/60 p-6">
            <div className="border-b border-slate-800/80 pb-4">
              <span className="text-xs font-bold tracking-widest text-indigo-400 uppercase">
                Synthetic Cure · {report?.warehouse.code || "WH"} · {report?.company.name || "Organization"}
              </span>
              <h2 className="mt-1 text-2xl font-black text-white sm:text-3xl">
                Warehouse Floor Operations & Shift Briefing Deck
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                Authoritative metrics briefing for floor supervisors · Generated on {new Date().toLocaleDateString()}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 pt-2">
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-center">
                <span className="text-[10px] font-bold text-slate-400 uppercase">ACTIVE HOLDS</span>
                <div className="mt-1 text-xl font-bold text-rose-400">{report?.quality.activeHoldsCount ?? 0}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-center">
                <span className="text-[10px] font-bold text-slate-400 uppercase">OPEN TASKS</span>
                <div className="mt-1 text-xl font-bold text-amber-400">{report?.tasks.openTasksCount ?? 0}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-center">
                <span className="text-[10px] font-bold text-slate-400 uppercase">PICKS VERIFIED</span>
                <div className="mt-1 text-xl font-bold text-emerald-400">{report?.picking.totalPicksVerified ?? 0}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-center">
                <span className="text-[10px] font-bold text-slate-400 uppercase">INBOUND POs</span>
                <div className="mt-1 text-xl font-bold text-blue-400">{report?.inbound.purchaseOrdersCount ?? 0}</div>
              </div>
            </div>
          </div>
        )}

        {activePreviewSlide === 2 && (
          <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/60 p-6">
            <h4 className="text-sm font-semibold text-slate-200">Inbound Receiving & Discrepancies</h4>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <span className="text-xs text-rose-400">Damaged Goods:</span>
                <div className="text-lg font-bold text-white">{report?.inbound.discrepancyBreakdown.damaged ?? 0}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <span className="text-xs text-amber-400">Short Receipts:</span>
                <div className="text-lg font-bold text-white">{report?.inbound.discrepancyBreakdown.short ?? 0}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <span className="text-xs text-blue-400">Over Receipts:</span>
                <div className="text-lg font-bold text-white">{report?.inbound.discrepancyBreakdown.over ?? 0}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <span className="text-xs text-purple-400">Unexpected:</span>
                <div className="text-lg font-bold text-white">{report?.inbound.discrepancyBreakdown.unexpected ?? 0}</div>
              </div>
            </div>
          </div>
        )}

        {activePreviewSlide === 3 && (
          <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/60 p-6">
            <h4 className="text-sm font-semibold text-slate-200">Picking Quality & Exception Metrics</h4>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <span className="text-xs text-slate-400">Total Verified Picks:</span>
                <div className="text-lg font-bold text-emerald-400">{report?.picking.totalPicksVerified ?? 0}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <span className="text-xs text-slate-400">Units Fulfilled:</span>
                <div className="text-lg font-bold text-white">{report?.picking.totalUnitsPicked ?? "0"}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <span className="text-xs text-amber-400">Shortage Picks:</span>
                <div className="text-lg font-bold text-white">{report?.picking.shortagePicksCount ?? 0}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <span className="text-xs text-indigo-400">Substitutions:</span>
                <div className="text-lg font-bold text-white">{report?.picking.substitutionsCount ?? 0}</div>
              </div>
            </div>
          </div>
        )}

        {activePreviewSlide === 4 && (
          <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/60 p-6">
            <h4 className="text-sm font-semibold text-slate-200">Stock-Owner Inventory Segregation</h4>
            <div className="space-y-2">
              {report?.inventory.stockOwners.length ? (
                report.inventory.stockOwners.map((so) => (
                  <div key={so.ownerId} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-xs">
                    <span className="font-semibold text-white">{so.ownerName}</span>
                    <div className="flex items-center gap-4 text-slate-400">
                      <span>On-Hand: <strong className="text-white">{so.onHand}</strong></span>
                      <span>Available: <strong className="text-emerald-400">{so.available}</strong></span>
                      <span>Held: <strong className="text-rose-400">{so.held}</strong></span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-400">All warehouse stock is company-owned inventory.</p>
              )}
            </div>
          </div>
        )}

        {activePreviewSlide === 5 && (
          <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/60 p-6">
            <h4 className="text-sm font-semibold text-slate-200">Quarantine Holds & Stop-Shipment Protection</h4>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <span className="text-xs text-rose-400">Critical Holds:</span>
                <div className="text-lg font-bold text-rose-400">{report?.quality.holdSeverityBreakdown.critical ?? 0}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <span className="text-xs text-amber-400">Major Holds:</span>
                <div className="text-lg font-bold text-amber-400">{report?.quality.holdSeverityBreakdown.major ?? 0}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <span className="text-xs text-blue-400">Minor Holds:</span>
                <div className="text-lg font-bold text-blue-400">{report?.quality.holdSeverityBreakdown.minor ?? 0}</div>
              </div>
            </div>
          </div>
        )}

        {activePreviewSlide === 6 && (
          <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/60 p-6">
            <h4 className="text-sm font-semibold text-slate-200">Shift Handover Operational Checklist</h4>
            <ul className="space-y-2 text-xs text-slate-300">
              <li className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
                <span>Inbound Dock: Confirm all physical receipts have boxes scanned and condition logged.</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
                <span>Forward Replenishment: Ensure picking bins meet configured replenishment thresholds.</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
                <span>Pallet Groups: Verify checked load revisions match vehicle manifest before dispatch.</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
                <span>Custody & ePOD: Drivers must capture electronic recipient signatures at destination.</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
                <span>Offline Outbox: Ensure zero unresolved 409 sync conflicts before shift logoff.</span>
              </li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
