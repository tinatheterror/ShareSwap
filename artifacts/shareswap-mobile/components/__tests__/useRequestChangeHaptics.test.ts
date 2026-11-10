import { shouldVibrateForChange } from "@/hooks/useRequestChangeHaptics";

jest.mock("expo-haptics", () => ({ notificationAsync: jest.fn(), NotificationFeedbackType: { Success: "success" } }));

describe("shouldVibrateForChange", () => {
  it("stays quiet on the first load", () => {
    expect(shouldVibrateForChange(null, { status: "ACCEPTED" })).toBe(false);
  });
  it("buzzes when a request becomes accepted", () => {
    expect(shouldVibrateForChange({ status: "PENDING" }, { status: "ACCEPTED" })).toBe(true);
  });
  it("does not buzz while it stays accepted", () => {
    expect(shouldVibrateForChange({ status: "ACCEPTED" }, { status: "ACCEPTED" })).toBe(false);
  });
  it("buzzes when the hand-off is confirmed, by either side or both", () => {
    expect(shouldVibrateForChange({ status: "ACCEPTED" }, { status: "ACCEPTED", ownerConfirmedHandoff: true })).toBe(true);
    expect(shouldVibrateForChange({ status: "ACCEPTED" }, { status: "ACCEPTED", borrowerConfirmedHandoff: true })).toBe(true);
    expect(shouldVibrateForChange({ status: "ACCEPTED" }, { status: "ACTIVE", handoffConfirmedAt: "2026-11-10T00:00:00Z" })).toBe(true);
  });
  it("does not buzz for a decline", () => {
    expect(shouldVibrateForChange({ status: "PENDING" }, { status: "DECLINED" })).toBe(false);
  });
});
