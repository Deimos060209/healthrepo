import type { Metadata } from "next";

export const metadata: Metadata = { title: "Scan history" };

export default function HistoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
