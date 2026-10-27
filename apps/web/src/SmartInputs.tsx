import React, { useState, useRef, useEffect, useId } from "react";
import Decimal from "decimal.js";
import { Search, ChevronDown, Check, X, Plus, Minus, ScanLine, Sparkles } from "lucide-react";

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
