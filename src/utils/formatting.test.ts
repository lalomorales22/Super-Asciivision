import { describe, expect, it } from "vitest";
import {
  clamp,
  formatFileSize,
  formatTimestamp,
  formatEditableDuration,
  formatTimelineSeconds,
  formatDuration,
  parseSecondsInput,
} from "./formatting";

describe("clamp", () => {
  it("returns value when within range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  it("clamps to minimum", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });
  it("clamps to maximum", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });
  it("handles equal min and max", () => {
    expect(clamp(5, 3, 3)).toBe(3);
  });
});

describe("formatFileSize", () => {
  it("formats bytes", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
  });
  it("formats kilobytes", () => {
    expect(formatFileSize(1024)).toBe("1 KB");
    expect(formatFileSize(2048)).toBe("2 KB");
  });
  it("formats megabytes", () => {
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });
  it("formats gigabytes", () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe("1.0 GB");
  });
});

describe("formatTimestamp", () => {
  it("returns Never for null/undefined/empty", () => {
    expect(formatTimestamp(null)).toBe("Never");
    expect(formatTimestamp(undefined)).toBe("Never");
    expect(formatTimestamp("")).toBe("Never");
  });
  it("returns raw string for invalid date", () => {
    expect(formatTimestamp("not-a-date")).toBe("not-a-date");
  });
  it("formats valid ISO date", () => {
    const result = formatTimestamp("2024-01-15T10:30:00Z");
    expect(result).toBeTruthy();
    expect(result).not.toBe("Never");
  });
});

describe("formatEditableDuration", () => {
  it("formats whole numbers without decimals", () => {
    expect(formatEditableDuration(5)).toBe("5");
  });
  it("strips trailing zeros", () => {
    expect(formatEditableDuration(5.1)).toBe("5.1");
    expect(formatEditableDuration(5.0)).toBe("5");
  });
  it("handles non-finite values", () => {
    expect(formatEditableDuration(Infinity)).toBe("0");
    expect(formatEditableDuration(NaN)).toBe("0");
  });
  it("clamps negative to zero", () => {
    expect(formatEditableDuration(-3)).toBe("0");
  });
});

describe("formatTimelineSeconds", () => {
  it("formats small values with one decimal", () => {
    expect(formatTimelineSeconds(1.5)).toBe("1.5s");
    expect(formatTimelineSeconds(0.3)).toBe("0.3s");
  });
  it("formats values >= 10 without decimal", () => {
    expect(formatTimelineSeconds(10)).toBe("10s");
    expect(formatTimelineSeconds(12.7)).toBe("13s");
  });
  it("removes trailing .0", () => {
    expect(formatTimelineSeconds(5.0)).toBe("5s");
  });
});

describe("formatDuration", () => {
  it("formats seconds as M:SS", () => {
    expect(formatDuration(0)).toBe("--:--");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(125)).toBe("2:05");
    expect(formatDuration(3)).toBe("0:03");
  });
  it("returns --:-- for null/undefined/NaN", () => {
    expect(formatDuration(null)).toBe("--:--");
    expect(formatDuration(undefined)).toBe("--:--");
    expect(formatDuration(NaN)).toBe("--:--");
  });
});

describe("parseSecondsInput", () => {
  it("parses valid numbers", () => {
    expect(parseSecondsInput("5")).toBe(5);
    expect(parseSecondsInput("3.14")).toBe(3.14);
    expect(parseSecondsInput("0")).toBe(0);
  });
  it("returns fallback for empty string", () => {
    expect(parseSecondsInput("", 10)).toBe(10);
    expect(parseSecondsInput("  ", 10)).toBe(10);
  });
  it("returns fallback for negative values", () => {
    expect(parseSecondsInput("-5", 0)).toBe(0);
  });
  it("returns undefined with no fallback for invalid", () => {
    expect(parseSecondsInput("abc")).toBeUndefined();
    expect(parseSecondsInput("")).toBeUndefined();
  });
  it("trims whitespace", () => {
    expect(parseSecondsInput("  7  ")).toBe(7);
  });
});
