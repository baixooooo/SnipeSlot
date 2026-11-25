import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { SnipeSlotProvider } from "@/components/SnipeSlotProvider";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "SnipeSlot — Autonomous Academic Slot Booking",
  description:
    "Single-user autonomous slot booking agent for the Saveetha Learner portal.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-white text-zinc-950 antialiased dark:bg-[#0b0b0c] dark:text-zinc-100">
        <ThemeProvider>
          <SnipeSlotProvider>
            <AppShell>{children}</AppShell>
          </SnipeSlotProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
