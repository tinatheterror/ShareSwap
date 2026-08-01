import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateProfilePhotoWithAI,
  determinePhotoBonus,
  type OpenAIClient,
} from "../validate-profile-photo.js";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Build a fake OpenAI client whose chat.completions.create returns the given JSON body. */
function makeFakeOpenAI(responseJson: object): OpenAIClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: JSON.stringify(responseJson) } }],
        }),
      },
    },
  };
}

const NON_FACE_BUFFER = Buffer.from("fake-logo-image-data");
const FACE_BUFFER = Buffer.from("fake-selfie-image-data");

// ── validateProfilePhotoWithAI ──────────────────────────────────────────────

describe("validateProfilePhotoWithAI", () => {
  it("returns rejected when the AI says the photo has no face (logo / meme)", async () => {
    const openai = makeFakeOpenAI({ decision: "rejected", reason: "This is a logo, not a face." });

    const result = await validateProfilePhotoWithAI(NON_FACE_BUFFER, "image/png", openai);

    expect(result.validationStatus).toBe("rejected");
    expect(result.validationReason).toBe("This is a logo, not a face.");
  });

  it("returns approved when the AI says the photo shows a clear face", async () => {
    const openai = makeFakeOpenAI({ decision: "approved", reason: "Clear headshot." });

    const result = await validateProfilePhotoWithAI(FACE_BUFFER, "image/jpeg", openai);

    expect(result.validationStatus).toBe("approved");
    expect(result.validationReason).toBe("Clear headshot.");
  });

  it("falls back to rejected when the AI response is not parseable JSON", async () => {
    const openai: OpenAIClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: "Sorry, I cannot determine that." } }],
          }),
        },
      },
    };

    const result = await validateProfilePhotoWithAI(NON_FACE_BUFFER, "image/jpeg", openai);

    expect(result.validationStatus).toBe("rejected");
    expect(result.validationReason).toBe("Could not verify face in photo");
  });

  it("falls back to rejected when the OpenAI call throws", async () => {
    const openai: OpenAIClient = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(new Error("network error")),
        },
      },
    };

    const result = await validateProfilePhotoWithAI(NON_FACE_BUFFER, "image/jpeg", openai);

    expect(result.validationStatus).toBe("rejected");
  });
});

// ── determinePhotoBonus ────────────────────────────────────────────────────

describe("determinePhotoBonus", () => {
  describe("non-face photo upload (AI rejects)", () => {
    it("awards 0 ShareCoins", () => {
      const { shareCoinsAwarded } = determinePhotoBonus("rejected", false);
      expect(shareCoinsAwarded).toBe(0);
    });

    it("returns the 'try again' guidance message", () => {
      const { message } = determinePhotoBonus("rejected", false);
      expect(message).toBe(
        "Photo saved. Make sure your photo clearly shows your face to earn 1 ShareCoin.",
      );
    });
  });

  describe("real face photo upload (AI approves)", () => {
    it("awards 1 ShareCoin", () => {
      const { shareCoinsAwarded } = determinePhotoBonus("approved", false);
      expect(shareCoinsAwarded).toBe(1);
    });

    it("returns the congratulations message", () => {
      const { message } = determinePhotoBonus("approved", false);
      expect(message).toBe("Profile photo uploaded! You earned 1 ShareCoin.");
    });
  });

  describe("when bonus has already been earned", () => {
    it("awards 0 ShareCoins regardless of validation status", () => {
      expect(determinePhotoBonus("approved", true).shareCoinsAwarded).toBe(0);
      expect(determinePhotoBonus("rejected", true).shareCoinsAwarded).toBe(0);
    });

    it("returns the simple update message", () => {
      expect(determinePhotoBonus("approved", true).message).toBe("Profile photo updated!");
    });
  });
});
