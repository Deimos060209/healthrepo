import type { Metadata } from "next";

export const metadata: Metadata = { title: "File a complaint" };

export default function ComplaintLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
