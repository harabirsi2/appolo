export default function ProfileLoading() {
  return (
    <div className="mx-auto min-h-screen w-full max-w-[560px] border-x border-white/[0.04] bg-black pb-12">
      <div className="flex items-center justify-between px-5 pt-5">
        <div className="h-6 w-20 rounded-md skeleton" />
        <div className="h-8 w-20 rounded-full skeleton" />
      </div>

      <div className="mt-6 flex flex-col items-center gap-3 px-5">
        <div className="h-20 w-20 rounded-full skeleton" />
        <div className="h-5 w-40 rounded skeleton" />
        <div className="h-3 w-24 rounded skeleton" />
      </div>

      <div className="mt-8 grid grid-cols-3 gap-2 px-5">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-16 rounded-2xl skeleton" />
        ))}
      </div>

      <div className="mt-8 space-y-3 px-5">
        <div className="h-4 w-28 rounded skeleton" />
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="h-16 rounded-2xl skeleton" />
        ))}
      </div>
    </div>
  );
}
