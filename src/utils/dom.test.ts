import { describe, expect, it } from "vitest";
import { shouldStartWindowDrag, isEditableTarget } from "./dom";

describe("shouldStartWindowDrag", () => {
  it("returns true for null target", () => {
    expect(shouldStartWindowDrag(null)).toBe(true);
  });
  it("returns true for plain div", () => {
    const div = document.createElement("div");
    expect(shouldStartWindowDrag(div)).toBe(true);
  });
  it("returns false for button", () => {
    const button = document.createElement("button");
    expect(shouldStartWindowDrag(button)).toBe(false);
  });
  it("returns false for input", () => {
    const input = document.createElement("input");
    expect(shouldStartWindowDrag(input)).toBe(false);
  });
  it("returns false for elements inside a button", () => {
    const button = document.createElement("button");
    const span = document.createElement("span");
    button.appendChild(span);
    document.body.appendChild(button);
    expect(shouldStartWindowDrag(span)).toBe(false);
    document.body.removeChild(button);
  });
  it("returns false for data-no-drag elements", () => {
    const div = document.createElement("div");
    div.dataset.noDrag = "true";
    document.body.appendChild(div);
    expect(shouldStartWindowDrag(div)).toBe(false);
    document.body.removeChild(div);
  });
});

describe("isEditableTarget", () => {
  it("returns false for null", () => {
    expect(isEditableTarget(null)).toBe(false);
  });
  it("returns true for input", () => {
    expect(isEditableTarget(document.createElement("input"))).toBe(true);
  });
  it("returns true for textarea", () => {
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
  });
  it("returns true for select", () => {
    expect(isEditableTarget(document.createElement("select"))).toBe(true);
  });
  // jsdom does not support isContentEditable — skip this case
  it.skip("returns true for contenteditable", () => {
    const div = document.createElement("div");
    div.contentEditable = "true";
    document.body.appendChild(div);
    expect(isEditableTarget(div)).toBeTruthy();
    document.body.removeChild(div);
  });
  it("returns false for plain div", () => {
    expect(isEditableTarget(document.createElement("div"))).toBeFalsy();
  });
});
