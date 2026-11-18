import { describe, expect, it } from "vitest";
import { brandMark } from "./branding.ts";

describe("brandMark", () => {
  it.each([
    [{ logo: "/api/branding/logo?v=1", showName: true }, "logo+name"],
    [{ logo: "/api/branding/logo?v=1", showName: false }, "logo"],
    [{ logo: undefined, showName: true }, "icon+name"],
    [{ logo: undefined, showName: false }, "wordmark"],
    // A missing version is no logo, whatever the name switch says.
    [{ logo: null, showName: false }, "wordmark"],
  ])("%j shows %s", (input, mark) => {
    expect(brandMark(input)).toBe(mark);
  });
});
