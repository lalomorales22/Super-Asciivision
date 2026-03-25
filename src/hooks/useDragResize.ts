import { useEffect, useState } from "react";

interface DragState {
  startX: number;
  startY: number;
  startValue: number;
}

/**
 * Hook for panel drag-resize interactions.
 *
 * Returns the current drag state and a starter function.
 * While dragging, calls `onDrag` with the pixel delta from the start position.
 * Cleans up global listeners on pointer-up or unmount.
 *
 * @param axis — "x" uses clientX delta, "y" uses clientY delta
 * @param onDrag — called with (startValue, delta) on each pointer move
 */
export function useDragResize(
  axis: "x" | "y",
  onDrag: (startValue: number, delta: number) => void,
): [
  dragging: boolean,
  startDrag: (event: React.PointerEvent, startValue: number) => void,
] {
  const [dragState, setDragState] = useState<DragState | undefined>();

  useEffect(() => {
    if (!dragState) return;

    const onPointerMove = (event: PointerEvent) => {
      const delta =
        axis === "x"
          ? event.clientX - dragState.startX
          : event.clientY - dragState.startY;
      onDrag(dragState.startValue, delta);
    };

    const onPointerUp = () => setDragState(undefined);

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [dragState, axis, onDrag]);

  const startDrag = (event: React.PointerEvent, startValue: number) => {
    setDragState({
      startX: event.clientX,
      startY: event.clientY,
      startValue,
    });
  };

  return [!!dragState, startDrag];
}
