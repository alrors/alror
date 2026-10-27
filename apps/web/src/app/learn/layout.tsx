import type { Metadata } from "next";
import Link from "next/link";
import { LogoMark } from "@/components/navbar";
import { viewerIsAdmin } from "@/lib/server/learn/viewer";

export const metadata: Metadata = {
  title: { default: "Learn · Alror", template: "%s · Alror Learn" },
  description: "Short video lectures on shipping changes safely with Alror.",
};

export default async function LearnLayout({ children }: LayoutProps<"/learn">) {
  const admin = await viewerIsAdmin();
  return (
    <div className="flex min-h-dvh flex-col bg-con-bg text-con-fg">
      <header className="sticky top-0 z-30 border-b border-con-line bg-con-bg/90 backdrop-blur">
        <div className="mx-auto flex h-12 w-full max-w-[1400px] items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 text-[14px] font-semibold tracking-[-0.02em]">
            <LogoMark className="h-5 w-5" />
            <span className="hidden sm:inline">Alror</span>
          </Link>
          <span className="text-con-line-hover">/</span>
          <Link href="/learn" className="text-[14px] font-medium text-con-fg">
            Learn
          </Link>
          {admin && (
            <Link
              href="/admin/learn"
              className="ml-auto inline-flex h-7 items-center rounded-md border border-con-line px-2.5 text-[12px] text-con-fg2 hover:border-con-line-hover hover:text-con-fg"
            >
              Manage lectures
            </Link>
          )}
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
