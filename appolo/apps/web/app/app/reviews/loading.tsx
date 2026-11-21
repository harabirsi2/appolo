export default function ReviewsLoading() {
  return (
    <div className="px-5 pt-6">
      <div className="flex items-center justify-between">
        <div className="h-7 w-32 rounded skeleton" />
        <div className="h-8 w-28 rounded-full skeleton" />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-16 rounded-2xl skeleton" />
        ))}
      </div>
      <div className="mt-6 space-y-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="space-y-2 rounded-2xl border border-border bg-surface p-4">
            <div className="h-4 w-1/2 rounded skeleton" />
            <div className="h-3 w-full rounded skeleton" />
            <div className="h-3 w-5/6 rounded skeleton" />
          </div>
        ))}
      </div>
    </div>
  );
}
