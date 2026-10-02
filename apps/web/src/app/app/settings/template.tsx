/** Settings sub-pages swap with a quick fade while the settings nav stays put. */
export default function SettingsTemplate({ children }: { children: React.ReactNode }) {
  return <div className="con-fade min-w-0 space-y-6">{children}</div>;
}
