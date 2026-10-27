import React, { useState, useRef, useEffect, useId } from "react";
import Decimal from "decimal.js";
import { Search, ChevronDown, Check, X, Plus, Minus, ScanLine, Sparkles, AlertCircle, RotateCcw, PenTool } from "lucide-react";

export interface ComboboxOption {
  value: string;
  label: string;
  sublabel?: string;
  badge?: string;
}

export interface SmartComboboxProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
  autoFocus?: boolean;
  className?: string;
  id?: string;
}

export function SmartCombobox({
  label,
  value,
  onChange,
  options,
  placeholder = "Search or select…",
  required = false,
  disabled = false,
  hint,
  autoFocus = false,
  className = "",
  id: customId,
}: SmartComboboxProps) {
  const autoId = useId();
  const inputId = customId || autoId;
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find((o) => o.value === value);

  // Filter options based on query
  const filteredOptions = query.trim()
    ? options.filter((o) => {
        const q = query.toLowerCase();
        return (
          o.label.toLowerCase().includes(q) ||
          (o.sublabel && o.sublabel.toLowerCase().includes(q)) ||
          o.value.toLowerCase().includes(q)
        );
      })
    : options;

  useEffect(() => {
    setHighlightIndex(0);
  }, [query]);

  // Handle click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSelect(optValue: string) {
    onChange(optValue);
    setIsOpen(false);
    setQuery("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((prev) => (prev + 1 < filteredOptions.length ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((prev) => (prev - 1 >= 0 ? prev - 1 : filteredOptions.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredOptions[highlightIndex]) {
        handleSelect(filteredOptions[highlightIndex].value);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    }
  }

  return (
    <div className={`smart-field-group ${className}`} ref={containerRef}>
      <label htmlFor={inputId} className="smart-field-label">
        <span>{label}</span>
        {required && <span className="smart-required-badge" aria-hidden="true">*</span>}
      </label>

      <div className="smart-combobox-wrapper">
        <div
          className={`smart-combobox-control ${isOpen ? "open" : ""} ${disabled ? "disabled" : ""}`}
          onClick={() => {
            if (!disabled) {
              setIsOpen(!isOpen);
              if (!isOpen) setTimeout(() => inputRef.current?.focus(), 50);
            }
          }}
          tabIndex={disabled ? -1 : 0}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-controls={`${inputId}-listbox`}
        >
          <div className="smart-combobox-value">
            {selectedOption ? (
              <span className="selected-text">
                <strong>{selectedOption.label}</strong>
                {selectedOption.sublabel && <small>{selectedOption.sublabel}</small>}
              </span>
            ) : (
              <span className="placeholder-text">{placeholder}</span>
            )}
          </div>

          <div className="smart-combobox-actions">
            {value && !disabled && (
              <button
                type="button"
                className="smart-clear-btn"
                title="Clear selection"
                aria-label="Clear selection"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange("");
                  setQuery("");
                }}
              >
                <X size={14} />
              </button>
            )}
            <ChevronDown size={17} className={`smart-chevron ${isOpen ? "rotate" : ""}`} />
          </div>
        </div>

        {isOpen && (
          <div className="smart-combobox-dropdown" id={`${inputId}-listbox`} role="listbox">
            <div className="smart-combobox-search-box">
              <Search size={15} className="search-icon" />
              <input
                ref={inputRef}
                id={inputId}
                type="search"
                className="smart-combobox-search-input"
                placeholder="Type to filter options…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus={autoFocus}
                aria-autocomplete="list"
              />
              {query && (
                <button
                  type="button"
                  className="smart-clear-query"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            <div className="smart-combobox-list">
              {filteredOptions.length > 0 ? (
                filteredOptions.map((opt, index) => {
                  const isSelected = opt.value === value;
                  const isHighlighted = index === highlightIndex;
                  return (
                    <div
                      key={opt.value}
                      className={`smart-combobox-option ${isSelected ? "selected" : ""} ${
                        isHighlighted ? "highlighted" : ""
                      }`}
                      onClick={() => handleSelect(opt.value)}
                      onMouseEnter={() => setHighlightIndex(index)}
                      role="option"
                      aria-selected={isSelected}
                    >
                      <div className="option-text">
                        <div className="option-label">{opt.label}</div>
                        {opt.sublabel && <div className="option-sublabel">{opt.sublabel}</div>}
                      </div>
                      <div className="option-meta">
                        {opt.badge && <span className="option-badge">{opt.badge}</span>}
                        {isSelected && <Check size={16} className="check-icon" />}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="smart-combobox-empty">
                  No matching options for &ldquo;{query}&rdquo;
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {hint && <small className="smart-field-hint">{hint}</small>}
    </div>
  );
}

export interface SmartQuantityInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  unit?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
  min?: number;
  max?: string | number;
  onMaxClick?: () => void;
  maxLabel?: string;
  showSteppers?: boolean;
  quickAddValues?: number[];
  className?: string;
  id?: string;
}

export function SmartQuantityInput({
  label,
  value,
  onChange,
  unit,
  placeholder = "0.00",
  required = false,
  disabled = false,
  hint,
  min = 0,
  max,
  onMaxClick,
  maxLabel,
  showSteppers = true,
  quickAddValues = [1, 5, 10],
  className = "",
  id: customId,
}: SmartQuantityInputProps) {
  const autoId = useId();
  const inputId = customId || autoId;

  function adjustBy(delta: number) {
    if (disabled) return;
    try {
      const current = value && !isNaN(Number(value)) ? new Decimal(value) : new Decimal(0);
      const next = current.plus(delta);
      if (next.lt(min)) {
        onChange(String(min));
      } else if (max !== undefined && next.gt(max)) {
        onChange(String(max));
      } else {
        onChange(next.toFixed());
      }
    } catch {
      onChange(String(delta > 0 ? delta : 0));
    }
  }

  const isInvalid = value !== "" && (isNaN(Number(value)) || Number(value) <= 0);

  return (
    <div className={`smart-field-group ${className}`}>
      <div className="smart-field-header">
        <label htmlFor={inputId} className="smart-field-label">
          <span>{label}</span>
          {required && <span className="smart-required-badge" aria-hidden="true">*</span>}
        </label>
        {onMaxClick && maxLabel && (
          <button
            type="button"
            className="smart-fill-max-btn"
            onClick={onMaxClick}
            disabled={disabled}
          >
            <Sparkles size={12} /> {maxLabel}
          </button>
        )}
      </div>

      <div className="smart-quantity-wrapper">
        <div className={`smart-quantity-input-box ${isInvalid ? "invalid" : ""}`}>
          <input
            id={inputId}
            type="text"
            inputMode="decimal"
            pattern="[0-9]*[.]?[0-9]*"
            className="smart-quantity-input"
            value={value}
            placeholder={placeholder}
            required={required}
            disabled={disabled}
            onChange={(e) => {
              const val = e.target.value;
              // Allow numbers and single decimal point
              if (val === "" || /^\d*\.?\d*$/.test(val)) {
                onChange(val);
              }
            }}
          />
          {unit && <span className="smart-unit-badge">{unit}</span>}
        </div>

        {showSteppers && !disabled && (
          <div className="smart-steppers-container">
            <button
              type="button"
              className="smart-step-btn"
              title="Decrease quantity by 1"
              aria-label="Decrease quantity by 1"
              onClick={() => adjustBy(-1)}
              disabled={disabled || (Number(value) || 0) <= min}
            >
              <Minus size={14} />
            </button>
            <button
              type="button"
              className="smart-step-btn"
              title="Increase quantity by 1"
              aria-label="Increase quantity by 1"
              onClick={() => adjustBy(1)}
              disabled={disabled}
            >
              <Plus size={14} />
            </button>
            {quickAddValues.map((q) => (
              <button
                key={q}
                type="button"
                className="smart-quick-add-btn"
                onClick={() => adjustBy(q)}
                disabled={disabled}
              >
                +{q}
              </button>
            ))}
          </div>
        )}
      </div>

      {isInvalid && (
        <small className="smart-field-error" role="alert">
          Enter a verified positive quantity.
        </small>
      )}
      {hint && !isInvalid && <small className="smart-field-hint">{hint}</small>}
    </div>
  );
}

export interface ParsedGS1 {
  gtin?: string;
  batchLot?: string;
  expiryDate?: string;
  serialNo?: string;
}

export function parseGS1Barcode(raw: string): ParsedGS1 | null {
  const result: ParsedGS1 = {};
  // Handle (01) GTIN-14
  const gtinMatch = raw.match(/(?:\(01\)|01)(\d{14})/);
  if (gtinMatch) result.gtin = gtinMatch[1];

  // Handle (10) Batch/Lot
  const lotMatch = raw.match(/(?:\(10\)|10)([A-Za-z0-9_-]{1,20})/);
  if (lotMatch) result.batchLot = lotMatch[1];

  // Handle (17) Expiry Date YYMMDD
  const expMatch = raw.match(/(?:\(17\)|17)(\d{6})/);
  if (expMatch) {
    const yy = expMatch[1].slice(0, 2);
    const mm = expMatch[1].slice(2, 4);
    const dd = expMatch[1].slice(4, 6);
    result.expiryDate = `20${yy}-${mm}-${dd}`;
  }

  // Handle (21) Serial Number
  const serialMatch = raw.match(/(?:\(21\)|21)([A-Za-z0-9_-]{1,20})/);
  if (serialMatch) result.serialNo = serialMatch[1];

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Global or scoped hardware barcode scanner listener hook.
 * High-speed input (< 45ms per keystroke) terminated with Enter/Tab.
 */
export function useBarcodeScanner(
  onScan: (barcode: string, parsedGS1: ParsedGS1 | null) => void,
  enabled: boolean = true
) {
  useEffect(() => {
    if (!enabled) return;

    let buffer = "";
    let lastKeyTime = Date.now();

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore modifier keys
      if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(e.key)) return;

      const now = Date.now();
      const diff = now - lastKeyTime;
      lastKeyTime = now;

      // Scanners type fast (inter-keystroke under 45ms)
      // If user took longer than 55ms, reset buffer (it's human typing)
      if (diff > 55) {
        buffer = "";
      }

      if (e.key === "Enter" || e.key === "Tab") {
        if (buffer.length >= 3) {
          e.preventDefault();
          const clean = buffer.trim();
          const gs1 = parseGS1Barcode(clean);
          onScan(clean, gs1);
          buffer = "";
        }
      } else if (e.key.length === 1) {
        buffer += e.key;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onScan, enabled]);
}

/**
 * Floor audio chime & haptic feedback for barcode/item actions.
 */
export function playScanFeedback(success: boolean = true) {
  try {
    // 1. Haptic Vibration (on handhelds/phones)
    if ("vibrate" in navigator) {
      if (success) {
        navigator.vibrate(60);
      } else {
        navigator.vibrate([100, 50, 100]);
      }
    }

    // 2. Web Audio synthesis (works without external audio assets)
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (success) {
        osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
        osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
        osc.start();
        osc.stop(ctx.currentTime + 0.12);
      } else {
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(220, ctx.currentTime); // Low buzz
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
        osc.start();
        osc.stop(ctx.currentTime + 0.25);
      }
    }
  } catch {
    // Graceful fallback if audio is blocked by user gesture policy
  }
}

export interface EnvironmentalCompatibilityResult {
  isCompatible: boolean;
  warning?: string;
  requiredProfile?: string;
  locationKind?: string;
}

/**
 * Checks whether items requiring temperature control are placed in an appropriate location.
 */
export function checkEnvironmentalCompatibility(
  products: (
    | {
        name?: string;
        sku?: string;
        profile?: string;
        require_temperature?: boolean;
        temperature_min?: string | number | null;
        temperature_max?: string | number | null;
        [key: string]: any;
      }
    | undefined
    | null
  )[],
  location: { code?: string; name?: string; kind?: string; restrictions?: string | null; [key: string]: any } | undefined | null
): EnvironmentalCompatibilityResult {
  if (!location) return { isCompatible: true };

  // Check if any product has cold-chain requirements
  const coldProduct = products.find(
    (p) =>
      p &&
      (p.profile === "Chilled" ||
        p.profile === "Frozen" ||
        p.require_temperature === true ||
        (p.temperature_min != null && Number(p.temperature_min) < 15))
  );

  if (!coldProduct) return { isCompatible: true };

  // Check if location is cold-chain equipped
  const locDesc = `${location.code || ""} ${location.name || ""} ${location.kind || ""} ${location.restrictions || ""}`.toLowerCase();
  const hasColdCapability = /cold|chill|freez|fridge|cool|temp|refrig|climate|hvac|walk-in/i.test(locDesc);

  if (!hasColdCapability) {
    const tempRange =
      coldProduct.temperature_min != null && coldProduct.temperature_max != null
        ? ` (${coldProduct.temperature_min}°C to ${coldProduct.temperature_max}°C)`
        : "";
    return {
      isCompatible: false,
      requiredProfile: coldProduct.profile || "Temperature-controlled",
      locationKind: location.kind || "ambient",
      warning: `Cold Chain Alert: Product "${coldProduct.name || coldProduct.sku}" requires ${
        coldProduct.profile || "temperature control"
      }${tempRange}, but selected location "${location.code} · ${location.name}" is an ambient/unrefrigerated area (${
        location.kind || "ambient"
      }). Verify climate integrity before putaway.`,
    };
  }

  return { isCompatible: true };
}

export function EnvironmentalWarningBadge({ warning }: { warning: string }) {
  return (
    <div className="smart-env-warning" role="alert">
      <AlertCircle size={18} className="smart-env-icon" />
      <div className="smart-env-content">
        <strong>Cold Chain Notice</strong>
        <p>{warning}</p>
      </div>
    </div>
  );
}

export interface SmartSignaturePadProps {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
  label?: string;
}

/**
 * Mobile-first HTML5 Canvas digital signature pad with recipient printed name,
 * quick delivery disposition tags, and automatic note formatting.
 */
export function SmartSignaturePad({
  value,
  onChange,
  required = false,
  disabled = false,
  hint,
  label = "Recipient Proof of Delivery (e-POD)",
}: SmartSignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [recipientName, setRecipientName] = useState("");
  const [status, setStatus] = useState("Delivered in Full");
  const [extraNote, setExtraNote] = useState("");

  // Synchronize composite note string back to parent form
  useEffect(() => {
    if (!recipientName && !extraNote && !hasDrawn && value) {
      return;
    }
    const parts: string[] = [];
    if (recipientName.trim()) {
      parts.push(`Delivered to & signed by: ${recipientName.trim()}`);
    } else {
      parts.push(`Handover recorded`);
    }
    if (hasDrawn) {
      parts.push(`[Digital Touch Signature Verified]`);
    }
    if (status) {
      parts.push(`Status: ${status}`);
    }
    if (extraNote.trim()) {
      parts.push(`Note: ${extraNote.trim()}`);
    }
    const combined = parts.join(" · ");
    if (combined && combined !== value) {
      onChange(combined);
    }
  }, [recipientName, hasDrawn, status, extraNote]);

  // Set up canvas context
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    ctx.scale(ratio, ratio);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#087a55"; // Jade theme color
    ctx.lineWidth = 2.5;
  }, []);

  function startDrawing(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    setIsDrawing(true);
    setHasDrawn(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function draw(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawing || disabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  }

  function stopDrawing(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawing) return;
    setIsDrawing(false);
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  }

  return (
    <div className="smart-signature-container">
      <label className="smart-field-label">
        <span>{label}</span>
        {required && <span className="smart-required-badge">*</span>}
      </label>

      {/* Recipient Printed Name */}
      <div className="smart-sig-name-box">
        <label className="smart-sig-sublabel">Recipient Name & Designation</label>
        <input
          type="text"
          placeholder="e.g. Dr. Jane Smith · Pharmacy Receiving Lead"
          value={recipientName}
          disabled={disabled}
          onChange={(e) => setRecipientName(e.target.value)}
          className="smart-sig-name-input"
        />
      </div>

      {/* Signature Canvas Box */}
      <div className="smart-sig-canvas-wrapper">
        <div className="smart-sig-canvas-header">
          <span className="smart-sig-canvas-prompt">
            <PenTool size={13} /> Sign on screen below (Touch / Stylus):
          </span>
          <button
            type="button"
            className="smart-sig-clear-btn"
            onClick={clearSignature}
            disabled={disabled || !hasDrawn}
            title="Clear and re-sign"
          >
            <RotateCcw size={12} /> Clear
          </button>
        </div>
        <div className="smart-sig-canvas-board">
          <canvas
            ref={canvasRef}
            className="smart-sig-canvas"
            onPointerDown={startDrawing}
            onPointerMove={draw}
            onPointerUp={stopDrawing}
            onPointerCancel={stopDrawing}
          />
          {!hasDrawn && (
            <div className="smart-sig-watermark" aria-hidden="true">
              <span>✍️ Sign here</span>
              <div className="smart-sig-line" />
            </div>
          )}
        </div>
      </div>

      {/* Delivery Outcome / Quick Exception Tags */}
      <div className="smart-sig-outcomes">
        <span className="smart-sig-sublabel">Delivery Status:</span>
        <div className="smart-sig-outcome-pills">
          {[
            "Delivered in Full",
            "Partial (Damaged)",
            "Partial (Shortage)",
            "Customer Refusal",
            "Dock / Reception Handover",
          ].map((tag) => (
            <button
              key={tag}
              type="button"
              className={`smart-outcome-pill ${status === tag ? "active" : ""}`}
              onClick={() => setStatus(tag)}
              disabled={disabled}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* Exception or Operational Notes */}
      <div className="smart-sig-notes-box">
        <label className="smart-sig-sublabel">Handover Note / Exception Detail</label>
        <textarea
          rows={2}
          placeholder="Specific handover instructions, dock temperature reading, or exception details…"
          value={extraNote}
          disabled={disabled}
          onChange={(e) => setExtraNote(e.target.value)}
          className="smart-sig-textarea"
          maxLength={500}
        />
      </div>

      {hint && <small className="smart-field-hint">{hint}</small>}
    </div>
  );
}

