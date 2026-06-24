import React, { useState } from "react";
import { useListTournaments } from "@workspace/api-client-react";
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

export default function TournamentsList() {
  const { data: tournaments, isLoading } = useListTournaments();
  const [ageFilter, setAgeFilter] = useState("all");

  const allAgeGroups: string[] = React.useMemo(() => {
    if (!tournaments) return [];
    const set = new Set<string>();
    tournaments.forEach((t: any) => {
      const groups: string[] = Array.isArray(t.ageGroup)
        ? t.ageGroup
        : t.ageGroup
        ? [t.ageGroup]
        : [];
      groups.forEach((g) => set.add(g));
    });
    return Array.from(set);
  }, [tournaments]);

  const ageFilters = React.useMemo(() => {
    const known = AGE_GROUPS.filter((g) => allAgeGroups.includes(g.value));
    return [{ value: "all", label: "All Ages" }, ...known];
  }, [allAgeGroups]);

  const displayed = React.useMemo(() => {
    if (ageFilter === "all") return tournaments;
    return (tournaments || []).filter((t: any) => {
      const groups: string[] = Array.isArray(t.ageGroup)
        ? t.ageGroup
        : t.ageGroup
        ? [t.ageGroup]
        : [];
      return groups.includes(ageFilter);
    });
  }, [tournaments, ageFilter]);

  return (
    <Layout>
      <PageHero
        eyebrow={<><Trophy className="h-3.5 w-3.5" /> High Stakes · Cash Prizes</>}
        eyebrowColor="#fbbf24"
        title="Tournaments"
        subtitle="Weekend shootouts and holiday events. Bracket play, intense competition, and prizes on the line."
        glowColor="rgba(120,53,15,0.22)"
        glowPosition="right"
        pattern="diagonal"
        patternId="tournaments-hero-pattern"
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
              {[1, 2, 3].map((i) => (
                <EventCardSkeleton key={i} />
              ))}
            </div>
          ) : displayed && displayed.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {displayed.map((tournament: any, i: number) => {
                const spotsUsed = tournament.teamsRegistered || 0;
                const spotsTotal = tournament.maxTeams || 0;
                const ageGroups: string[] = Array.isArray(tournament.ageGroup)
                  ? tournament.ageGroup
                  : tournament.ageGroup
                  ? [tournament.ageGroup]
                  : [];
                const startFmt = tournament.startDate
                  ? format(new Date(tournament.startDate), "MMM d")
                  : null;
                const endFmt = tournament.endDate
                  ? format(new Date(tournament.endDate), "MMM d, yyyy")
                  : null;
                const dateLabel = startFmt
                  ? endFmt
                    ? `${startFmt} – ${endFmt}`
                    : startFmt
                  : "Date TBD";
                const price = tournament.teamPrice ?? 0;
                const status = computeStatus(
                  isEventRegistrationOpen(tournament.registrationOpen),
                  spotsUsed,
                  spotsTotal
                );
                return (
                  <EventCard
                    key={tournament.id}
                    href={`/tournaments/${tournament.id}`}
                    imageUrl={tournament.imageUrl}
                    type="Tournament"
                    accent="#fbbf24"
                    placeholderChar="T"
                    placeholderBg="bg-gradient-to-br from-[#100d02] to-[#3a2a06]"
                    patternId={`tn-${tournament.id}`}
                    title={tournament.name}
                    ageGroups={ageGroups}
                    gender={tournament.gender}
                    dateLabel={dateLabel}
                    priceLabel={price ? `$${price}` : "Free"}
                    spotsUsed={spotsUsed}
                    spotsTotal={spotsTotal}
                    status={status}
                    secondaryBadge={tournament.format ?? null}
                    index={i}
                  />
                );
              })}
            </div>
          ) : (
            <EventListEmpty
              icon={<Trophy className="h-12 w-12" />}
              message="No tournaments scheduled right now."
              hint="Stay tuned — new events are coming soon."
              onClearFilters={ageFilter !== "all" ? () => setAgeFilter("all") : undefined}
            />
          )}
        </div>
      </div>
    </Layout>
  );
}
