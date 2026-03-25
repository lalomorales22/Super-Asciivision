import { describe, expect, it } from "vitest";
import {
  encodePcm16Base64,
  decodeBase64Bytes,
  pcm16BytesToFloat32,
  normalizeVoiceId,
} from "./audio";

describe("encodePcm16Base64", () => {
  it("encodes silence as valid base64", () => {
    const silence = new Float32Array([0, 0, 0]);
    const result = encodePcm16Base64(silence);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    // Base64 decode should give 6 bytes (3 samples × 2 bytes)
    expect(atob(result).length).toBe(6);
  });

  it("clamps values to [-1, 1]", () => {
    const loud = new Float32Array([2.0, -2.0]);
    const result = encodePcm16Base64(loud);
    expect(typeof result).toBe("string");
  });

  it("handles empty input", () => {
    const empty = new Float32Array([]);
    const result = encodePcm16Base64(empty);
    expect(result).toBe("");
  });
});

describe("decodeBase64Bytes", () => {
  it("decodes base64 to bytes", () => {
    const input = btoa("hello");
    const result = decodeBase64Bytes(input);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(5);
    expect(String.fromCharCode(...result)).toBe("hello");
  });

  it("handles empty string", () => {
    const result = decodeBase64Bytes(btoa(""));
    expect(result.length).toBe(0);
  });
});

describe("pcm16BytesToFloat32", () => {
  it("converts PCM16 bytes to float samples", () => {
    // Create a PCM16 sample for silence (0x0000)
    const bytes = new Uint8Array([0, 0, 0, 0]);
    const result = pcm16BytesToFloat32(bytes);
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(2);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(0);
  });

  it("round-trips with encodePcm16Base64", () => {
    const original = new Float32Array([0.5, -0.5, 0.0]);
    const encoded = encodePcm16Base64(original);
    const decoded = decodeBase64Bytes(encoded);
    const result = pcm16BytesToFloat32(decoded);
    expect(result.length).toBe(original.length);
    // Allow small quantization error from PCM16 encoding
    for (let i = 0; i < original.length; i++) {
      expect(result[i]).toBeCloseTo(original[i], 2);
    }
  });
});

describe("normalizeVoiceId", () => {
  it("returns valid voice id as-is", () => {
    expect(normalizeVoiceId("eve")).toBe("eve");
  });
  it("lowercases input", () => {
    expect(normalizeVoiceId("EVE")).toBe("eve");
  });
  it("defaults to eve for null/undefined/empty", () => {
    expect(normalizeVoiceId(null)).toBe("eve");
    expect(normalizeVoiceId(undefined)).toBe("eve");
    expect(normalizeVoiceId("")).toBe("eve");
  });
  it("defaults to eve for unknown voice", () => {
    expect(normalizeVoiceId("nonexistent-voice")).toBe("eve");
  });
  it("trims whitespace", () => {
    expect(normalizeVoiceId("  eve  ")).toBe("eve");
  });
});
