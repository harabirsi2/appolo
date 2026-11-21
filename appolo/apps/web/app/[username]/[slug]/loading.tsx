export default function PodLoading() {
  return (
    <div className="mx-auto min-h-screen w-full max-w-[560px] border-x border-white/[0.04] bg-black pb-12">
      <div className="flex items-center justify-between px-5 pt-5">
        <div className="h-3 w-24 rounded skeleton" />
        <div className="h-3 w-14 rounded skeleton" />
      </div>

      <div className="mt-6 space-y-2 px-5">
        <div className="h-7 w-56 rounded skeleton" />
        <div className="h-3 w-32 rounded skeleton" />
      </div>

      <div className="mt-6 space-y-3 px-5">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-20 rounded-2xl skeleton" />
        ))}
      </div>
    </div>
  );
}
