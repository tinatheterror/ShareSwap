import React from "react";
import { act } from "react";
import renderer from "react-test-renderer";
import { SwapFairnessSummary } from "../SwapFairnessSummary";

jest.mock("@expo/vector-icons", () => ({ Feather: () => null }));
jest.mock("lucide-react-native", () => ({ ArrowLeftRight: () => null }));

// The offset line reads like the chat's request card: "[name] pays you N ShareCoins." / "You pay [name] N ShareCoins."

const valuation = (dir: "you_pay" | "you_receive", offset: number) => ({ offset, exceedsMax: false, offsetDirection: dir, isFair: false });
async function text(el: React.ReactElement) {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(el);
  });
  return JSON.stringify(tree.toJSON());
}

test("when the other person pays, it names them", async () => {
  const out = await text(<SwapFairnessSummary yourSC={40} theirSC={20} valuation={valuation("you_receive", 20)} maxOffset={20} otherName="Tina L." />);
  expect(out).toContain("Tina L. pays you 20 ShareCoins.");
  expect(out).not.toContain("You receive");
});

test("when the viewer pays, it names the other person", async () => {
  const out = await text(<SwapFairnessSummary yourSC={10} theirSC={20} valuation={valuation("you_pay", 10)} maxOffset={20} otherName="Tina L." />);
  expect(out).toContain("You pay Tina L. 10 ShareCoins.");
});

test("without a name the old wording is kept (the counter-offer sheet)", async () => {
  const out = await text(<SwapFairnessSummary yourSC={40} theirSC={20} valuation={valuation("you_receive", 20)} maxOffset={20} />);
  expect(out).toContain("You receive +20 ShareCoins to balance");
});
