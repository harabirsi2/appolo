export default function TasteLoading() {
  return (
    <div className="px-5 pt-6">
      <div className="h-7 w-28 rounded skeleton" />
      <div className="mt-5 h-32 rounded-2xl skeleton" />
      <div className="mt-4 grid grid-cols-2 gap-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-20 rounded-2xl skeleton" />
        ))}
      </div>
      <div className="mt-6 space-y-3">
        <div className="h-4 w-32 rounded skeleton" />
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-14 rounded-2xl skeleton" />
        ))}
      </div>
    </div>
  );
}
