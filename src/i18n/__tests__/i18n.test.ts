import { describe, it, expect } from "vitest";
import en from "../locales/en";
import zh from "../locales/zh";
import type { TranslationDictionary } from "../types";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from "../types";

function collectKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const key of Object.keys(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      keys.push(...collectKeys(value as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

describe("i18n translations", () => {
  it("should have en as default locale", () => {
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("should support en and zh locales", () => {
    expect(SUPPORTED_LOCALES).toContain("en");
    expect(SUPPORTED_LOCALES).toContain("zh");
  });

  it("zh should have the same keys as en", () => {
    const enKeys = collectKeys(en as unknown as Record<string, unknown>).sort();
    const zhKeys = collectKeys(zh as unknown as Record<string, unknown>).sort();
    expect(zhKeys).toEqual(enKeys);
  });

  it("all translation values should be non-empty strings", () => {
    const checkNonEmpty = (dict: TranslationDictionary, locale: string) => {
      const keys = collectKeys(dict as unknown as Record<string, unknown>);
      for (const key of keys) {
        const parts = key.split(".");
        let value: unknown = dict;
        for (const part of parts) {
          value = (value as Record<string, unknown>)[part];
        }
        expect(value, `${locale}.${key} should be a non-empty string`).toBeTruthy();
        expect(typeof value, `${locale}.${key} should be a string`).toBe("string");
      }
    };

    checkNonEmpty(en, "en");
    checkNonEmpty(zh, "zh");
  });
});
