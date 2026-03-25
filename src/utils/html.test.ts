import { describe, expect, it } from "vitest";
import { escapeHtml, buildPreviewDocument, buildAssetPreviewDocument } from "./html";
import type { MediaAsset } from "../types";

describe("escapeHtml", () => {
  it("escapes all special characters", () => {
    expect(escapeHtml('&<>"\''))
      .toBe("&amp;&lt;&gt;&quot;&#39;");
  });
  it("passes through safe strings", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });
  it("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });
});

describe("buildPreviewDocument", () => {
  it("returns raw HTML for html language", () => {
    expect(buildPreviewDocument("<h1>Hi</h1>", "html")).toBe("<h1>Hi</h1>");
    expect(buildPreviewDocument("<h1>Hi</h1>", "htm")).toBe("<h1>Hi</h1>");
  });
  it("wraps CSS in style tag", () => {
    const result = buildPreviewDocument("body { color: red }", "css");
    expect(result).toContain("<style>body { color: red }</style>");
  });
  it("wraps JS in script tag", () => {
    const result = buildPreviewDocument("console.log(1)", "javascript");
    expect(result).toContain('<script type="module">console.log(1)</script>');
  });
  it("wraps unknown languages in pre tag with escaped content", () => {
    const result = buildPreviewDocument("<b>code</b>", "python");
    expect(result).toContain("&lt;b&gt;code&lt;/b&gt;");
    expect(result).toContain("<pre");
  });
});

describe("buildAssetPreviewDocument", () => {
  const makeAsset = (kind: string): MediaAsset => ({
    id: "1",
    prompt: "test",
    filePath: "/path/to/file",
    kind,
    createdAt: "2024-01-01",
    fileSize: 1000,
  });

  it("renders image tag for image assets", () => {
    const result = buildAssetPreviewDocument(makeAsset("image"), "http://img.png");
    expect(result).toContain("<img");
    expect(result).toContain('src="http://img.png"');
  });
  it("renders video tag for video assets", () => {
    const result = buildAssetPreviewDocument(makeAsset("video"), "http://vid.mp4");
    expect(result).toContain("<video");
    expect(result).toContain("controls");
  });
  it("renders audio tag for audio assets", () => {
    const result = buildAssetPreviewDocument(makeAsset("audio"), "http://aud.mp3");
    expect(result).toContain("<audio");
    expect(result).toContain("controls");
  });
});
