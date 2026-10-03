import { notificationDisplayMessage } from "../notificationCopy";

describe("badge notification reward copy", () => {
  it("moves an explicitly awarded legacy reward to the visible start of the message", () => {
    expect(
      notificationDisplayMessage(
        "badge_earned",
        "You earned the Helpful Neighbour badge! +1 ShareCoin awarded!",
      ),
    ).toBe("+1 ShareCoin earned. You earned the Helpful Neighbour badge!");
  });

  it("keeps the server's new reward prefix and description", () => {
    const message = "+1 ShareCoin earned. You earned the Helpful Neighbour badge!";
    expect(notificationDisplayMessage("badge_earned", message)).toBe(message);
  });

  it("does not invent a reward for historic badges without an explicit credit", () => {
    const message = "You earned the Community Helper badge!";
    expect(notificationDisplayMessage("badge_earned", message)).toBe(message);
  });

  it("does not rewrite reward wording on other notification types", () => {
    const message = "A badge message: +1 ShareCoin awarded!";
    expect(notificationDisplayMessage("sharecoin_earned", message)).toBe(message);
  });
});