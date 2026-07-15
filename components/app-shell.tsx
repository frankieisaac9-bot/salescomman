"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Crown, LayoutDashboard, Medal, PhoneCall, Settings, ShieldAlert, Trophy, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leaderboard", label: "Leaderboard", icon: Medal },
  { href: "/setters", label: "Setters", icon: Users },
  { href: "/closers", label: "Closers", icon: PhoneCall },
  { href: "/leads", label: "Leads", icon: ShieldAlert },
  { href: "/trophy-room", label: "Trophy Room", icon: Trophy },
  { href: "/objections", label: "Objections", icon: BarChart3 },
  { href: "/calls/new", label: "Log Call", icon: PhoneCall },
  { href: "/settings", label: "Settings", icon: Settings }
];

export function AppShell({ children, hiddenNav = [] }: { children: React.ReactNode; hiddenNav?: string[] }) {
  const pathname = usePathname();
  const visibleNav = navItems.filter((item) => !hiddenNav.includes(item.href));

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-white/10 bg-[#0b0d13]/95 p-4 backdrop-blur-xl lg:block">
        <Link href="/dashboard" className="mb-8 flex items-center gap-3 px-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-command-gold text-black shadow-gold">
            <Crown className="h-5 w-5" />
          </div>
          <div>
            <div className="text-lg font-black tracking-normal">SalesCommand</div>
            <div className="text-xs text-muted-foreground">Performance Ops</div>
          </div>
        </Link>
        <nav className="space-y-1">
          {visibleNav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
                  active
                    ? "bg-blue-500/15 text-blue-200 font-medium"
                    : "text-slate-300 hover:bg-white/10 hover:text-white"
                )}
              >
                <item.icon className={cn("h-4 w-4", active && "text-blue-300")} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0b0d13]/85 px-4 py-3 backdrop-blur-xl lg:hidden">
        <div className="flex items-center gap-3">
          <Crown className="h-5 w-5 text-command-gold" />
          <span className="font-bold">SalesCommand</span>
        </div>
        <nav className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {visibleNav.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-3 py-2 text-xs whitespace-nowrap",
                  active ? "bg-blue-500/20 text-blue-200" : "bg-white/5 text-slate-200"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="lg:pl-64">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
