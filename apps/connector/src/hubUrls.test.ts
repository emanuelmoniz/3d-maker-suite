import { describe, expect, it } from "vitest";
import { announced, answered, hubOrigins, linkOf, normalizeHubUrl, tryOrder } from "./hubUrls.ts";

describe("hub addresses", () => {
  it("keeps an http(s) address as origin and path, without a trailing slash", () => {
    expect(normalizeHubUrl(" https://maker.example.com/ ")).toBe("https://maker.example.com");
    expect(normalizeHubUrl("http://nas:4300/maker//")).toBe("http://nas:4300/maker");
    expect(normalizeHubUrl("ftp://nas")).toBeUndefined();
    expect(normalizeHubUrl("nas:4300")).toBeUndefined();
    expect(normalizeHubUrl("")).toBeUndefined();
  });

  it("puts an announced address first, once, and at most four", () => {
    const s = { hubUrl: "http://old:4300", nextHubUrls: ["http://b"] };
    expect(announced(s, "http://a/")).toEqual({ nextHubUrls: ["http://a", "http://b"] });
    expect(announced(s, "http://b")).toBeUndefined(); // the newest already
    expect(announced({ ...s, nextHubUrls: ["http://a", "http://b"] }, "http://b")).toEqual({
      nextHubUrls: ["http://b", "http://a"],
    });
    expect(announced(s, "http://old:4300/")).toBeUndefined(); // the one in use
    expect(announced(s, "http://a", new Set(["http://a"]))).toBeUndefined(); // refused this run
    expect(announced(s, "not a url")).toBeUndefined();
    const many = {
      hubUrl: "http://old",
      nextHubUrls: ["http://h1", "http://h2", "http://h3", "http://h4"],
    };
    expect(announced(many, "http://h5")?.nextHubUrls).toEqual([
      "http://h5",
      "http://h1",
      "http://h2",
      "http://h3",
    ]);
  });

  it("tries the newest first and the one in use last", () => {
    expect(tryOrder({ hubUrl: "http://old", nextHubUrls: ["http://new", "http://mid"] })).toEqual([
      "http://new",
      "http://mid",
      "http://old",
    ]);
    expect(tryOrder({})).toEqual([]);
  });

  it("drops the older addresses once a newer one answered, and keeps the pairing identity", () => {
    const s = {
      hubUrl: "http://old",
      nextHubUrls: ["http://newest", "http://mid"],
      deviceId: "d1",
    };
    // Paired before 6.3.0: the identity is the address it paired at.
    expect(answered(s, "http://mid")).toEqual({
      hubUrl: "http://mid",
      nextHubUrls: ["http://newest"],
      link: "http://old|d1",
    });
    expect(answered({ ...s, link: "http://first|d1" }, "http://newest")).toEqual({
      hubUrl: "http://newest",
      nextHubUrls: [],
      link: "http://first|d1",
    });
    expect(answered(s, "http://old")).toBeUndefined();
    expect(linkOf(s)).toBe("http://old|d1");
  });

  it("lists the origins the paired hub may be opened at", () => {
    expect(
      hubOrigins({ hubUrl: "http://nas:4300/maker", nextHubUrls: ["https://maker.example.com"] }),
    ).toEqual(["https://maker.example.com", "http://nas:4300"]);
  });
});
