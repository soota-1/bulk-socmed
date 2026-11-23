import { describe, it, expect } from "vitest";
import {
  type StepResult,
  type ReconcileResult,
  createStepSuccess,
  createStepError,
} from "../src/publishers/base";

describe("publishers/base — types and transitions contract", () => {
  it("createStepSuccess builds standard success StepResult", () => {
    const success = createStepSuccess("uploading", "upload", {
      delayMinutes: 2,
      externalId: "ext-123",
      externalState: { uploaded: true },
    });
    expect(success.nextStatus).toBe("uploading");
    expect(success.nextStep).toBe("upload");
    expect(success.externalId).toBe("ext-123");
    expect(success.delayMinutes).toBe(2);
    expect(success.externalState).toEqual({ uploaded: true });
  });

  it("createStepError builds permanent error StepResult", () => {
    const err = createStepError("invalid_file", "File corrupt", { isPermanent: true });
    expect(err.nextStatus).toBe("failed");
    expect(err.error?.isPermanent).toBe(true);
    expect(err.error?.code).toBe("invalid_file");
  });

  it("createStepError builds auth error StepResult", () => {
    const err = createStepError("token_expired", "Token expired", { isAuthError: true });
    expect(err.nextStatus).toBe("scheduled");
    expect(err.error?.isAuthError).toBe(true);
  });

  it("handles ReconcileResult with manual check flag", () => {
    const reconcile: ReconcileResult = {
      resolvedStatus: "failed",
      requiresManualCheck: true,
      notes: "Crash during publish_requested: Instagram feed check inconclusive",
    };
    expect(reconcile.requiresManualCheck).toBe(true);
    expect(reconcile.resolvedStatus).toBe("failed");
  });
});
