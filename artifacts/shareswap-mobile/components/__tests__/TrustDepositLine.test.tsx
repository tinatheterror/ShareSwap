import React, { act } from "react";
import renderer from "react-test-renderer";
import { Text } from "react-native";
import colors from "@/constants/colors";
import { TrustDepositLine } from "../TrustDepositLine";

function render(element: React.ReactElement) {
  let tree!: renderer.ReactTestRenderer;
  act(() => { tree = renderer.create(element); });
  return tree;
}
const texts = (tree: renderer.ReactTestRenderer) => tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join(""));
const tap = (tree: renderer.ReactTestRenderer) => act(() => { tree.root.findAll((n) => n.props.accessibilityRole === "button" && typeof n.props.onPress === "function")[0].props.onPress(); });
const flat = (style: any) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

describe("TrustDepositLine", () => {
  let tree: renderer.ReactTestRenderer | undefined;
  afterEach(() => { if (tree) act(() => { tree!.unmount(); }); tree = undefined; });

  it("without a discount it is the plain amount", () => {
    tree = render(<TrustDepositLine base={195} amount={195} discountPercentage={0} />);
    expect(texts(tree)).toEqual(["Trust Deposit: ", "$195"]);
    expect(tree.root.findAllByProps({ testID: "trust-deposit-line-through" })).toHaveLength(0);
  });

  it("with a discount: black struck amount under a teal line, then the teal discounted amount", () => {
    tree = render(<TrustDepositLine base={195} amount={78} discountPercentage={60} />);
    expect(texts(tree)).toEqual(["Trust Deposit: ", "$195", "$78"]);
    const struck = tree.root.findByProps({ testID: "trust-deposit-struck" });
    const baseText = struck.findByType(Text);
    expect(flat(baseText.props.style).color).toBe(colors.light.foreground);
    expect(flat(tree.root.findByProps({ testID: "trust-deposit-line-through" }).props.style).backgroundColor).toBe(colors.light.primary);
    expect(flat(tree.root.findAllByProps({ testID: "trust-deposit-amount" })[0].props.style).color).toBe(colors.light.primaryDark);
  });

  it("tapping shows why it is discounted, and tapping again hides it", () => {
    tree = render(<TrustDepositLine base={195} amount={78} discountPercentage={60} />);
    expect(tree.root.findAllByProps({ testID: "trust-deposit-tooltip" })).toHaveLength(0);
    tap(tree);
    expect(texts(tree)).toContain("Discounted 60% by your trust score");
    tap(tree);
    expect(tree.root.findAllByProps({ testID: "trust-deposit-tooltip" })).toHaveLength(0);
  });
});
