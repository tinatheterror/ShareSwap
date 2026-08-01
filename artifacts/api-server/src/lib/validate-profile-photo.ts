/**
 * AI-powered profile photo face validation.
 * Extracted from the route handler so it can be unit-tested independently.
 */

export interface PhotoValidationResult {
  validationStatus: "approved" | "rejected";
  validationReason: string;
}

/** Minimal slice of the OpenAI client that we actually use. */
export interface OpenAIClient {
  chat: {
    completions: {
      create(params: object): Promise<{
        choices: Array<{ message: { content: string | null } }>;
      }>;
    };
  };
}

const SYSTEM_PROMPT = `You are a profile photo moderator for ShareSwap, a peer-to-peer sharing community. Your job is to determine if a profile photo shows a clear, visible human face suitable for building trust in the community.

APPROVE photos that:
- Show a clear, visible human face (selfies, headshots, portrait photos)
- Have reasonable lighting and focus
- Show a single person as the clear subject
- Natural accessories like glasses, hats, or light makeup are fine

REJECT photos that:
- Logos, icons, graphics, or illustrations (no person at all)
- Only pets, objects, or scenery with no human face visible
- Face completely cropped out or fully hidden (e.g. back of head only)
- Memes, screenshots, or collages

Respond with ONLY valid JSON in this exact format:
{"decision": "approved" or "rejected", "reason": "brief explanation"}`;

export async function validateProfilePhotoWithAI(
  fileBuffer: Buffer,
  mimetype: string,
  openai: OpenAIClient,
): Promise<PhotoValidationResult> {
  const base64Image = fileBuffer.toString("base64");
  const mimeType = mimetype || "image/jpeg";

  let content = "";
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Please analyze this profile photo and determine if it shows a clear, visible human face.",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
                detail: "auto",
              },
            },
          ],
        },
      ],
      max_completion_tokens: 150,
    });
    content = response.choices[0]?.message?.content || "";
  } catch (aiError) {
    console.error("AI validation error (withholding coin):", aiError);
    return { validationStatus: "rejected", validationReason: "Could not verify face in photo" };
  }

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return {
        validationStatus: result.decision === "approved" ? "approved" : "rejected",
        validationReason: result.reason || "",
      };
    }
  } catch {
    // fall through to default rejection
  }

  return { validationStatus: "rejected", validationReason: "Could not verify face in photo" };
}

/** Pure function: given validation result and bonus state, compute the award. */
export function determinePhotoBonus(
  validationStatus: "approved" | "rejected",
  hasAlreadyEarnedBonus: boolean,
): { shareCoinsAwarded: number; message: string } {
  if (hasAlreadyEarnedBonus) {
    return { shareCoinsAwarded: 0, message: "Profile photo updated!" };
  }
  if (validationStatus === "approved") {
    return { shareCoinsAwarded: 1, message: "Profile photo uploaded! You earned 1 ShareCoin." };
  }
  return {
    shareCoinsAwarded: 0,
    message: "Photo saved. Make sure your photo clearly shows your face to earn 1 ShareCoin.",
  };
}
