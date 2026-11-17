import { describe, expect, it } from "vitest";
import { oauthReturnPath } from "./oauth-return-path";

describe("oauthReturnPath", () => {
  it("keeps local consent paths, query parameters and fragments", () => {
    expect(oauthReturnPath("/.lovable/oauth/consent?authorization_id=abc#decision"))
      .toBe("/.lovable/oauth/consent?authorization_id=abc#decision");
  });

  it("rejects network-path redirects", () => {
    expect(oauthReturnPath("//outside.example/path")).toBe("/");
    expect(oauthReturnPath("/\\outside.example/path")).toBe("/");
  });

  it("rejects non-path input and control characters", () => {
    expect(oauthReturnPath("https://outside.example")).toBe("/");
    expect(oauthReturnPath("/safe\u0000path")).toBe("/");
  });
});