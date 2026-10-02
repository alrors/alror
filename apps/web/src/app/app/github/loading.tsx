export default function Loading() {
  return <div className="space-y-7 animate-pulse motion-reduce:animate-none" role="status" aria-label="Loading GitHub integration"><div className="h-9 w-40 rounded bg-con-row" /><div className="h-4 w-3/4 rounded bg-con-row" /><div className="h-44 rounded-lg border border-con-line bg-con-panel" /><div className="h-10 border-b border-con-line" /><div className="h-56 rounded-lg border border-con-line bg-con-panel" /><span className="sr-only">Loading GitHub integration</span></div>;
}
