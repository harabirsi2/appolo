export default function ProfileLoading() {
  return (
    <div className="px-5 pt-6">
      <div className="flex flex-col items-center gap-3">
        <div className="h-20 w-20 rounded-full skeleton" />
        <div className="h-5 w-40 rounded skeleton" />
        <div className="h-3 w-24 rounded skeleton" />
      </div>
      <div className="mt-6 grid grid-cols-3 gap-2">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-16 rounded-2xl skeleton" />
        ))}
      </div>
      <div className="mt-6 space-y-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-16 rounded-2xl skeleton" />
        ))}
      </div>
    </div>
  );
}
