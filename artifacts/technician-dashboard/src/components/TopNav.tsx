import { Link, useLocation } from "wouter";
import { useAuth } from "@workspace/auth-web";
import { CalendarClock, Globe, Briefcase, User, LogOut, type LucideIcon } from "lucide-react";

type Tab = { href: string; label: string; icon: LucideIcon; testId: string };

const TABS: Tab[] = [
  { href: "/schedule-board", label: "Schedule Board", icon: CalendarClock, testId: "tab-schedule-board" },
  { href: "/jobs-by-region", label: "By Region", icon: Globe, testId: "tab-jobs-by-region" },
  { href: "/unscheduled", label: "Unscheduled", icon: Briefcase, testId: "tab-unscheduled" },
  { href: "/utilization", label: "Utilization", icon: User, testId: "tab-utilization" },
];

export function TopNav({ rightSlot }: { rightSlot?: React.ReactNode }) {
  const [location] = useLocation();
  const { logout } = useAuth();

  return (
    <header className="bg-sidebar text-sidebar-foreground shadow-md sticky top-0 z-20">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex items-center gap-2">
        <nav className="flex items-center gap-1 flex-1 overflow-x-auto">
          {TABS.map((tab) => {
            const active =
              location === tab.href ||
              (tab.href === "/schedule-board" && location === "/");
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                data-testid={tab.testId}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2 shrink-0">
          {rightSlot}
          <button
            onClick={logout}
            data-testid="button-logout"
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>
    </header>
  );
}
