"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { site, cn } from "@/lib/site";
import { Button } from "./ui";
import { DOCS_URL, REPO_URL } from "./landing/links";

const links = [
  { href: "/#platform", label: "Product" },
  { href: "/#cli", label: "Developers" },
  { href: "/#console", label: "Console" },
  { href: "/#open-source", label: "Open source" },
  { href: DOCS_URL, label: "Docs", external: true },
];

/** The Alror mark: a release gate with one change passing through. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("h-6 w-6", className)} aria-hidden>
      <rect x="0.5" y="0.5" width="23" height="23" rx="7" fill="#151518" stroke="#2d2d32" />
      <path d="M7 18v-7a5 5 0 0 1 10 0v7" fill="none" stroke="#f2f2f3" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12" cy="15.5" r="1.9" fill="#35e08f" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.03em]">
      <LogoMark />
      {site.name.toLowerCase()}
    </Link>
  );
}

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); menuButton.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onResize = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener("change", onResize);
    return () => { window.removeEventListener("keydown", onKey); desktop.removeEventListener("change", onResize); };
  }, [open]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "lp-nav sticky top-0 z-50 border-b transition-colors duration-200",
        scrolled || open ? "border-[#1d1d22] bg-[#08080a]/85 backdrop-blur-xl" : "border-transparent bg-transparent",
      )}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:rounded-md focus:bg-white focus:px-3 focus:py-1.5 focus:text-sm focus:text-black"
      >
        Skip to content
      </a>
      <nav aria-label="Main" className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between px-4 sm:px-8">
        <div className="flex items-center gap-8">
          <Logo />
          <ul className="hidden items-center gap-0.5 text-[13.5px] text-[#a3a3ad] lg:flex">
            {links.map((l) => (
              <li key={l.label}>
                <a
                  href={l.href}
                  {...(l.external ? { target: "_blank", rel: "noreferrer" } : {})}
                  className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-white/60"
                >
                  {l.label}
                  {l.external && <ArrowUpRight className="h-3 w-3 text-[#6e6e78]" aria-hidden />}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div className="hidden items-center gap-1 lg:flex">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Alror CLI on GitHub"
            className="grid h-8 w-8 place-items-center rounded-md text-[#a3a3ad] transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-white/60"
          >
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor" aria-hidden>
              <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.2-3.1-.1-.4-.5-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.7 1.6.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.1 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1.1.9 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3" />
            </svg>
          </a>
          <Button href="/login" variant="ghost">Sign in</Button>
          <Button href="/#cli" variant="primary" className="lp-button-accent ml-2">Get started</Button>
        </div>

        <button
          ref={menuButton}
          type="button"
          className="grid h-9 w-9 place-items-center rounded-lg text-[#a3a3ad] hover:text-fg focus-visible:outline-2 focus-visible:outline-white/60 lg:hidden"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-menu"
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </nav>

      {open && (
        <div id="mobile-menu" className="border-t border-[#1d1d22] px-4 pb-4 lg:hidden">
          <ul className="py-2">
            {links.map((l) => (
              <li key={l.label}>
                <a
                  href={l.href}
                  {...(l.external ? { target: "_blank", rel: "noreferrer" } : {})}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-between rounded-lg px-2 py-3 text-[15px] text-[#d4d4d8] hover:bg-white/[0.04]"
                >
                  {l.label}
                  {l.external && <ArrowUpRight className="h-3.5 w-3.5 text-[#6e6e78]" aria-hidden />}
                </a>
              </li>
            ))}
            <li>
              <a href={REPO_URL} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-lg px-2 py-3 text-[15px] text-[#d4d4d8] hover:bg-white/[0.04]">
                GitHub
                <ArrowUpRight className="h-3.5 w-3.5 text-[#6e6e78]" aria-hidden />
              </a>
            </li>
          </ul>
          <div className="grid grid-cols-2 gap-2 border-t border-[#1d1d22] pt-3">
            <Button href="/login" variant="secondary" size="md">Sign in</Button>
            <Link href="/#cli" onClick={() => setOpen(false)} className="lp-button-accent inline-flex h-10 items-center justify-center rounded-lg text-sm font-medium">Get started</Link>
          </div>
        </div>
      )}
    </header>
  );
}
