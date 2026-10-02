import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Product name — change it here and it updates everywhere.
export const site = {
  name: "Alror",
  tagline: "Merge as fast as your AI writes.",
};

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
