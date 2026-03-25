import clsx from "clsx";

export function ResizeHandle({
  orientation,
  onPointerDown,
}: {
  orientation: "vertical" | "horizontal";
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      onPointerDown={onPointerDown}
      className={clsx("relative bg-transparent", orientation === "vertical" ? "cursor-col-resize" : "cursor-row-resize")}
    >
      <div
        className={clsx(
          "absolute inset-0 m-auto rounded-full bg-white/6 transition hover:bg-white/12",
          orientation === "vertical" ? "h-16 w-[2px]" : "h-[2px] w-16",
        )}
      />
    </div>
  );
}
