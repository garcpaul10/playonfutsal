import React, { useState, useEffect, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { useQuery } from "@tanstack/react-query";
import { Search, Trophy, Sun, Zap, Award, Crown } from "lucide-react";
import { format } from "date-fns";
import { formatEastern } from "@/lib/timezone";
import { Input } from "@/components/ui/input";
import {
  EventCard,
  EventCardSkeleton,
  EventListEmpty,
  AgeFilterChips,
  computeStatus,
  isEventRegistrationOpen,
  isDropinRegistrationOpen,
} from "@/components/event-card";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

type ProgramType = "all" | "league" | "camp" | "drop_in" | "tournament" | "kotc";

const CATEGORY_TABS: { value: ProgramType; label: string; icon: React.ElementType; color: string }[] = [
  { value: "all",        label: "All",                icon: Trophy, color: "#ef4444" },
  { value: "league",     label: "Leagues",            icon: Trophy, color: "#ef4444" },
  { value: "camp",       label: "Camps",              icon: Sun,    color: "#60a5fa" },
  { value: "drop_in",    label: "Drop-ins",           icon: Zap,    color: "#4ade80" },
  { value: "tournament", label: "Tournaments",        icon: Award,  color: "#fbbf24" },
  { value: "kotc",       label: "King of the Court",  icon: Crown,  color: "#f59e0b" },
];

const CARD_TYPE_MAP: Record<string, "League" | "Camp" | "Drop-in" | "Tournament" | "King of the Court"> = {
  league:     "League",
  camp:       "Camp",
  drop_in:    "Drop-in",
  dropin:     "Drop-in",
  tournament: "Tournament",
  kotc:       "King of the Court",
};

const CARD_ACCENT: Record<string, string> = {
  league:     "#ef4444",
  camp:       "#60a5fa",
  drop_in:    "#4ade80",
  dropin:     "#4ade80",
  tournament: "#fbbf24",
  kotc:       "#f59e0b",
};

const CARD_PLACEHOLDER_BG: Record<string, string> = {
  league:     "bg-gradient-to-br from-[#1a0a0a] to-[#2d0d0d]",
  camp:       "bg-gradient-to-br from-[#080f1a] to-[#1e4976]",
  drop_in:    "bg-gradient-to-br from-[#080f08] to-[#0f2410]",
  dropin:     "bg-gradient-to-br from-[#080f08] to-[#0f2410]",
  tournament: "bg-gradient-to-br from-[#100d02] to-[#3a2a06]",
  kotc:       "bg-gradient-to-br from-[#1a1000] to-[#3a2800]",
};

const CARD_PLACEHOLDER_CHAR: Record<string, string> = {
  league: "L", camp: "C", drop_in: "D", dropin: "D", tournament: "T", kotc: "♛",
};

function buildDateLabel(program: any): string {
  if (program.startsAt) {
    const earliest = new Date(program.startsAt);
    const dateStr = format(earliest, "EEE, MMM d");
    const earliestTime = formatEastern(earliest, "h:mm a 'ET'");
    if (program.poolLatestStartsAt) {
      const latest = new Date(program.poolLatestStartsAt);
      if (latest.getTime() - earliest.getTime() > 30 * 60 * 1000) {
        return `${dateStr} · ${earliestTime}–${formatEastern(latest, "h:mm a 'ET'")}`;
      }
    }
    return `${dateStr} · ${earliestTime}`;
  }
  if (program.startDate) {
    const start = format(new Date(`${program.startDate.split('T')[0]}T00:00:00`), "MMM d");
    const end = program.endDate ? format(new Date(`${program.endDate.split('T')[0]}T00:00:00`), "MMM d, yyyy") : null;
    return end ? `${start} – ${end}` : start;
  }
  return "Date TBD";
}

export default function ExplorePage() {
  const [location] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const initialType = (params.get("type") as ProgramType) ?? "all";
  const [activeType, setActiveType] = useState<ProgramType>(initialType);
  const [ageFilter, setAgeFilter] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const t = p.get("type") as ProgramType;
    if (t && t !== activeType) setActiveType(t);
  }, [location]);

  const { data: programs, isLoading } = useQuery<any[]>({
    queryKey: ["explore-programs", activeType],
    queryFn: async () => {
      const url = activeType === "all"
        ? `${API_BASE}/programs`
        : `${API_BASE}/programs?type=${activeType}`;
      const res = await fetch(url);
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });

  const ageFilters = useMemo(() => {
    if (!programs) return [{ value: "all", label: "All Ages" }];
    let hasYouth = false;
    let hasAdult = false;
    programs.forEach((p: any) => {
      const groups: string[] = Array.isArray(p.ageGroup) ? p.ageGroup : p.ageGroup ? [p.ageGroup] : [];
      groups.forEach((g) => {
        if (g === "adult") hasAdult = true;
        else hasYouth = true;
      });
    });
    if (!hasYouth && !hasAdult) return [{ value: "all", label: "All Ages" }];
    const chips: { value: string; label: string }[] = [{ value: "all", label: "All Ages" }];
    if (hasYouth) chips.push({ value: "youth", label: "Youth" });
    if (hasAdult) chips.push({ value: "adult", label: "Adult" });
    return chips;
  }, [programs]);

  const filtered = useMemo(() => {
    return (programs ?? []).filter((p: any) => {
      if (ageFilter !== "all") {
        const groups: string[] = Array.isArray(p.ageGroup) ? p.ageGroup : p.ageGroup ? [p.ageGroup] : [];
        if (ageFilter === "youth") {
          if (!groups.some((g) => g !== "adult")) return false;
        } else if (ageFilter === "adult") {
          if (!groups.includes("adult")) return false;
        } else {
          if (!groups.includes(ageFilter)) return false;
        }
      }
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        (p.name ?? "").toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [programs, ageFilter, search]);

  return (
    <Layout>
      <div className="bg-[#050508] min-h-screen">
        {/* Hero bar */}
        <div className="bg-gradient-to-b from-[#0a0a12] to-[#050508] border-b border-white/5 pt-10 pb-6">
          <div className="container mx-auto px-4">
            <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tight text-white mb-2">Explore</h1>
            <p className="text-white/50 text-base">Leagues, camps, drop-ins and tournaments at the Alumni Center</p>
            <div className="relative mt-6 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search programs…"
                className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-white/20"
              />
            </div>
          </div>
        </div>

        <div className="container mx-auto px-4 py-8">
          {/* Category tabs */}
          <div className="flex gap-2 overflow-x-auto pb-2 mb-6 scrollbar-hide">
            {CATEGORY_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setActiveType(tab.value)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border transition-all duration-150 whitespace-nowrap flex-shrink-0 ${
                  activeType === tab.value
                    ? "border-transparent text-white"
                    : "bg-white/5 border-white/10 text-white/60 hover:border-white/30 hover:text-white"
                }`}
                style={activeType === tab.value ? { backgroundColor: tab.color, borderColor: tab.color } : {}}
              >
                <tab.icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Age filter — only show groups present in data */}
          {ageFilters.length > 1 && (
            <AgeFilterChips filters={ageFilters} active={ageFilter} onChange={setAgeFilter} />
          )}

          {/* Results */}
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {[...Array(8)].map((_, i) => <EventCardSkeleton key={i} />)}
            </div>
          ) : filtered.length === 0 ? (
            <EventListEmpty
              icon={<Trophy className="h-12 w-12" />}
              message={search ? "No matching programs found." : ageFilter !== "all" ? "No programs for this age group." : "No programs available right now."}
              hint={search ? "Try a different search term." : ageFilter !== "all" ? "Try selecting a different age group." : "Check back soon for new offerings."}
              onClearFilters={ageFilter !== "all" || search ? () => { setAgeFilter("all"); setSearch(""); } : undefined}
            />
          ) : (
            <>
              <p className="text-white/30 text-sm mb-5">{filtered.length} program{filtered.length !== 1 ? "s" : ""}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {filtered.map((program: any, i: number) => {
                  const type = program.type ?? "league";
                  const cardType = CARD_TYPE_MAP[type] ?? "League";
                  const accent = CARD_ACCENT[type] ?? "#ef4444";
                  const isKotc = type === "kotc";
                  const spotsTotal = isKotc ? 0 : (program.spotsTotal ?? program.capacity ?? 0);
                  const spotsAvailable = isKotc ? 0 : (program.spotsAvailable ?? 0);
                  const spotsUsed = isKotc ? (program.teamCount ?? 0) : (spotsTotal - spotsAvailable);
                  const displayPrice = program.price ?? program.registrationPrice ?? program.teamPrice;
                  const href =
                    type === "drop_in" || type === "dropin"
                      ? program.isTemplate
                        ? `/dropins/occ/${program.id}/${program.occurrenceDate}`
                        : `/dropins/${program.id}`
                      : type === "kotc"
                      ? `/kotc/seasons/${program.id}`
                      : `/${type}s/${program.id}`;
                  const rawAgeGroups: string[] = Array.isArray(program.ageGroup)
                    ? program.ageGroup
                    : program.ageGroup
                    ? [program.ageGroup]
                    : [];
                  const isDropin = type === "drop_in" || type === "dropin";
                  const ageGroups: string[] = isDropin
                    ? [...new Set(rawAgeGroups.map((ag: string) => ag === "adult" ? "adult" : "youth"))]
                    : rawAgeGroups;
                  const registrationOpen =
                    type === "dropin" || type === "drop_in"
                      ? isDropinRegistrationOpen(program.status)
                      : type === "kotc"
                      ? (program.status === "upcoming" || program.status === "active")
                      : isEventRegistrationOpen(program.registrationOpen);
                  const status = computeStatus(registrationOpen, spotsUsed, spotsTotal);

                  return (
                    <EventCard
                      key={`${type}-${program.id}`}
                      href={href}
                      imageUrl={program.imageUrl}
                      type={cardType}
                      accent={accent}
                      placeholderChar={CARD_PLACEHOLDER_CHAR[type] ?? "P"}
                      placeholderBg={CARD_PLACEHOLDER_BG[type] ?? "bg-[#111118]"}
                      patternId={`ex-${type}-${program.id}`}
                      title={program.name}
                      ageGroups={ageGroups}
                      gender={program.gender}
                      dateLabel={buildDateLabel(program)}
                      priceLabel={displayPrice != null ? `$${displayPrice}` : "Free"}
                      spotsUsed={spotsUsed}
                      spotsTotal={spotsTotal}
                      status={status}
                      secondaryBadge={isKotc ? (program.sport ? (program.sport as string).toUpperCase() : null) : (program.format ?? null)}
                      teamSize={isKotc ? program.teamSize : undefined}
                      index={i}
                    />
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
