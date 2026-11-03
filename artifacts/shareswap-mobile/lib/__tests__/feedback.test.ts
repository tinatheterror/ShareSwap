import { parseFeedbackUrl } from "../feedback";

test("an https board URL is accepted, with surrounding spaces ignored", () => {
  expect(parseFeedbackUrl("  https://shareswap.userjot.com/ ")).toBe("https://shareswap.userjot.com/");
});

test("nothing, blanks, non-https and nonsense mean no Send feedback row", () => {
  for (const bad of [undefined, null, "", "   ", "http://shareswap.userjot.com", "javascript:alert(1)", "mailto:a@b.c", "not a url"]) {
    expect(parseFeedbackUrl(bad)).toBeNull();
  }
});

test("it does not add anything about the person to the address", () => {
  expect(parseFeedbackUrl("https://shareswap.userjot.com/board")).toBe("https://shareswap.userjot.com/board");
});
