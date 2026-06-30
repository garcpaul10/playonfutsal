/**
 * SINGLE SOURCE OF TRUTH for admin sidebar navigation, command palette, and dashboard cards.
 * When adding a new admin sub-page, register it here — the sidebar and command palette
 * will pick it up automatically.
 */
import {
  Trophy, Target, Calendar, Users, Brain, Sparkles, Crown,
  ShieldCheck, UsersRound, Flag, Handshake, UserCog, UserPlus,
  CreditCard, TrendingUp, FileText, Percent, Tag, RefreshCw, DollarSign, Scale,
  MapPin, CalendarRange, Building2,
  Wrench, ClipboardList, AlertCircle, Lock, BookOpen, ScrollText,
  PieChart, Repeat,
  BarChart3, ShieldAlert, MessageSquare,
} from "lucide-react";
import type { AdminStats } from "@workspace/api-client-react";
import type { ElementType } from "react";

export type GroupId = "programs" | "players" | "finance" | "facility" | "ops" | "reports";

export interface NavItem {
  icon: ElementType;
  color: string;
  bg: string;
  title: string;
  desc: string;
  href: string;
  highlight?: boolean;
  stat?: (s: AdminStats | undefined) => string | null;
  /** Permission key required for scoped admins. Omit = super-admin only. */
  permission?: string;
}

