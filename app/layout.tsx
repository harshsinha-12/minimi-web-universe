import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "minimi — a little more context",
  description:
    "A thoughtful research companion that remembers your conversations and checks what has changed.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
