export default function CollectionsLoading() {
  return (
    <div className="px-5 pt-6">
      <div className="h-7 w-40 rounded skeleton" />
      <div className="mt-2 h-3 w-56 rounded skeleton" />
      <div className="mt-6 grid grid-cols-2 gap-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="aspect-[4/3] w-full skeleton" />
            <div className="space-y-2 p-3">
              <div className="h-4 w-3/4 rounded skeleton" />
              <div className="h-3 w-1/2 rounded skeleton" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
