"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  MessageSquareText,
  StickyNote,
  BrainCircuit,
  Settings,
  LogOut,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import ThemeToggle from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";

const SECTIONS = [
  {
    label: "Workspace",
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
      { href: "/chat", label: "Chat & Agent", icon: MessageSquareText },
    ],
  },
  {
    label: "Knowledge",
    items: [
      { href: "/documents", label: "Documents", icon: FileText },
      { href: "/notes", label: "Notes", icon: StickyNote },
      { href: "/memory", label: "Memory", icon: BrainCircuit },
    ],
  },
  {
    label: "System",
    items: [{ href: "/settings", label: "Settings", icon: Settings }],
  },
];

export default function Sidebar({ email }: { email: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-line bg-canvas px-3 py-5">
      <Link href="/dashboard" className="mb-9 flex items-center gap-2.5 px-2">
        <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden>
          <rect x="1" y="1" width="18" height="18" rx="4" fill="#3ecf8e" fillOpacity="0.12" stroke="#3ecf8e" strokeOpacity="0.5" />
          <path d="M6 13V7l4 3.5L14 7v6" stroke="#3ecf8e" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
        <span className="text-[15px] font-semibold tracking-tight">Cortexa</span>
      </Link>

      <nav className="flex flex-1 flex-col gap-7 overflow-y-auto">
        {SECTIONS.map((section) => (
          <div key={section.label}>
            <p className="mb-2 px-2 font-mono text-[10px] uppercase tracking-[0.22em] text-dim">
              {section.label}
            </p>
            <div className="space-y-px">
              {section.items.map((item) => {
                const active =
                  pathname === item.href ||
                  pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "relative flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors",
                      active
                        ? "bg-hvr2 text-fg"
                        : "text-mut hover:bg-hvr1 hover:text-fg"
                    )}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-acid" />
                    )}
                    <item.icon className={cn("h-4 w-4", active ? "text-acid" : "text-dim")} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-line pt-4">
        <div className="mb-1 flex items-center justify-between gap-2 px-2">
          <span className="truncate font-mono text-[11px] text-dim" title={email}>
            {email || "signed in"}
          </span>
          <span className="flex items-center gap-1">
            <ThemeToggle />
            <button
              onClick={logout}
              className="rounded-md p-1.5 text-dim transition-colors hover:bg-red-500/10 hover:text-red-400"
              aria-label="Log out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>
      </div>
    </aside>
  );
}
