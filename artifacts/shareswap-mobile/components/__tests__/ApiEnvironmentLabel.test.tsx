import React, { act } from "react";
import renderer from "react-test-renderer";
import { Text } from "react-native";
import { ApiEnvironmentLabel } from "../ApiEnvironmentLabel";

jest.mock("@/lib/api", () => ({ BASE_URL: "https://configured-project.replit.dev" }));

function renderLabel(baseUrl?: string) {
  let tree!: renderer.ReactTestRenderer;
  act(() => { tree = renderer.create(<ApiEnvironmentLabel baseUrl={baseUrl} />); });
  return tree;
}

function visibleText(tree: renderer.ReactTestRenderer) {
  return tree.root.findAllByType(Text)
    .map(node => [node.props.children].flat().join(""))
    .join(" ");
}

describe("API environment label", () => {
  let tree: renderer.ReactTestRenderer | undefined;
  afterEach(() => {
    if (tree) act(() => { tree!.unmount(); });
    tree = undefined;
  });

  test("defaults to the same configured API address used by app requests", () => {
    tree = renderLabel();
    expect(visibleText(tree)).toContain("API environment: Development");
    expect(visibleText(tree)).toContain("configured-project.replit.dev");
    expect(visibleText(tree)).toContain("Test accounts and data");
  });

  test("clearly displays production with its actual API host", () => {
    tree = renderLabel("https://shareswap.app");
    expect(visibleText(tree)).toContain("API environment: Production");
    expect(visibleText(tree)).toContain("API server: shareswap.app");
    expect(visibleText(tree)).toContain("Live accounts and data");
  });

  test("exposes a readable unknown state to screen readers", () => {
    tree = renderLabel("https://staging.example.com");
    const label = tree.root.findByProps({ testID: "api-environment-label" });
    expect(label.props.accessibilityLabel).toContain("Unknown environment");
    expect(label.props.accessibilityLabel).toContain("staging.example.com");
    expect(visibleText(tree)).toContain("Check the API configuration");
  });
});