export default function AppLoading() {
  return (
    <div className="px-5 pt-6">
      <div className="flex items-center justify-between">
        <div className="h-6 w-24 rounded-md skeleton" />
        <div className="flex gap-2">
          <div className="h-8 w-8 rounded-full skeleton" />
          <div className="h-9 w-9 rounded-full skeleton" />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-2">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-16 rounded-2xl skeleton" />
        ))}
      </div>

      <div className="mt-8 space-y-3">
        <div className="h-4 w-28 rounded skeleton" />
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="w-[118px] shrink-0">
              <div className="aspect-square w-full rounded-xl skeleton" />
              <div className="mt-2 h-3 w-3/4 rounded skeleton" />
              <div className="mt-1.5 h-2.5 w-1/2 rounded skeleton" />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8 space-y-3">
        <div className="h-4 w-24 rounded skeleton" />
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-16 rounded-2xl skeleton" />
        ))}
      </div>
    </div>
  );
}
