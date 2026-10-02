/**
 * Console page entrance: each top-level section (overview, deployments, jobs, ...)
 * fades up once when it is opened. Templates remount per segment, layouts do not.
 * The motion is .con-fade-up from globals.css, which honours prefers-reduced-motion.
 */
export default function ConsoleTemplate({ children }: { children: React.ReactNode }) {
  return <div className="con-fade-up">{children}</div>;
}
