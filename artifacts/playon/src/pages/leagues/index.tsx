import React, { useState } from "react";
import { useListLeagues } from "@workspace/api-client-react";
import { AGE_GROUPS } from "@workspace/brand";
import { Layout } from "@/components/layout";
import { Trophy } from "lucide-react";
import { format } from "date-fns";
import { PageHero } from "@/components/brand-ui";
import {
  EventCard,
  EventCardSkeleton,
  EventListEmpty,
  AgeFilterChips,
  computeStatus,
  isEventRegistrationOpen,
} from "@/components/event-card";

export default function LeaguesList() {
  const { data: leagues, isLoading } = useListLeagues();
  const [ageFilter, setAgeFilter] = useState("all");

  const allAgeGroups: string[] = React.useMemo(() => {
    if (!leagues) return [];
    const set = new Set<string>();
    leagues.forEach((l: any) => {
      const groups: string[] = Array.isArray(l.ageGroup)
        ? l.ageGroup
        : l.ageGroup
        ? [l.ageGroup]
        : [];
      groups.forEach((g) => set.add(g));
    });
    return Array.from(set);
  }, [leagues]);

  const ageFilters = React.useMemo(() => {
    const known = AGE_GROUPS.filter((g) => allAgeGroups.includes(g.value));
    return [{ value: "all", label: "All Ages" }, ...known];
  }, [allAgeGroups]);

  const displayed = React.useMemo(() => {
    if (ageFilter === "all") return leagues;
    return (leagues || []).filter((l: any) => {
      const groups: string[] = Array.isArray(l.ageGroup)
        ? l.ageGroup
        : l.ageGroup
        ? [l.ageGroup]
        : [];
      return groups.includes(ageFilter);
    });
  }, [leagues, ageFilter]);

  return (
    <Layout>
      <PageHero
        eyebrow={<><Trophy className="h-3.5 w-3.5" /> Alumni Center · Lexington, KY</>}
        eyebrowColor="#ef4444"
        title="Leagues"
        subtitle="Competitive and recreational futsal seasons for youth and adults. Find your division and claim your spot."
        glowColor="rgba(157,20,40,0.18)"
        glowPosition="left"
        pattern="court-grid"
        patternId="leagues-hero-pattern"
      />

      <div className="bg-[#0a0a10] min-h-screen py-16">
        <div className="container mx-auto px-4">
          {ageFilters.length > 1 && (
            <AgeFilterChips
              filters={ageFilters}
              active={ageFilter}
              onChange={setAgeFilter}
            />
          )}

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <EventCardSkeleton key={i} />
              ))}
            </div>
          ) : displayed && displayed.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {displayed.map((league: any, i: number) => {
                const spotsUsed = league.teamsRegistered || 0;
                const spotsTotal = league.maxTeams || 0;
                const ageGroups: string[] = Array.isArray(league.ageGroup)
                  ? league.ageGroup
                  : league.ageGroup
                  ? [league.ageGroup]
                  : [];
                const dateLabel = league.startDate
                  ? `Starts ${format(new Date(league.startDate), "MMM d, yyyy")}`
                  : "Date TBD";
                const price = league.registrationPrice ?? league.price ?? 0;
                const status = computeStatus(
                  isEventRegistrationOpen(league.registrationOpen),
                  spotsUsed,
                  spotsTotal
                );
                return (
                  <EventCard
                    key={league.id}
                    href={`/leagues/${league.id}`}
                    imageUrl={league.imageUrl}
                    type="League"
                    accent="#ef4444"
                    placeholderChar="L"
                    placeholderBg="bg-gradient-to-br from-[#1a0a0a] to-[#2d0d0d]"
                    patternId={`lg-${league.id}`}
                    title={league.name}
                    ageGroups={ageGroups}
                    gender={league.gender}
                    dateLabel={dateLabel}
                    priceLabel={price ? `$${price}` : "Free"}
                    spotsUsed={spotsUsed}
                    spotsTotal={spotsTotal}
                    status={status}
                    secondaryBadge={league.format ?? null}
                    index={i}
                  />
                );
              })}
            </div>
          ) : (
            <EventListEmpty
              icon={<Trophy className="h-12 w-12" />}
              message="No leagues available at the moment."
              hint="Check back soon — new seasons are always coming."
              onClearFilters={ageFilter !== "all" ? () => setAgeFilter("all") : undefined}
            />
          )}
        </div>
      </div>
    </Layout>
  );
}
