import { describe, expect, it } from "vitest";

import { isNewerVersion } from "../src/lib/version-check";

describe("isNewerVersion", () => {
  it("returns true when latest has higher major", () => {
    expect(isNewerVersion("1.2.3", "2.0.0")).toBe(true);
  });

  it("returns false when versions are equal", () => {
    expect(isNewerVersion("1.2.3", "1.2.3")).toBe(false);
  });

  it("returns false when latest is lower", () => {
    expect(isNewerVersion("1.2.3", "1.2.2")).toBe(false);
  });
});
