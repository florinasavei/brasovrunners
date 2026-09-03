import { notFound } from "next/navigation";

// Any path under a valid locale that no page claims renders the locale's not-found page.
export default function CatchAllPage() {
  notFound();
}
