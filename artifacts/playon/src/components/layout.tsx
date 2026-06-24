import React from "react";
import { Link, useLocation } from "wouter";
import { Show, useUser, useClerk, useAuth } from "@clerk/react";
import { DashboardTabContext } from "@/contexts/dashboard-tab-context";

import { Menu, X, User, LayoutDashboard, LogOut, ShieldAlert, DollarSign, Bot, Bell, Users, Trophy, AlertTriangle, QrCode, ClipboardList, Sparkles, CheckCircle2, Clock, Calendar, Megaphone, CreditCard, XCircle, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useGetMyProfile } from "@workspace/api-client-react";
import { useDashboardSwitcher } from "@/hooks/use-dashboard-switcher";
import { useNotifications, type UserNotification } from "@/hooks/useNotifications";
import QRCodeLib from "qrcode";

import playonLogo from "@assets/PlayOn_RBG_Trans_1780083327599.png";

/**
 * When true, Layout renders only its children (no nav/footer shell).
 * Set by AdminLayout so admin sub-pages that call <Layout> don't double-wrap.
 */
export const AdminLayoutContext = React.createContext(false);

// ─── Notifications Bell ───────────────────────────────────────────────────────

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type NotifIconComponent = React.ComponentType<{ className?: string }>;

const NOTIF_TYPE_ICONS: Record<string, NotifIconComponent> = {
  registration_confirmed: CheckCircle2,
  registration_cancelled: XCircle,
  waitlist_movement: Clock,
  cancellation_rainout: XCircle,
  payment_receipt: CreditCard,
  payment_received: CreditCard,
  payment_failed: XCircle,
  payment_due: CreditCard,
  balance_due: CreditCard,
  refund_issued: CreditCard,
  schedule_change: Calendar,
  upcoming_session: Calendar,
  dropin_reminder: Calendar,
  announcement: Megaphone,
  results_standings: Trophy,
  sub_ref_alert: AlertTriangle,
  fa_match_proposal: UserCheck,
  fa_match_response: UserCheck,
  role_changed: UserCheck,
  league_start: Calendar,
};

function NotifTypeIcon({ type }: { type: string }) {
  const Icon: NotifIconComponent = NOTIF_TYPE_ICONS[type] ?? Bell;
  return <Icon className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />;
}

