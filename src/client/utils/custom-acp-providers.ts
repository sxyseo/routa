/**
 * Custom ACP Provider storage utilities.
 *
 * Allows users to define their own ACP-compliant agent CLIs with custom
 * command and args. Stored in localStorage so they persist across sessions.
 */

const STORAGE_KEY = "routa.customAcpProviders";

/** A user-defined ACP provider. */
export interface CustomAcpProvider {
  /** Unique identifier (auto-generated or user-defined). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** CLI command to execute (e.g. "my-agent"). */
  command: string;
  /** Command-line arguments for ACP mode (e.g. ["--acp"]). */
  args: string[];
  /** Optional description. */
  description?: string;
}

/** Load all custom ACP providers from localStorage. */
export function loadCustomAcpProviders(): CustomAcpProvider[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CustomAcpProvider[]) : [];
  } catch {
    return [];
  }
}

/** Save custom ACP providers to localStorage. */
export function saveCustomAcpProviders(providers: CustomAcpProvider[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(providers));
}

/** Get a custom ACP provider by ID. */
export function getCustomAcpProviderById(id: string): CustomAcpProvider | undefined {
  return loadCustomAcpProviders().find((p) => p.id === id);
}
