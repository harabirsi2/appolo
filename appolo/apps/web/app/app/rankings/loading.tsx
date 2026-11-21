export default function RankingsLoading() {
  return (
    <div className="px-5 pt-6">
      <div className="flex items-center justify-between">
        <div className="h-7 w-36 rounded skeleton" />
        <div className="h-8 w-20 rounded-full skeleton" />
      </div>
      <div className="mt-4 flex gap-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="h-8 w-16 rounded-full skeleton" />
        ))}
      </div>
      <div className="mt-6 space-y-2">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="flex items-center gap-3">
            <div className="h-5 w-5 rounded skeleton" />
            <div className="h-14 w-11 rounded-lg skeleton" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/3 rounded skeleton" />
              <div className="h-3 w-1/3 rounded skeleton" />
            </div>
            <div className="h-8 w-10 rounded skeleton" />
          </div>
        ))}
      </div>
    </div>
  );
}
