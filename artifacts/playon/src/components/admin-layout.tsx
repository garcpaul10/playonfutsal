import React, { useState, useEffect, useCallback, useRef } from "react";
import { Link, useLocation } from "wouter";
import { Layout, AdminLayoutContext } from "@/components/layout";
import { useAdminPermissions } from "@/hooks/use-admin-permissions";
import { NAV_GROUPS, type NavItem, type GroupId } from "@/pages/admin/admin-nav-config";
import {
  PanelLeftClose, PanelLeftOpen, Command, Search,
  LayoutDashboard, Plus,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const COLLAPSED_KEY = "admin-sidebar-collapsed";

function useCollapsed() {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === "true"; } catch { return false; }
  });
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(COLLAPSED_KEY, String(next)); } catch {}
      return next;
    });
  }, []);
  return { collapsed, toggle };
}

function activeGroupForPath(location: string): GroupId | null {
  for (const group of NAV_GROUPS) {
    if (group.items.some((item) => location.startsWith(item.href))) return group.id;
  }
  return null;
}

interface AdminCommandPaletteProps {
  open: boolean;
  onClose: () => void;
  accessibleItems: NavItem[];
}

function AdminCommandPalette({ open, onClose, accessibleItems }: AdminCommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [, navigate] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const q = query.toLowerCase();
  const filtered = q
    ? accessibleItems.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.desc.toLowerCase().includes(q)
      )
    : accessibleItems;

  const [activeIdx, setActiveIdx] = useState(0);
  useEffect(() => { setActiveIdx(0); }, [query]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && filtered[activeIdx]) {
      navigate(filtered[activeIdx].href);
      onClose();
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[300] flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative z-10 w-full max-w-xl mx-4 bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search admin pages…"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
          <kbd className="hidden sm:flex items-center gap-0.5 text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
            esc
          </kbd>
        </div>
        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No results for "{query}"</p>
          ) : (
            filtered.map((item, idx) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
              >
                <div
                  className={cn(
                    "flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors",
                    idx === activeIdx ? "bg-primary/10 text-primary" : "hover:bg-muted/60 text-foreground"
                  )}
                  onMouseEnter={() => setActiveIdx(idx)}
                >
                  <div className={cn("w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0", item.bg)}>
                    <item.icon className={cn("h-3.5 w-3.5", item.color)} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-none truncate">{item.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.desc}</p>
                  </div>
                  {item.highlight && (
                    <span className="ml-auto text-[10px] font-semibold text-rose-400 bg-rose-400/10 px-1.5 py-0.5 rounded-full flex-shrink-0">AI</span>
                  )}
                </div>
              </Link>
            ))
          )}
        </div>
        {/* Footer hint */}
        <div className="border-t border-border px-4 py-2 flex items-center gap-4 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><kbd className="border border-border rounded px-1">↑↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="border border-border rounded px-1">↵</kbd> open</span>
          <span className="flex items-center gap-1"><kbd className="border border-border rounded px-1">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

interface SidebarItemProps {
  item: NavItem;
  collapsed: boolean;
  isActive: boolean;
  onClick?: () => void;
}

function SidebarItem({ item, collapsed, isActive, onClick }: SidebarItemProps) {
  const content = (
    <Link href={item.href} onClick={onClick}>
      <div
        className={cn(
          "flex items-center gap-2.5 rounded-lg transition-colors cursor-pointer group",
          collapsed ? "justify-center w-9 h-9 mx-auto" : "px-2.5 py-1.5",
          isActive
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        )}
      >
        <item.icon className={cn("flex-shrink-0", collapsed ? "h-4.5 w-4.5" : "h-4 w-4", isActive ? item.color : "")} style={{ width: collapsed ? 18 : 16, height: collapsed ? 18 : 16 }} />
        {!collapsed && (
          <span className="text-sm font-medium truncate leading-none">{item.title}</span>
        )}
        {!collapsed && isActive && (
          <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
        )}
      </div>
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right" className="text-xs">{item.title}</TooltipContent>
      </Tooltip>
    );
  }
  return content;
}