export interface NavGroup {
  id: GroupId;
  label: string;
  icon: ElementType;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "programs",
    label: "Programs",
    icon: Trophy,
    items: [
      {
        icon: Crown, color: "text-amber-400", bg: "bg-amber-400/10",
        title: "Kings of The Court", desc: "Seasons, battles, rotation engine & leaderboard",
        href: "/admin/kings-of-the-court",
        stat: () => null,
        highlight: true,
      },
      {
        icon: Trophy, color: "text-amber-500", bg: "bg-amber-500/10",
        title: "Leagues", desc: "Seasons, teams, schedule, standings & playoffs",
        href: "/admin/leagues",
        stat: (s) => s?.activeLeagues != null ? `${s.activeLeagues} active` : null,
        permission: "canManageLeagues",
      },
      {
        icon: Target, color: "text-blue-500", bg: "bg-blue-500/10",
        title: "Tournaments", desc: "Bracket, seeding, registration & check-in",
        href: "/admin/tournaments",
        stat: (s) => s?.upcomingTournaments != null ? `${s.upcomingTournaments} upcoming` : null,
        permission: "canManageTournaments",
      },
      {
        icon: Calendar, color: "text-green-500", bg: "bg-green-500/10",
        title: "Camps", desc: "Days, coaches, roster & check-in",
        href: "/admin/camps",
        stat: (s) => s?.activeCamps != null ? `${s.activeCamps} active` : null,
        permission: "canManageCamps",
      },
      {
        icon: Users, color: "text-purple-500", bg: "bg-purple-500/10",
        title: "Drop-in Sessions", desc: "Manage recurring Friday drop-ins",
        href: "/admin/dropins",
        stat: (s) => s?.upcomingDropins != null ? `${s.upcomingDropins} upcoming` : null,
        permission: "canManageDropins",
      },
      {
        icon: Brain, color: "text-rose-400", bg: "bg-rose-400/10",
        title: "AI Scheduling", desc: "Two-stage: event suggestions → full schedule proposals",
        href: "/admin/ai-scheduling", highlight: true,
        stat: () => "AI-powered",
        permission: "canManageSchedules",
      },
      {
        icon: Sparkles, color: "text-violet-400", bg: "bg-violet-400/10",
        title: "AI Assistant", desc: "Create events, memberships & pricing rules via chat",
        href: "/admin/ai-assistant", highlight: true,
        stat: () => "AI-powered",
      },
    ],
  },
  {
    id: "players",
    label: "Players",
    icon: Users,
    items: [
      {
        icon: Users, color: "text-blue-400", bg: "bg-blue-400/10",
        title: "Staff & Users", desc: "Browse, search & manage all registered accounts",
        href: "/admin/staff",
        stat: (s) => s?.totalUsers != null ? `${s.totalUsers} total` : null,
        permission: "canManageUsers",
      },
      {
        icon: ShieldCheck, color: "text-green-400", bg: "bg-green-400/10",
        title: "Player Directory", desc: "All players with ID verification status badges",
        href: "/admin/players",
        stat: () => null,
        permission: "canManageUsers",
      },
      {
        icon: UsersRound, color: "text-violet-400", bg: "bg-violet-400/10",
        title: "Guardians", desc: "Youth account relationships & approval queue",
        href: "/admin/guardians",
        stat: () => null,
        permission: "canManageUsers",
      },
      {
        icon: Flag, color: "text-orange-400", bg: "bg-orange-400/10",
        title: "Sub-Ref Alerts", desc: "Alert all refs about an open slot",
        href: "/admin/sub-ref-alerts",
        stat: () => null,
        permission: "canManageAssignments",
      },
      {
        icon: Handshake, color: "text-green-400", bg: "bg-green-400/10",
        title: "Referral Program", desc: "Referral codes, rewards & program config",
        href: "/admin/referrals",
        stat: () => null,
        permission: "canManageUsers",
      },
      {
        icon: Flag, color: "text-amber-400", bg: "bg-amber-400/10",
        title: "Invite Staff", desc: "Send invite links to refs, coaches & scorekeepers",
        href: "/admin/invites",
        stat: () => null,
        permission: "canManageUsers",
      },
      {
        icon: UserCog, color: "text-red-400", bg: "bg-red-400/10",
        title: "Role Manager", desc: "Add or remove roles from any user (super admin only)",
        href: "/admin/roles",
        stat: () => null,
      },
      {
        icon: UserPlus, color: "text-violet-400", bg: "bg-violet-400/10",
        title: "User Management", desc: "Account, family links, registrations & payment refunds",
        href: "/admin/users",
        stat: (s) => s?.totalUsers != null ? `${s.totalUsers} accounts` : null,
      },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    icon: DollarSign,
    items: [
      {
        icon: CreditCard, color: "text-emerald-400", bg: "bg-emerald-400/10",
        title: "Financial Dashboard", desc: "Outstanding, external, refunds & credits",
        href: "/admin/payments",
        stat: (s) => s?.totalRevenue != null ? `$${s.totalRevenue.toLocaleString()} total` : null,
        permission: "canViewReports",
      },
      {
        icon: TrendingUp, color: "text-blue-400", bg: "bg-blue-400/10",
        title: "Revenue Overview", desc: "Gross / facility / PlayOn net (record-level)",
        href: "/admin/revenue",
        stat: (s) => s?.registrationsByType ? `${Object.values(s.registrationsByType).reduce((a, b) => a + (b ?? 0), 0)} registrations` : null,
        permission: "canViewReports",
      },
      {
        icon: FileText, color: "text-indigo-400", bg: "bg-indigo-400/10",
        title: "Payouts", desc: "Staff & ref payout management",
        href: "/admin/payouts",
        stat: () => null,
        permission: "canManagePayouts",
      },
      {
        icon: Percent, color: "text-amber-400", bg: "bg-amber-400/10",
        title: "Pricing Rules", desc: "Per-category pricing engine",
        href: "/admin/pricing",
        stat: () => null,
        permission: "canProcessRefunds",
      },
      {
        icon: Tag, color: "text-violet-400", bg: "bg-violet-400/10",
        title: "Discount Codes", desc: "Promo codes & family discounts",
        href: "/admin/discount-codes",
        stat: () => null,
        permission: "canProcessRefunds",
      },
      {
        icon: RefreshCw, color: "text-rose-400", bg: "bg-rose-400/10",
        title: "Refund Policies", desc: "Cancellation rules engine",
        href: "/admin/refund-policies",
        stat: () => null,
        permission: "canProcessRefunds",
      },
      {
        icon: DollarSign, color: "text-gray-400", bg: "bg-gray-400/10",
        title: "Service Fee Config", desc: "Pass-through processing fee",
        href: "/admin/fee-config",
        stat: () => null,
      },
      {
        icon: Scale, color: "text-cyan-400", bg: "bg-cyan-400/10",
        title: "Facility Split Rules", desc: "Revenue share with venue",
        href: "/admin/splits",
        stat: () => null,
      },
      {
        icon: ShieldAlert, color: "text-rose-500", bg: "bg-rose-500/10",
        title: "Disputes", desc: "Stripe chargebacks and dispute tracking",
        href: "/admin/disputes",
        stat: () => null,
        permission: "canViewReports",
      },
    ],
  },
  {
    id: "facility",
    label: "Facility",
    icon: MapPin,
    items: [
      {
        icon: Building2, color: "text-teal-400", bg: "bg-teal-400/10",
        title: "Court Rentals", desc: "Bookings, pricing tiers & blackout dates",
        href: "/admin/rentals",
        stat: () => null,
      },
      {
        icon: Target, color: "text-blue-400", bg: "bg-blue-400/10",
        title: "Courts", desc: "Configure court types & capacity",
        href: "/admin/courts",
        stat: () => null,
        permission: "canManageCourts",
      },
      {
        icon: CalendarRange, color: "text-green-400", bg: "bg-green-400/10",
        title: "Court Calendar", desc: "View schedule & block courts",
        href: "/admin/court-calendar",
        stat: () => null,
        permission: "canManageCourts",
      },
      {
        icon: MapPin, color: "text-red-400", bg: "bg-red-400/10",
        title: "Venues", desc: "Manage facility locations",
        href: "/admin/venues",
        stat: () => null,
        permission: "canManageVenues",
      },
      {
        icon: UsersRound, color: "text-amber-400", bg: "bg-amber-400/10",
        title: "Age Groups", desc: "Divisions, formats & court defaults",
        href: "/admin/age-groups",
        stat: () => null,
        permission: "canManageAgeGroups",
      },
      {
        icon: ShieldAlert, color: "text-teal-400", bg: "bg-teal-400/10",
        title: "Age Waivers", desc: "Review play-up / play-down requests from guardians",
        href: "/admin/age-group-waivers",
        stat: () => null,
        permission: "canManageAgeGroups",
      },
      {
        icon: ShieldCheck, color: "text-teal-400", bg: "bg-teal-400/10",
        title: "Insurance & Clearances", desc: "Policy expiry & background-check tracking",
        href: "/admin/insurance",
        stat: () => null,
        permission: "canManageUsers",
      },
    ],
  },
  {
    id: "ops",
    label: "Ops",
    icon: Wrench,
    items: [
      {
        icon: MessageSquare, color: "text-sky-400", bg: "bg-sky-400/10",
        title: "Messaging", desc: "Broadcast announcements to players by event, pool, or status",
        href: "/admin/messaging",
        stat: () => null,
        permission: "canManageAnnouncements",
      },
      {
        icon: Wrench, color: "text-orange-400", bg: "bg-orange-400/10",
        title: "Fixture Operations", desc: "Cancel & reschedule fixtures with notifications",
        href: "/admin/fixtures",
        stat: () => null,
        permission: "canManageSchedules",
      },
      {
        icon: ClipboardList, color: "text-blue-400", bg: "bg-blue-400/10",
        title: "Memberships", desc: "Subscription tiers, member pricing & billing",
        href: "/admin/memberships",
        stat: () => null,
      },
      {
        icon: AlertCircle, color: "text-red-400", bg: "bg-red-400/10",
        title: "Incident Reports", desc: "File & track injury / misconduct reports",
        href: "/admin/incident-reports",
        stat: () => null,
        permission: "canManageGameCards",
      },
      {
        icon: Lock, color: "text-gray-400", bg: "bg-gray-400/10",
        title: "Data Privacy", desc: "Export & anonymize youth player PII",
        href: "/admin/privacy",
        stat: () => null,
      },
      {
        icon: BookOpen, color: "text-indigo-400", bg: "bg-indigo-400/10",
        title: "Audit Log", desc: "Immutable change history",
        href: "/admin/audit-log",
        stat: () => null,
      },
      {
        icon: ScrollText, color: "text-teal-400", bg: "bg-teal-400/10",
        title: "Waivers", desc: "Edit waiver document, publish versions & view signatures",
        href: "/admin/waivers",
        stat: () => null,
      },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    icon: BarChart3,
    items: [
      {
        icon: TrendingUp, color: "text-green-400", bg: "bg-green-400/10",
        title: "Revenue Report", desc: "Gross / facility / PlayOn net with membership stats",
        href: "/admin/revenue",
        stat: (s) => s?.totalRevenue != null ? `$${s.totalRevenue.toLocaleString()} gross` : null,
        permission: "canViewReports",
      },
      {
        icon: PieChart, color: "text-blue-400", bg: "bg-blue-400/10",
        title: "Participation Report", desc: "Registrations over time by type & age group",
        href: "/admin/reports/participation",
        stat: (s) => s?.totalRegistrations != null ? `${s.totalRegistrations} total registrations` : null,
        permission: "canViewReports",
      },
      {
        icon: Repeat, color: "text-amber-400", bg: "bg-amber-400/10",
        title: "Retention Report", desc: "Returning vs. new players per season",
        href: "/admin/reports/retention",
        stat: () => null,
        permission: "canViewReports",
      },
    ],
  },
];