function NotificationsBell() {
  const [open, setOpen] = React.useState(false);
  const [, navigate] = useLocation();
  const { items, unreadCount, markRead, markAllRead } = useNotifications();

  function handleItemClick(item: UserNotification) {
    setOpen(false);
    if (!item.readAt) markRead(item.id);
    if (item.link) navigate(item.link);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold leading-none text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        {/* Header row */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h4 className="text-sm font-semibold">Notifications</h4>
          {unreadCount > 0 && (
            <button
              className="text-xs text-primary hover:underline"
              onClick={() => markAllRead()}
            >
              Mark all read
            </button>
          )}
        </div>

        {/* Notification list */}
        <ScrollArea className="max-h-80">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
              <Bell className="mb-2 h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No notifications yet</p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                Activity updates will appear here.
              </p>
            </div>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                className={`flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/50 ${item.readAt ? "opacity-60" : ""}`}
                onClick={() => handleItemClick(item)}
              >
                {/* Per-type icon with unread dot overlay */}
                <div className="relative shrink-0 mt-0.5">
                  <NotifTypeIcon type={item.type} />
                  {!item.readAt && (
                    <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  {item.subject && (
                    <p className="truncate text-sm font-medium">{item.subject}</p>
                  )}
                  <p className={`truncate text-sm ${item.subject ? "text-muted-foreground" : "font-medium"}`}>
                    {item.body}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground/60">
                    {formatRelativeTime(item.createdAt)}
                  </p>
                </div>
              </button>
            ))
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

interface ChildQrTodayEvent {
  type: string;
  id: number;
  name: string;
  startTime?: string | null;
  checkedIn: boolean;
}

interface ChildQrEntry {
  youthUserId: number;
  firstName: string | null;
  lastName: string | null;
  qrCode: string | null;
  hasEventsToday: boolean;
  todayEvents: ChildQrTodayEvent[];
}

function QrModal({ onClose, qrValue, isParent }: { onClose: () => void; qrValue: string; isParent: boolean }) {
  const { getToken } = useAuth();
  const [dataUrl, setDataUrl] = React.useState<string>("");
  const [bright, setBright] = React.useState(false);
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const [childrenQr, setChildrenQr] = React.useState<ChildQrEntry[]>([]);

  React.useEffect(() => {
    if (!isParent) return;
    getToken().then((token) => {
      fetch(`${import.meta.env.BASE_URL}api/me/children-qr-today`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.children) {
            setChildrenQr(data.children.filter((c: ChildQrEntry) => c.qrCode));
          }
        })
        .catch(() => {});
    });
  }, [isParent]);

  const profiles = React.useMemo(() => [
    { label: "My QR", name: "Me", qrCode: qrValue, hasEventToday: false, todayEvents: [] as ChildQrTodayEvent[] },
    ...childrenQr.map((c) => ({
      label: (c.firstName ?? "Child"),
      name: `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Child",
      qrCode: c.qrCode!,
      hasEventToday: c.hasEventsToday,
      todayEvents: c.todayEvents ?? [],
    })),
  ], [qrValue, childrenQr]);

  const safeIdx = Math.min(selectedIdx, profiles.length - 1);
  const active = profiles[safeIdx];

  React.useEffect(() => {
    if (!active?.qrCode) { setDataUrl(""); return; }
    QRCodeLib.toDataURL(active.qrCode, {
      width: 320,
      margin: 2,
      color: { dark: "#1E2829", light: "#FFFFFF" },
    })
      .then(setDataUrl)
      .catch(() => {});
  }, [active?.qrCode]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  React.useEffect(() => {
    if (bright && "screen" in window && (window.screen as any).brightness !== undefined) {
      try { (window.screen as any).brightness = 1; } catch {}
    }
  }, [bright]);

  const displayName = safeIdx === 0 ? "My PlayOn ID" : `${active.name}'s PlayOn ID`;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className={`relative z-10 rounded-2xl shadow-2xl w-full max-w-sm flex flex-col items-center gap-4 p-6 transition-colors ${bright ? "bg-white" : "bg-card border border-border"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between w-full">
          <h2 className={`text-lg font-bold ${bright ? "text-gray-900" : "text-foreground"}`}>{displayName}</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setBright(!bright)}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${bright ? "bg-yellow-100 border-yellow-300 text-yellow-800" : "border-border text-muted-foreground hover:bg-muted"}`}
              title="Boost screen brightness for easier scanning"
            >
              ☀ {bright ? "Bright on" : "Brighten"}
            </button>
            <button
              onClick={onClose}
              className={`p-1.5 rounded-lg transition-colors ${bright ? "hover:bg-gray-100 text-gray-500" : "hover:bg-muted text-muted-foreground"}`}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Profile switcher chips — shown when parent has linked children */}
        {profiles.length > 1 && (
          <div className="flex gap-2 overflow-x-auto w-full pb-0.5">
            {profiles.map((p, i) => (
              <button
                key={i}
                onClick={() => setSelectedIdx(i)}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  i === safeIdx
                    ? "bg-primary text-primary-foreground"
                    : bright
                      ? "bg-gray-100 text-gray-600 hover:text-gray-900"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.label}
                {p.hasEventToday && (
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                    i === safeIdx ? "bg-white/25 text-white" : "bg-blue-500 text-white"
                  }`}>
                    Today
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        <div className={`p-4 rounded-2xl shadow-sm ${bright ? "bg-white border border-gray-100" : "bg-white"}`}>
          {dataUrl ? (
            <img
              src={dataUrl}
              alt={`${active.name}'s PlayOn QR code`}
              className="w-[280px] h-[280px]"
              style={{ imageRendering: "pixelated" }}
            />
          ) : (
            <div className="w-[280px] h-[280px] flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>

        <p className={`text-xs text-center ${bright ? "text-gray-500" : "text-muted-foreground"}`}>
          Show this to check in at any PlayOn event
        </p>

        {/* Today's events for selected child */}
        {safeIdx > 0 && active.todayEvents.length > 0 && (
          <div className="w-full space-y-1.5">
            <p className={`text-[10px] font-semibold uppercase tracking-wider ${bright ? "text-gray-400" : "text-muted-foreground"}`}>
              Today's events
            </p>
            {active.todayEvents.map((ev, i) => (
              <div
                key={i}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs ${
                  ev.checkedIn
                    ? bright ? "bg-green-50 border border-green-200" : "bg-green-500/10 border border-green-500/20"
                    : bright ? "bg-gray-50 border border-gray-200" : "bg-muted/60 border border-border"
                }`}
              >
                <span className={`font-medium ${bright ? "text-gray-800" : "text-foreground"}`}>{ev.name}</span>
                <div className="flex items-center gap-2">
                  {ev.startTime && (
                    <span className={bright ? "text-gray-500" : "text-muted-foreground"}>{ev.startTime}</span>
                  )}
                  {ev.checkedIn ? (
                    <span className="text-green-600 font-semibold">✓ In</span>
                  ) : (
                    <span className={bright ? "text-gray-400" : "text-muted-foreground"}>Pending</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!bright && (
          <p className="text-[11px] text-center text-muted-foreground/70 bg-muted/50 rounded-lg px-3 py-2 w-full">
            💡 Tap <strong>Brighten</strong> for easier scanning under venue lighting
          </p>
        )}
      </div>
    </div>
  );
}

const TAB_CONTEXTUAL_ITEMS: Record<string, string[]> = {
  player:      ["ai_assistant"],
  parent:      ["family_dashboard"],
  ref:         ["open_ref_slots", "my_games", "qr_scanner"],
  coach:       ["my_games", "qr_scanner"],
  scorekeeper: ["my_games", "qr_scanner"],
  my_team:     [],
};

/**
 * Outer shell — checks AdminLayoutContext first. When inside AdminLayout,
 * just renders children so sub-pages don't double-wrap the nav/footer.
 */
export function Layout({ children }: { children: React.ReactNode }) {
  const insideAdminLayout = React.useContext(AdminLayoutContext);
  if (insideAdminLayout) return <>{children}</>;
  return <LayoutShell>{children}</LayoutShell>;
}

function LayoutShell({ children }: { children: React.ReactNode }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const [scrolled, setScrolled] = React.useState(false);
  const [isQrOpen, setIsQrOpen] = React.useState(false);
  const { activeDashTab } = React.useContext(DashboardTabContext);
  const [location, setLocation] = useLocation();
  const { signOut } = useClerk();
  const { user, isLoaded } = useUser();
  const { isSignedIn } = useAuth();
  const { data: profile } = useGetMyProfile();

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const isAdmin = profile?.roles?.includes('admin') ?? false;
  const isParent = profile?.roles?.includes('parent') ?? false;
  const { available: availableDashboards, active: activeDashboard, isMultiRole } = useDashboardSwitcher();

  const qrValue: string = profile?.qrCode ?? (user?.id ? `playon:player:${user.id}` : "");

  const isDashboardPage = location === "/dashboard";
  const normalizedTab = (activeDashTab === "team_manager" || activeDashTab === "team_coach") ? "my_team" : activeDashTab;
  const tabItems: string[] = isDashboardPage && normalizedTab in TAB_CONTEXTUAL_ITEMS
    ? TAB_CONTEXTUAL_ITEMS[normalizedTab]
    : [];

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Profile gate — redirect incomplete accounts to /onboarding on protected routes.
  // Fires only when Clerk is loaded and the user is signed in, and only once we
  // have a resolved profile (not while it is still loading/undefined).
  React.useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    if (profile === undefined) return; // still loading

    // Routes that must remain accessible without a complete profile.
    const PUBLIC_ROUTE_PATTERNS = [
      /^\/?$/,                           // home
      /^\/sign-in/,
      /^\/sign-up/,
      /^\/onboarding/,
      /^\/sso-callback/,
      /^\/explore/,
      // public program-detail pages (numeric segment required so /leagues alone is excluded)
      /^\/leagues\/\d+/,
      /^\/camps\/\d+/,
      /^\/dropins\/\d+/,
      /^\/dropins\/occ\//,
      /^\/tournaments\/\d+/,
    ];

    const isPublicRoute = PUBLIC_ROUTE_PATTERNS.some((re) => re.test(location));
    if (isPublicRoute) return;

    const profileRoles: string[] = Array.isArray(profile?.roles) ? profile.roles : [];
    const hasRoles = profileRoles.length > 0;
    const idVerified = Boolean(profile?.idVerified);

    if (!hasRoles || !idVerified) {
      setLocation("/onboarding");
    }
  }, [isLoaded, isSignedIn, profile, location, setLocation]);

  const handleSignOut = () => {
    signOut({ redirectUrl: basePath || "/" });
  };

  const navLinks = [
    { href: "/explore", label: "Explore", requiresAuth: false },
    { href: "/me", label: "Dashboard", requiresAuth: true },
    { href: "/account", label: "Settings", requiresAuth: true },
  ].filter((link) => !link.requiresAuth || isSignedIn);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <header className={`sticky top-0 z-50 w-full transition-all duration-300 ${scrolled ? "border-b border-border bg-background/95 backdrop-blur-xl shadow-sm" : "border-b border-transparent bg-background/80 backdrop-blur-md"}`}>
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
            <img src={playonLogo} alt="PlayOn Futsal" className="h-11 object-contain" />
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-6">
            {navLinks.map((link) => (
              <Link 
                key={link.href} 
                href={link.href}
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-4">
            <Show when="signed-out">
              <div className="flex gap-2">
                <Button variant="ghost" className="text-muted-foreground hover:text-foreground" asChild>
                  <Link href="/sign-in">Log in</Link>
                </Button>
                <Button className="bg-[#dc2626] border-[#b91c1c] text-white hover:bg-[#b91c1c]" asChild>
                  <Link href="/sign-up">Sign up</Link>
                </Button>
              </div>
            </Show>
            <Show when="signed-in">
              {/* QR quick-access button */}
              {qrValue && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                  onClick={() => setIsQrOpen(true)}
                  title="Show my QR code"
                  aria-label="Show my PlayOn QR code"
                >
                  <QrCode className="h-5 w-5" />
                </Button>
              )}
              {/* Notifications bell */}
              <NotificationsBell />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={user?.imageUrl} alt={user?.fullName || ""} />
                      <AvatarFallback>{user?.firstName?.charAt(0)}{user?.lastName?.charAt(0)}</AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end" forceMount>
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none">{user?.fullName}</p>
                      <p className="text-xs leading-none text-muted-foreground">{user?.primaryEmailAddress?.emailAddress}</p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {/* QR Code — only on non-dashboard pages */}
                  {!isDashboardPage && qrValue && (
                    <DropdownMenuItem onClick={() => setIsQrOpen(true)} className="cursor-pointer">
                      <QrCode className="mr-2 h-4 w-4" />
                      My QR Code
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem asChild>
                    <Link href="/me" className="cursor-pointer w-full flex items-center">
                      <LayoutDashboard className="mr-2 h-4 w-4" />
                      Dashboard
                    </Link>
                  </DropdownMenuItem>
                  {/* Role / dashboard switcher — multi-role users only */}
                  {isMultiRole && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-1">
                        Switch view
                      </DropdownMenuLabel>
                      {availableDashboards.map((entry) => {
                        const Icon = entry.icon;
                        const isActive = activeDashboard?.id === entry.id;
                        return (
                          <DropdownMenuItem key={entry.id} asChild>
                            <Link href={entry.webPath} className={`cursor-pointer w-full flex items-center ${isActive ? "text-primary font-medium" : ""}`}>
                              <Icon className="mr-2 h-4 w-4" />
                              {entry.label}
                              {isActive && <span className="ml-auto text-primary text-xs">✓</span>}
                            </Link>
                          </DropdownMenuItem>
                        );
                      })}
                      <DropdownMenuSeparator />
                    </>
                  )}
                  {/* Contextual items — scoped to active tab when on /dashboard */}
                  {isDashboardPage ? (
                    <>
                      {tabItems.includes("family_dashboard") && (
                        <DropdownMenuItem asChild>
                          <Link href="/me?tab=family" className="cursor-pointer w-full flex items-center">
                            <Users className="mr-2 h-4 w-4" />
                            Family Dashboard
                          </Link>
                        </DropdownMenuItem>
                      )}
                      {tabItems.includes("open_ref_slots") && (
                        <DropdownMenuItem asChild>
                          <Link href="/ref-alerts" className="cursor-pointer w-full flex items-center">
                            <AlertTriangle className="mr-2 h-4 w-4" />
                            Open Ref Slots
                          </Link>
                        </DropdownMenuItem>
                      )}
                      {tabItems.includes("my_games") && (
                        <DropdownMenuItem asChild>
                          <Link href="/staff/game-cards" className="cursor-pointer w-full flex items-center">
                            <ClipboardList className="mr-2 h-4 w-4" />
                            My Games
                          </Link>
                        </DropdownMenuItem>
                      )}
                      {tabItems.includes("qr_scanner") && (
                        <DropdownMenuItem asChild>
                          <Link href="/scanner" className="cursor-pointer w-full flex items-center">
                            <QrCode className="mr-2 h-4 w-4" />
                            QR Scanner
                          </Link>
                        </DropdownMenuItem>
                      )}
                    </>
                  ) : (
                    <>
                      {profile?.roles?.includes('parent') && (
                        <DropdownMenuItem asChild>
                          <Link href="/me?tab=family" className="cursor-pointer w-full flex items-center">
                            <Users className="mr-2 h-4 w-4" />
                            Family Dashboard
                          </Link>
                        </DropdownMenuItem>
                      )}
                      {profile?.roles?.includes('ref') && (
                        <DropdownMenuItem asChild>
                          <Link href="/ref-alerts" className="cursor-pointer w-full flex items-center">
                            <AlertTriangle className="mr-2 h-4 w-4" />
                            Open Ref Slots
                          </Link>
                        </DropdownMenuItem>
                      )}
                      {(['staff', 'admin', 'ref', 'coach'].some(r => profile?.roles?.includes(r))) && (
                        <DropdownMenuItem asChild>
                          <Link href="/staff/game-cards" className="cursor-pointer w-full flex items-center">
                            <ClipboardList className="mr-2 h-4 w-4" />
                            My Games
                          </Link>
                        </DropdownMenuItem>
                      )}
                      {(['staff', 'admin', 'ref', 'coach'].some(r => profile?.roles?.includes(r))) && (
                        <DropdownMenuItem asChild>
                          <Link href="/scanner" className="cursor-pointer w-full flex items-center">
                            <QrCode className="mr-2 h-4 w-4" />
                            QR Scanner
                          </Link>
                        </DropdownMenuItem>
                      )}
                      {(['staff', 'admin'].some(r => profile?.roles?.includes(r))) && (
                        <DropdownMenuItem asChild>
                          <Link href="/staff/earnings" className="cursor-pointer w-full flex items-center">
                            <DollarSign className="mr-2 h-4 w-4" />
                            My Earnings
                          </Link>
                        </DropdownMenuItem>
                      )}
                    </>
                  )}
                  <DropdownMenuItem asChild>
                    <Link href="/account" className="cursor-pointer w-full flex items-center">
                      <User className="mr-2 h-4 w-4" />
                      Settings
                    </Link>
                  </DropdownMenuItem>
                  {/* AI Assistant */}
                  <DropdownMenuItem asChild>
                    <Link href="/me?tab=assistant" className="cursor-pointer w-full flex items-center">
                      <Bot className="mr-2 h-4 w-4" />
                      AI Assistant
                    </Link>
                  </DropdownMenuItem>
                  {isAdmin && (
                    <DropdownMenuItem asChild>
                      <Link href="/admin" className="cursor-pointer w-full flex items-center text-primary">
                        <ShieldAlert className="mr-2 h-4 w-4" />
                        Admin Panel
                      </Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer text-destructive focus:text-destructive">
                    <LogOut className="mr-2 h-4 w-4" />
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </Show>
          </div>

          {/* Mobile header right side */}
          <div className="md:hidden flex items-center gap-1">
            {qrValue && (
              <button
                className="p-2 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setIsQrOpen(true)}
                aria-label="Show my PlayOn QR code"
              >
                <QrCode className="h-5 w-5" />
              </button>
            )}
            {isSignedIn && <NotificationsBell />}
            <button 
              className="p-2 text-muted-foreground"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
              {isMobileMenuOpen ? <X /> : <Menu />}
            </button>
          </div>
        </div>

        {/* Mobile Nav */}
        {isMobileMenuOpen && (
          <div className="md:hidden border-b border-border bg-background/95 backdrop-blur-xl px-4 py-4 space-y-4">
            <nav className="flex flex-col space-y-3">
              {navLinks.map((link) => (
                <Link 
                  key={link.href} 
                  href={link.href}
                  className="text-base font-medium text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
            <div className="pt-4 border-t border-border flex flex-col gap-3">
              <Show when="signed-out">
                <Button variant="outline" className="w-full justify-center" asChild onClick={() => setIsMobileMenuOpen(false)}>
                  <Link href="/sign-in">Log in</Link>
                </Button>
                <Button className="w-full justify-center" asChild onClick={() => setIsMobileMenuOpen(false)}>
                  <Link href="/sign-up">Sign up</Link>
                </Button>
              </Show>
              <Show when="signed-in">
                {/* Dashboard switcher — only for multi-role users */}
                {!isMultiRole && (
                  <Button variant="ghost" className="w-full justify-start" asChild onClick={() => setIsMobileMenuOpen(false)}>
                    <Link href="/me">
                      <LayoutDashboard className="mr-2 h-4 w-4" />
                      Dashboard
                    </Link>
                  </Button>
                )}
                {isMultiRole && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 pb-1">
                      Switch Dashboard
                    </p>
                    {availableDashboards.map((entry) => {
                      const Icon = entry.icon;
                      const isActive = activeDashboard?.id === entry.id;
                      return (
                        <Button
                          key={entry.id}
                          variant="ghost"
                          className={`w-full justify-start ${isActive ? "text-primary bg-primary/5" : ""}`}
                          asChild
                          onClick={() => setIsMobileMenuOpen(false)}
                        >
                          <Link href={entry.webPath} className="flex items-center w-full">
                            <Icon className="mr-2 h-4 w-4" />
                            {entry.label}
                            {isActive && <span className="ml-auto text-primary">✓</span>}
                          </Link>
                        </Button>
                      );
                    })}
                    <div className="border-t border-border my-1" />
                  </div>
                )}
                {/* Contextual links — scoped to active tab when on /dashboard */}
                {isDashboardPage ? (
                  <>
                    {tabItems.includes("family_dashboard") && (
                      <Button variant="ghost" className="w-full justify-start" asChild onClick={() => setIsMobileMenuOpen(false)}>
                        <Link href="/me?tab=family">
                          <Users className="mr-2 h-4 w-4" />
                          Family Dashboard
                        </Link>
                      </Button>
                    )}
                    {tabItems.includes("open_ref_slots") && (
                      <Button variant="ghost" className="w-full justify-start" asChild onClick={() => setIsMobileMenuOpen(false)}>
                        <Link href="/ref-alerts">
                          <AlertTriangle className="mr-2 h-4 w-4" />
                          Open Ref Slots
                        </Link>
                      </Button>
                    )}
                    {tabItems.includes("my_games") && (
                      <Button variant="ghost" className="w-full justify-start" asChild onClick={() => setIsMobileMenuOpen(false)}>
                        <Link href="/staff/game-cards">
                          <ClipboardList className="mr-2 h-4 w-4" />
                          My Games
                        </Link>
                      </Button>
                    )}
                    {tabItems.includes("qr_scanner") && (
                      <Button variant="ghost" className="w-full justify-start" asChild onClick={() => setIsMobileMenuOpen(false)}>
                        <Link href="/scanner">
                          <QrCode className="mr-2 h-4 w-4" />
                          QR Scanner
                        </Link>
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    {profile?.roles?.includes('parent') && (
                      <Button variant="ghost" className="w-full justify-start" asChild onClick={() => setIsMobileMenuOpen(false)}>
                        <Link href="/me?tab=family">
                          <Users className="mr-2 h-4 w-4" />
                          Family Dashboard
                        </Link>
                      </Button>
                    )}
                    {profile?.roles?.includes('ref') && (
                      <Button variant="ghost" className="w-full justify-start" asChild onClick={() => setIsMobileMenuOpen(false)}>
                        <Link href="/ref-alerts">
                          <AlertTriangle className="mr-2 h-4 w-4" />
                          Open Ref Slots
                        </Link>
                      </Button>
                    )}
                    {(['staff', 'admin', 'ref', 'coach'].some(r => profile?.roles?.includes(r))) && (
                      <Button variant="ghost" className="w-full justify-start" asChild onClick={() => setIsMobileMenuOpen(false)}>
                        <Link href="/staff/game-cards">
                          <ClipboardList className="mr-2 h-4 w-4" />
                          My Games
                        </Link>
                      </Button>
                    )}
                    {(['staff', 'admin', 'ref', 'coach'].some(r => profile?.roles?.includes(r))) && (
                      <Button variant="ghost" className="w-full justify-start" asChild onClick={() => setIsMobileMenuOpen(false)}>
                        <Link href="/scanner">
                          <QrCode className="mr-2 h-4 w-4" />
                          QR Scanner
                        </Link>
                      </Button>
                    )}
                    {(['staff', 'admin'].some(r => profile?.roles?.includes(r))) && (
                      <Button variant="ghost" className="w-full justify-start" asChild onClick={() => setIsMobileMenuOpen(false)}>
                        <Link href="/staff/earnings">
                          <DollarSign className="mr-2 h-4 w-4" />
                          My Earnings
                        </Link>
                      </Button>
                    )}
                  </>
                )}
                <Button variant="ghost" className="w-full justify-start" asChild onClick={() => setIsMobileMenuOpen(false)}>
                  <Link href="/account">
                    <User className="mr-2 h-4 w-4" />
                    Settings
                  </Link>
                </Button>
                <Button variant="ghost" className="w-full justify-start" asChild onClick={() => setIsMobileMenuOpen(false)}>
                  <Link href="/me?tab=assistant">
                    <Bot className="mr-2 h-4 w-4" />
                    AI Assistant
                  </Link>
                </Button>
                {isAdmin && (
                  <Button variant="ghost" className="w-full justify-start text-primary hover:text-primary" asChild onClick={() => setIsMobileMenuOpen(false)}>
                    <Link href="/admin">
                      <ShieldAlert className="mr-2 h-4 w-4" />
                      Admin Panel
                    </Link>
                  </Button>
                )}
                <Button variant="ghost" className="w-full justify-start text-destructive hover:text-destructive" onClick={() => { handleSignOut(); setIsMobileMenuOpen(false); }}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Log out
                </Button>
              </Show>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">
        {children}
      </main>

      {/* Persistent AI Assistant floating button — admin only */}
      {isAdmin && (
        <Link href="/admin/ai-assistant">
          <button
            className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-primary text-primary-foreground rounded-full px-4 py-3 shadow-lg hover:bg-primary/90 transition-all hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary/50"
            aria-label="Open AI Assistant"
          >
            <Sparkles className="h-4 w-4" />
            <span className="text-sm font-medium hidden sm:inline">AI Assistant</span>
          </button>
        </Link>
      )}

      {isQrOpen && qrValue && (
        <QrModal
          onClose={() => setIsQrOpen(false)}
          qrValue={qrValue}
          isParent={isParent}
        />
      )}

      <footer className="border-t border-border py-12 bg-background">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="space-y-4">
              <img src={playonLogo} alt="PlayOn Futsal" className="h-8 object-contain" />
              <p className="text-sm text-muted-foreground max-w-xs">
                The local futsal hub in Lexington, KY. Where serious players and first-timers alike come to play.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-4 text-foreground">Programs</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/?type=league" className="hover:text-foreground transition-colors">Leagues</Link></li>
                <li><Link href="/?type=camp" className="hover:text-foreground transition-colors">Camps</Link></li>
                <li><Link href="/?type=drop_in" className="hover:text-foreground transition-colors">Drop-ins</Link></li>
                <li><Link href="/?type=tournament" className="hover:text-foreground transition-colors">Tournaments</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-4 text-foreground">Legal</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground transition-colors">Terms of Service</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Privacy Policy</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">Waiver</a></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-4 text-foreground">Contact</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>Alumni Center</li>
                <li>Lexington, KY</li>
                <li><a href="mailto:info@playonfutsal.com" className="hover:text-foreground transition-colors">info@playonfutsal.com</a></li>
              </ul>
            </div>
          </div>
          <div className="mt-12 pt-8 border-t border-border text-center text-sm text-muted-foreground/60">
            &copy; {new Date().getFullYear()} PlayOn Futsal. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
