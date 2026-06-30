import React from "react";
import { Link, Redirect } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/admin-layout";
import {
  Users, Trophy, Target, Calendar, Building2, ChevronRight, Plus,
} from "lucide-react";

const OFFERINGS = [
  {
    icon: Users,
    color: "text-purple-400",
    bg: "bg-purple-400/10",
    border: "border-purple-400/20 hover:border-purple-400/50",
    title: "Drop-in Session",
    desc: "One-time or recurring open play. Set pools, pricing, registration windows, and court assignments.",
    href: "/admin/dropins/new",
    badge: "Most used",
    badgeColor: "bg-purple-400/15 text-purple-400",
  },
  {
    icon: Trophy,
    color: "text-amber-400",
    bg: "bg-amber-400/10",
    border: "border-amber-400/20 hover:border-amber-400/50",
    title: "League",
    desc: "Multi-week season with teams, divisions, standings, and a full match schedule.",
    href: "/admin/leagues",
    badge: null,
  },
  {
    icon: Target,
    color: "text-blue-400",
    bg: "bg-blue-400/10",
    border: "border-blue-400/20 hover:border-blue-400/50",
    title: "Tournament",
    desc: "Single or multi-day bracket event with seeding, registration, and check-in.",
    href: "/admin/tournaments",
    badge: null,
  },
  {
    icon: Calendar,
    color: "text-green-400",
    bg: "bg-green-400/10",
    border: "border-green-400/20 hover:border-green-400/50",
    title: "Camp",
    desc: "Multi-day camp with daily sessions, coaches, and roster management.",
    href: "/admin/camps/new",
    badge: null,
  },
  {
    icon: Building2,
    color: "text-teal-400",
    bg: "bg-teal-400/10",
    border: "border-teal-400/20 hover:border-teal-400/50",
    title: "Court Rental",
    desc: "Self-serve hourly court bookings with custom pricing tiers, hours, and blackout dates.",
    href: "/admin/rentals/setup",
    badge: "Self-serve",
    badgeColor: "bg-teal-400/15 text-teal-400",
  },
];

export default function AdminCreate() {
  const { data: profile, isLoading } = useGetMyProfile();

  if (isLoading) return null;
  if (!profile || profile.role !== "admin") return <Redirect to="/" />;

  return (
    <AdminLayout>
      <div className="max-w-2xl mx-auto px-4 py-10">

        <div className="mb-8">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Plus className="h-4 w-4 text-primary" />
            </div>
            <h1 className="text-xl font-bold text-foreground">Create an Offering</h1>
          </div>
          <p className="text-sm text-muted-foreground ml-10">
            Choose what you want to create. Each type has a guided setup wizard.
          </p>
        </div>

        <div className="space-y-3">
          {OFFERINGS.map((o) => (
            <Link key={o.href} href={o.href}>
              <div
                className={`group flex items-center gap-5 p-5 rounded-2xl border bg-card transition-all cursor-pointer ${o.border}`}
              >
                <div className={`w-12 h-12 rounded-xl ${o.bg} flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform`}>
                  <o.icon className={`h-6 w-6 ${o.color}`} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-semibold text-foreground">{o.title}</span>
                    {o.badge && (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${o.badgeColor}`}>
                        {o.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground leading-snug">{o.desc}</p>
                </div>

                <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all flex-shrink-0" />
              </div>
            </Link>
          ))}
        </div>

      </div>
    </AdminLayout>
  );
}