function AdminSidebar({
  collapsed,
  toggle,
  onOpenPalette,
}: {
  collapsed: boolean;
  toggle: () => void;
  onOpenPalette: () => void;
}) {
  const [location] = useLocation();
  const { isSuperAdmin, can } = useAdminPermissions();

  function canAccessItem(item: NavItem): boolean {
    if (isSuperAdmin) return true;
    if (!item.permission) return false;
    return can(item.permission);
  }

  const isDashboard = location === "/admin" || location === "/admin/";
  const isCreate = location === "/admin/create";

  // Derive which group tab is active from current URL; fall back to first accessible group
  const accessibleGroups = NAV_GROUPS.filter((g) => g.items.some(canAccessItem));
  const derivedGroup = activeGroupForPath(location);
  const [activeTab, setActiveTab] = useState<GroupId>(
    () => derivedGroup ?? (accessibleGroups[0]?.id as GroupId)
  );

  // Keep tab in sync when navigating via links (e.g. command palette)
  useEffect(() => {
    const g = activeGroupForPath(location);
    if (g) setActiveTab(g);
  }, [location]);

  const activeGroup = accessibleGroups.find((g) => g.id === activeTab);
  const activeItems = (activeGroup?.items ?? []).filter(canAccessItem);

  return (
    <aside
      className={cn(
        "flex flex-col h-full bg-card border-r border-border transition-all duration-200 flex-shrink-0",
        collapsed ? "w-14" : "w-52"
      )}
    >
      {/* Header */}
      <div className={cn(
        "flex items-center border-b border-border h-12 flex-shrink-0",
        collapsed ? "justify-center px-2" : "justify-between px-3"
      )}>
        {!collapsed && (
          <Link href="/admin">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest hover:text-foreground transition-colors">
              Admin
            </span>
          </Link>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggle}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="text-xs">{collapsed ? "Expand" : "Collapse"}</TooltipContent>
        </Tooltip>
      </div>

      {/* Search / command palette trigger */}
      <div className={cn("px-2 py-2 border-b border-border flex-shrink-0", collapsed ? "flex justify-center" : "")}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onOpenPalette}
                className="w-9 h-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label="Open command palette"
              >
                <Command className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">Command palette (⌘K)</TooltipContent>
          </Tooltip>
        ) : (
          <button
            onClick={onOpenPalette}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/50 hover:bg-muted text-muted-foreground text-xs transition-colors"
          >
            <Command className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="flex-1 text-left truncate">Search pages…</span>
            <kbd className="hidden sm:inline text-[10px] border border-border rounded px-1">⌘K</kbd>
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2 px-2 flex flex-col gap-0.5">

        {/* Dashboard */}
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Link href="/admin">
                <div className={cn(
                  "flex items-center justify-center w-9 h-9 mx-auto rounded-lg transition-colors cursor-pointer",
                  isDashboard ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}>
                  <LayoutDashboard style={{ width: 18, height: 18 }} />
                </div>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">Dashboard</TooltipContent>
          </Tooltip>
        ) : (
          <Link href="/admin">
            <div className={cn(
              "flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer",
              isDashboard ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            )}>
              <LayoutDashboard className="h-4 w-4 flex-shrink-0" />
              <span className="text-sm font-medium">Dashboard</span>
              {isDashboard && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />}
            </div>
          </Link>
        )}

        {/* Create Offering */}
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Link href="/admin/create">
                <div className={cn(
                  "flex items-center justify-center w-9 h-9 mx-auto rounded-lg transition-colors cursor-pointer",
                  isCreate ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}>
                  <Plus style={{ width: 18, height: 18 }} />
                </div>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">Create Offering</TooltipContent>
          </Tooltip>
        ) : (
          <Link href="/admin/create">
            <div className={cn(
              "flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer",
              isCreate ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            )}>
              <Plus className="h-4 w-4 flex-shrink-0" />
              <span className="text-sm font-medium">Create Offering</span>
            </div>
          </Link>
        )}

        <div className="h-px bg-border my-1 mx-0.5" />

        {/* ── Tab strip (expanded) / icon strip (collapsed) ── */}
        {collapsed ? (
          /* Collapsed: show one icon per group; clicking selects that group and expands sidebar */
          <div className="flex flex-col gap-0.5">
            {accessibleGroups.map((group) => {
              const isActive = group.id === activeTab;
              return (
                <Tooltip key={group.id}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => { setActiveTab(group.id as GroupId); toggle(); }}
                      className={cn(
                        "flex items-center justify-center w-9 h-9 mx-auto rounded-lg transition-colors",
                        isActive ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      )}
                    >
                      <group.icon style={{ width: 18, height: 18 }} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="text-xs">{group.label}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        ) : (
          /* Expanded: tab pill row + items below */
          <>
            {/* Tab pills — wrap onto two rows if needed */}
            <div className="flex flex-wrap gap-1 px-0.5 pb-1">
              {accessibleGroups.map((group) => {
                const isActive = group.id === activeTab;
                return (
                  <button
                    key={group.id}
                    onClick={() => setActiveTab(group.id as GroupId)}
                    className={cn(
                      "flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                  >
                    <group.icon className="h-3 w-3 flex-shrink-0" />
                    {group.label}
                  </button>
                );
              })}
            </div>

            {/* Items for the active tab */}
            <div className="flex flex-col gap-0.5">
              {activeItems.map((item) => {
                const isActive = location.startsWith(item.href);
                return (
                  <SidebarItem key={item.href} item={item} collapsed={false} isActive={isActive} />
                );
              })}
            </div>
          </>
        )}
      </nav>

      {/* Footer */}
      {!collapsed && (
        <div className="px-3 py-3 border-t border-border flex-shrink-0">
          <p className="text-[10px] text-muted-foreground/50 text-center">PlayOn Admin Console</p>
        </div>
      )}
    </aside>
  );
}

interface AdminLayoutProps {
  children: React.ReactNode;
  /** Optional page title shown in the top bar */
  title?: string;
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const { collapsed, toggle } = useCollapsed();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { isSuperAdmin, can } = useAdminPermissions();

  function canAccessItem(item: NavItem): boolean {
    if (isSuperAdmin) return true;
    if (!item.permission) return false;
    return can(item.permission);
  }

  const allAccessibleItems = NAV_GROUPS.flatMap((g) => g.items.filter(canAccessItem));

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <Layout>
      {/* Provider is set INSIDE Layout so Layout itself renders the nav bar normally.
          Sub-pages that call <Layout> inside the content area will see context=true
          and just render their children — no double nav. */}
      <AdminLayoutContext.Provider value={true}>
        <div className="flex h-[calc(100dvh-4rem)] overflow-hidden">
          <AdminSidebar
            collapsed={collapsed}
            toggle={toggle}
            onOpenPalette={() => setPaletteOpen(true)}
          />
          <main className="flex-1 overflow-y-auto min-w-0">
            {children}
          </main>
        </div>
        <AdminCommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          accessibleItems={allAccessibleItems}
        />
      </AdminLayoutContext.Provider>
    </Layout>
  );
}
