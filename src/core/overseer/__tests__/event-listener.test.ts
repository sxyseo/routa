/**
 * Event Listener (HMAC token) unit tests.
 */
import { describe, it, expect } from "vitest";
import { generateApprovalToken, verifyApprovalToken } from "../event-listener";

describe("HMAC Approval Token", () => {
  it("should generate and verify a valid token", () => {
    const decisionId = "od_test_123";
    const action = "approve" as const;
    const token = generateApprovalToken(decisionId, action);
    const result = verifyApprovalToken(decisionId, action, token);
    expect(result.valid).toBe(true);
  });

  it("should reject a token for wrong action", () => {
    const decisionId = "od_test_123";
    const token = generateApprovalToken(decisionId, "approve");
    const result = verifyApprovalToken(decisionId, "reject", token);
    expect(result.valid).toBe(false);
  });

  it("should reject a token for wrong decisionId", () => {
    const token = generateApprovalToken("od_correct", "approve");
    const result = verifyApprovalToken("od_wrong", "approve", token);
    expect(result.valid).toBe(false);
  });

  it("should reject a malformed token", () => {
    const result = verifyApprovalToken("od_test", "approve", "malformed-token");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid token");
  });

  it("should reject a tampered token", () => {
    const token = generateApprovalToken("od_test", "approve");
    const parts = token.split(":");
    // Tamper with the HMAC part
    const tampered = `${parts[0]}:${"0".repeat(parts[1].length)}`;
    const result = verifyApprovalToken("od_test", "approve", tampered);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid token signature");
  });
});
