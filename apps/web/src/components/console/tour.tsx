"use client";

import "driver.js/dist/driver.css";
import "./tour.css";
import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { driver, type DriveStep } from "driver.js";
import { tourById, type TourId } from "@/lib/console/tours";

// Runs console tours with driver.js. Link to any page with ?tour=<id> to start
// one there (the Help menu and command palette do this).

/** Visible on screen (not display:none, not inside a collapsed or hidden ancestor). */
function visible(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
}

function run(id: TourId) {
  const tour = tourById(id);
  if (!tour) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const steps: DriveStep[] = [];
  for (const s of tour.steps) {
    const popover = { title: s.title, description: s.body, side: s.side, align: "start" as const };
    if (!s.anchor) {
      steps.push({ popover });
      continue;
    }
    const el = Array.from(document.querySelectorAll(`[data-tour="${s.anchor}"]`)).find(visible);
    if (el) steps.push({ element: el, popover });
  }
  if (!steps.length) return;
  const d = driver({
    steps,
    animate: !reduced,
    smoothScroll: !reduced,
    showProgress: steps.length > 1,
    progressText: "{{current}} of {{total}}",
    nextBtnText: "Next",
    prevBtnText: "Back",
    doneBtnText: "Done",
    overlayColor: "#000",
    overlayOpacity: 0.62,
    stagePadding: 6,
    stageRadius: 8,
    popoverClass: "alror-tour",
  });
  d.drive();
}

/** Mounted once in the console shell. */
export function TourHost() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  // ?tour=<id> starts a tour once the page has rendered, then drops the param.
  const wanted = params.get("tour");
  useEffect(() => {
    if (!wanted || !tourById(wanted)) return;
    const next = new URLSearchParams(params.toString());
    next.delete("tour");
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
    const t = setTimeout(() => run(wanted as TourId), 400);
    return () => clearTimeout(t);
  }, [wanted, params, pathname, router]);

  return null;
}
