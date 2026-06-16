"use client";

function Bone({ h = "h-4", w = "w-full" }: { h?: string; w?: string }) {
  return (
    <div
      className={`${h} ${w} rounded animate-pulse`}
      style={{ background: "var(--bg-raised)" }}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded ${className ?? ""}`} style={{ background: "var(--bg-raised)" }} />;
}

export function AnalysisSkeleton() {
  return (
    <div className="space-y-3">
      <div className="panel px-3 py-2 flex gap-4">
        <Bone h="h-5" w="w-16" />
        <Bone h="h-5" w="w-24" />
        <Bone h="h-5" w="w-12" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="panel p-4 flex flex-col gap-3">
          <div className="flex justify-center"><Bone h="h-12" w="w-12" /></div>
          <Bone h="h-8" w="w-32 mx-auto" />
          <Bone h="h-2" />
          <div className="grid grid-cols-2 gap-2"><Bone h="h-10" /><Bone h="h-10" /></div>
        </div>
        <div className="panel p-3 space-y-2">
          <Bone h="h-4" w="w-28" />
          {[...Array(4)].map((_, i) => <Bone key={i} h="h-10" />)}
        </div>
        <div className="panel p-3 space-y-2">
          <Bone h="h-4" w="w-28" />
          <div className="grid grid-cols-2 gap-2">{[...Array(4)].map((_, i) => <Bone key={i} h="h-10" />)}</div>
          <Bone h="h-24" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="panel p-3 space-y-3">
          <Bone h="h-4" w="w-32" />
          {[...Array(7)].map((_, i) => <Bone key={i} h="h-6" />)}
        </div>
        <div className="panel p-3 space-y-2">
          <Bone h="h-4" w="w-24" />
          {[...Array(5)].map((_, i) => <Bone key={i} h="h-4" />)}
        </div>
      </div>
    </div>
  );
}
