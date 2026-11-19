import { describe, expect, it } from "vitest";
import { originPolicy, originsProblem } from "./qa-origins.ts";

describe("originPolicy", () => {
  it("lets a walk reach this machine on any port, and nothing else, by default", () => {
    const allowed = originPolicy(["local"]);
    for (const url of [
      "http://localhost:3000/",
      "https://127.0.0.1:8443/x",
      "http://[::1]:5173/",
      "ws://localhost:3000/socket",
    ])
      expect(allowed(url)).toBe(true);
    for (const url of [
      "https://example.com/",
      "http://10.0.0.5:3000/",
      "http://localhost.example.com/",
      "http://app.localhost/",
      "http://127.0.0.2:3000/",
      "file:///etc/passwd",
      "data:text/plain,x",
      "not a url",
    ])
      expect(allowed(url)).toBe(false);
  });

  it("takes exact origins from the config, which can replace this machine", () => {
    const allowed = originPolicy(["https://staging.example.com"]);
    expect(allowed("https://staging.example.com/cart")).toBe(true);
    expect(allowed("wss://staging.example.com/live")).toBe(true);
    expect(allowed("http://staging.example.com/cart")).toBe(false);
    expect(allowed("https://staging.example.com:8443/")).toBe(false);
    expect(allowed("http://localhost:3000/")).toBe(false);
  });
});

describe("originsProblem", () => {
  it("accepts local and origins, and names whatever else it was given", () => {
    expect(originsProblem(["local", "https://cdn.example.com"])).toBeUndefined();
    expect(originsProblem([])).toBeUndefined();
    expect(originsProblem(["*", "https://cdn.example.com/path", "ftp://x"])).toBe(
      'qa.origins takes "local" (this machine, any port) and origins such as "https://staging.example.com", not "*", "https://cdn.example.com/path", "ftp://x"',
    );
    expect(originsProblem("local")).toContain('not "local"');
  });
});
