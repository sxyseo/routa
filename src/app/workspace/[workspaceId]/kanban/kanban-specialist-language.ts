"use client";

export type KanbanSpecialistLanguage = "en" | "zh-CN";

export interface LocalizedSpecialistOption {
  id: string;
  name: string;
  role: string;
  displayName?: string;
  canonicalId?: string;
}

export const KANBAN_SPECIALIST_LANGUAGE_STORAGE_KEY = "routa:kanban-specialist-language";

export const KANBAN_SPECIALIST_LANGUAGE_LABELS: Record<
  KanbanSpecialistLanguage,
  {
    language: string;
    english: string;
    chinese: string;
    none: string;
    noSpecialist: string;
  }
> = {
  en: {
    language: "Language",
    english: "English",
    chinese: "Chinese",
    none: "None",
    noSpecialist: "No specialist",
  },
  "zh-CN": {
    language: "语言",
    english: "英文",
    chinese: "中文",
    none: "无",
    noSpecialist: "不指定 specialist",
  },
};

const ZH_SPECIALIST_SUFFIX = "-zh-cn";

export function getCanonicalSpecialistId(id: string | undefined): string | undefined {
  if (!id) return undefined;
  return id.endsWith(ZH_SPECIALIST_SUFFIX) ? id.slice(0, -ZH_SPECIALIST_SUFFIX.length) : id;
}

export function getLanguageSpecificSpecialistId(
  id: string | undefined,
  language: KanbanSpecialistLanguage,
): string | undefined {
  const canonicalId = getCanonicalSpecialistId(id);
  if (!canonicalId) return undefined;
  return language === "zh-CN" ? `${canonicalId}${ZH_SPECIALIST_SUFFIX}` : canonicalId;
}

export function findSpecialistById<T extends LocalizedSpecialistOption>(
  specialists: T[],
  id: string | undefined,
): T | undefined {
  if (!id) return undefined;
  const canonicalId = getCanonicalSpecialistId(id);
  return specialists.find((specialist) => specialist.id === id || specialist.canonicalId === canonicalId);
}

export function localizeSpecialists<T extends LocalizedSpecialistOption>(
  specialists: T[],
  language: KanbanSpecialistLanguage,
): Array<T & { canonicalId: string; displayName?: string }> {
  const byId = new Map(specialists.map((specialist) => [specialist.id, specialist]));
  const canonicalIds = Array.from(new Set(
    specialists.map((specialist) => getCanonicalSpecialistId(specialist.id)).filter((value): value is string => Boolean(value)),
  ));

  return canonicalIds.flatMap((canonicalId) => {
    const preferredId = getLanguageSpecificSpecialistId(canonicalId, language) ?? canonicalId;
    const preferred = byId.get(preferredId) ?? byId.get(canonicalId);
    if (!preferred) return [];

    return [{
      ...preferred,
      canonicalId,
      displayName: preferred.name,
    }];
  });
}

export function resolveSpecialistSelection<T extends LocalizedSpecialistOption>(
  specialistId: string | undefined,
  specialistName: string | undefined,
  specialists: T[],
  language: KanbanSpecialistLanguage,
): { specialistId?: string; specialistName?: string } {
  if (!specialistId && !specialistName) return {};

  const nextId = getLanguageSpecificSpecialistId(specialistId, language) ?? specialistId;
  const specialist = findSpecialistById(specialists, nextId);

  return {
    specialistId: specialist?.id ?? nextId,
    specialistName: specialist?.name ?? specialistName,
  };
}

export function getSpecialistDisplayName(
  specialist: Pick<LocalizedSpecialistOption, "name" | "displayName"> | null | undefined,
): string | undefined {
  if (!specialist) return undefined;
  return specialist.displayName ?? specialist.name;
}
