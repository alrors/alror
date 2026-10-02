import { notFound } from "next/navigation";

// Unknown console paths render the console not-found page inside the shell
// instead of the site-wide 404.
export default function MissingConsolePage() {
  notFound();
}
