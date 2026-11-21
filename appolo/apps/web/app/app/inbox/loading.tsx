export default function InboxLoading() {
  return (
    <div className="px-5 pt-6">
      <div className="flex items-center justify-between">
        <div className="h-7 w-24 rounded skeleton" />
        <div className="h-8 w-24 rounded-full skeleton" />
      </div>
      <div className="mt-4 flex gap-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-8 w-20 rounded-full skeleton" />
        ))}
      </div>
      <div className="mt-6 space-y-2">
        {Array.from({ length: 7 }).map((_, index) => (
          <div key={index} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <div className="h-4 w-32 rounded skeleton" />
              <div className="h-3 w-12 rounded skeleton" />
            </div>
            <div className="mt-2 h-3 w-3/4 rounded skeleton" />
          </div>
        ))}
      </div>
    </div>
  );
}
