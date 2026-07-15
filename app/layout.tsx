import type { Metadata } from "next";
import { Toaster } from "sonner";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "SalesCommand",
  description: "Sales performance command center"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  // HIDDEN_NAV: comma-separated nav paths to hide on this deployment,
  // e.g. "/leads,/trophy-room,/calls/new"
  const hiddenNav = (process.env.HIDDEN_NAV ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <html lang="en" className="dark">
      <body>
        <AppShell hiddenNav={hiddenNav}>{children}</AppShell>
        <Toaster theme="dark" richColors position="top-right" />
      </body>
    </html>
  );
}
