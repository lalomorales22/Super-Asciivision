export function shouldStartWindowDrag(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return true;
  }

  return !target.closest(
    '[data-no-drag="true"],button,input,select,textarea,a,[role="button"],[contenteditable="true"]',
  );
}

export function isEditableTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) {
    return false;
  }
  const tag = element.tagName?.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    element.isContentEditable
  );
}
