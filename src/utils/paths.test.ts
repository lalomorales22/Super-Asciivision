import { describe, expect, it } from "vitest";
import {
  leafName,
  parentPath,
  renamedPath,
  replacePathPrefix,
  relativeWorkspacePath,
  isSameOrDescendantPath,
  extensionForLanguage,
} from "./paths";

describe("leafName", () => {
  it("returns filename from path", () => {
    expect(leafName("/home/user/file.txt")).toBe("file.txt");
  });
  it("returns folder name", () => {
    expect(leafName("/home/user")).toBe("user");
  });
  it("handles single segment", () => {
    expect(leafName("file.txt")).toBe("file.txt");
  });
  it("handles empty string", () => {
    expect(leafName("")).toBe("");
  });
});

describe("parentPath", () => {
  it("returns parent directory", () => {
    expect(parentPath("/home/user/file.txt")).toBe("/home/user");
  });
  it("returns empty for root-level paths", () => {
    expect(parentPath("/file.txt")).toBe("");
  });
  it("handles no parent", () => {
    expect(parentPath("file.txt")).toBe("");
  });
  it("strips trailing slashes", () => {
    expect(parentPath("/home/user/")).toBe("/home");
  });
});

describe("renamedPath", () => {
  it("renames the leaf", () => {
    expect(renamedPath("/home/user/old.txt", "new.txt")).toBe("/home/user/new.txt");
  });
  it("handles no parent", () => {
    expect(renamedPath("old.txt", "new.txt")).toBe("new.txt");
  });
});

describe("replacePathPrefix", () => {
  it("replaces matching prefix", () => {
    expect(replacePathPrefix("/old/path/file.txt", "/old/path", "/new/path")).toBe("/new/path/file.txt");
  });
  it("replaces exact match", () => {
    expect(replacePathPrefix("/old/path", "/old/path", "/new/path")).toBe("/new/path");
  });
  it("returns original if prefix doesn't match", () => {
    expect(replacePathPrefix("/other/path/file.txt", "/old/path", "/new/path")).toBe("/other/path/file.txt");
  });
});

describe("relativeWorkspacePath", () => {
  it("returns path relative to matching root", () => {
    expect(relativeWorkspacePath("/home/user/project/src/file.ts", ["/home/user/project"])).toBe("src/file.ts");
  });
  it("returns leaf name when no root matches", () => {
    expect(relativeWorkspacePath("/other/file.ts", ["/home/user/project"])).toBe("file.ts");
  });
  it("returns leaf name when path is the root", () => {
    expect(relativeWorkspacePath("/home/user/project", ["/home/user/project"])).toBe("project");
  });
  it("normalizes backslashes", () => {
    expect(relativeWorkspacePath("C:\\Users\\file.ts", ["C:\\Users"])).toBe("file.ts");
  });
});

describe("isSameOrDescendantPath", () => {
  it("returns true for same path", () => {
    expect(isSameOrDescendantPath("/home/user", "/home/user")).toBe(true);
  });
  it("returns true for descendant", () => {
    expect(isSameOrDescendantPath("/home/user/file.txt", "/home/user")).toBe(true);
  });
  it("returns false for non-descendant", () => {
    expect(isSameOrDescendantPath("/other/path", "/home/user")).toBe(false);
  });
  it("does not match partial directory names", () => {
    expect(isSameOrDescendantPath("/home/username", "/home/user")).toBe(false);
  });
});

describe("extensionForLanguage", () => {
  it("maps known languages", () => {
    expect(extensionForLanguage("html")).toBe("html");
    expect(extensionForLanguage("javascript")).toBe("js");
    expect(extensionForLanguage("typescript")).toBe("ts");
    expect(extensionForLanguage("python")).toBe("py");
    expect(extensionForLanguage("rust")).toBe("rs");
    expect(extensionForLanguage("json")).toBe("json");
    expect(extensionForLanguage("tsx")).toBe("tsx");
    expect(extensionForLanguage("markdown")).toBe("md");
  });
  it("handles aliases", () => {
    expect(extensionForLanguage("js")).toBe("js");
    expect(extensionForLanguage("ts")).toBe("ts");
    expect(extensionForLanguage("py")).toBe("py");
    expect(extensionForLanguage("rs")).toBe("rs");
    expect(extensionForLanguage("md")).toBe("md");
    expect(extensionForLanguage("htm")).toBe("html");
    expect(extensionForLanguage("mjs")).toBe("js");
  });
  it("defaults to txt for unknown", () => {
    expect(extensionForLanguage("go")).toBe("txt");
    expect(extensionForLanguage()).toBe("txt");
    expect(extensionForLanguage("")).toBe("txt");
  });
  it("is case-insensitive", () => {
    expect(extensionForLanguage("HTML")).toBe("html");
    expect(extensionForLanguage("JavaScript")).toBe("js");
  });
});
