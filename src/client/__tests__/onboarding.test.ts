import { describe, expect, it } from "vitest";

import {
  hasSavedProviderConfiguration,
  parseOnboardingMode,
} from "../utils/onboarding";

describe("onboarding helpers", () => {
  it("detects configured providers from role defaults", () => {
    expect(
      hasSavedProviderConfiguration(
        {
          ROUTA: { provider: "claude" },
        },
        {},
      ),
    ).toBe(true);
  });

  it("detects configured providers from connection settings", () => {
    expect(
      hasSavedProviderConfiguration(
        {},
        {
          opencode: { apiKey: "secret" },
        },
      ),
    ).toBe(true);
  });

  it("returns false when no provider settings are saved", () => {
    expect(hasSavedProviderConfiguration({}, {})).toBe(false);
  });

  it("parses only supported onboarding modes", () => {
    expect(parseOnboardingMode("ROUTA")).toBe("ROUTA");
    expect(parseOnboardingMode("CRAFTER")).toBe("CRAFTER");
    expect(parseOnboardingMode("DEVELOPER")).toBeNull();
    expect(parseOnboardingMode(null)).toBeNull();
  });
});
