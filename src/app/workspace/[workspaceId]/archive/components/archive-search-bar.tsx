"use client";

import { Search, X } from "lucide-react";
import { useState, useRef, useEffect } from "react";

interface ArchiveSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

export function ArchiveSearchBar({ value, onChange, placeholder }: ArchiveSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="relative flex-1 min-w-[200px] max-w-md">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-8 text-sm text-slate-900 placeholder-slate-400 transition-colors focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400/50 dark:border-[#2a2f43] dark:bg-[#191c28] dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-amber-500"
        data-testid="archive-search-input"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
