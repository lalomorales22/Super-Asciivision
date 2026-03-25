export function EmptyPanel({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-[22px] border border-dashed border-white/8 bg-white/[0.02] p-4">
      <p className="text-[10px] uppercase tracking-[0.35em] text-[#84a09b]">{eyebrow}</p>
      <h3 className="mt-2.5 text-[13px] font-semibold text-stone-100">{title}</h3>
      <p className="mt-2 text-[11px] leading-6 text-stone-500">{body}</p>
    </div>
  );
}
