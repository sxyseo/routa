"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, X } from "lucide-react";

interface ArchiveLabelFilterProps {
  labels: string[];
  selectedLabels: string[];
  onToggleLabel: (label: string) => void;
  onClearLabels: () => void;
  filterByLabel: string;
  allLabels: string;
  clearLabel: string;
}

export function ArchiveLabelFilter({
  labels,
  selectedLabels,
  onToggleLabel,
  onClearLabels,
  filterByLabel,
  allLabels,
  clearLabel,
}: ArchiveLabelFilterProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative" data-testid="archive-label-filter">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50 dark:border-[#2a2f43] dark:bg-[#191c28] dark:text-slate-300 dark:hover:bg-[#202433]"
      >
        <span>{filterByLabel}</span>
        {selectedLabels.length > 0 && (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            {selectedLabels.length}
          </span>
        )}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-[#2a2f43] dark:bg-[#191c28]">
          {selectedLabels.length > 0 && (
            <div className="border-b border-slate-100 px-3 py-2 dark:border-[#2a2f43]">
              <button
                type="button"
                onClick={onClearLabels}
                className="text-xs text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
              >
                {clearLabel}
              </button>
            </div>
          )}
          <div className="max-h-48 overflow-y-auto py-1">
            {labels.map((label) => {
              const isSelected = selectedLabels.includes(label);
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => onToggleLabel(label)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                    isSelected
                      ? "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
                      : "text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-[#202433]"
                  }`}
                >
                  <span
                    className={`h-3.5 w-3.5 shrink-0 rounded border transition-colors ${
                      isSelected
                        ? "border-amber-500 bg-amber-500 dark:border-amber-400 dark:bg-amber-400"
                        : "border-slate-300 dark:border-[#3a3f53]"
                    }`}
                  >
                    {isSelected && (
                      <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
