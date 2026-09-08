import type { Metadata } from "next";

export const metadata: Metadata = { title: "Scan detail" };

export default function HistoryDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
