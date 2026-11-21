export default function ReviewLoading() {
  return (
    <div className="mx-auto min-h-screen w-full max-w-[560px] border-x border-white/[0.04] bg-black pb-12">
      <div className="flex items-center justify-between px-5 pt-5">
        <div className="h-3 w-24 rounded skeleton" />
        <div className="h-3 w-14 rounded skeleton" />
      </div>

      <div className="mt-6 flex items-center gap-3 px-5">
        <div className="h-12 w-12 rounded-full skeleton" />
        <div className="space-y-1.5">
          <div className="h-4 w-32 rounded skeleton" />
          <div className="h-3 w-20 rounded skeleton" />
        </div>
      </div>

      <div className="mt-6 space-y-3 px-5">
        <div className="h-28 rounded-2xl skeleton" />
        <div className="h-4 w-2/3 rounded skeleton" />
        <div className="h-4 w-full rounded skeleton" />
        <div className="h-4 w-5/6 rounded skeleton" />
        <div className="h-24 rounded-2xl skeleton" />
      </div>
    </div>
  );
}
