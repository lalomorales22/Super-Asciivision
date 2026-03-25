import clsx from "clsx";

type AppPage = "tiles" | "chat" | "imagine" | "voice" | "editor" | "ide" | "hands" | "music";

export function NavTab({
  pageId,
  active,
  onClick,
  children,
}: {
  pageId: AppPage;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      data-page={pageId}
      type="button"
      onClick={onClick}
      className={clsx(
        "relative z-10 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-[0.18em] transition-colors duration-300",
        active ? "text-emerald-50" : "text-stone-400 hover:text-stone-100",
      )}
    >
      {children}
    </button>
  );
}
