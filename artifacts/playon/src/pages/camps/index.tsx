import React, { useState } from "react";
import { useListCamps } from "@workspace/api-client-react";
import { AGE_GROUPS } from "@workspace/brand";
import { Layout } from "@/components/layout";
import { Users } from "lucide-react";
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

export default function CampsList() {
  const { data: camps, isLoading } = useListCamps();
  const [ageFilter, setAgeFilter] = useState("all");

  const allAgeGroups: string[] = React.useMemo(() => {
    if (!camps) return [];
    const set = new Set<string>();
    camps.forEach((c: any) => {
      const groups: string[] = Array.isArray(c.ageGroup)
        ? c.ageGroup
        : c.ageGroup
        ? [c.ageGroup]
        : [];
      groups.forEach((g) => set.add(g));
    });
    return Array.from(set);
  }, [camps]);

  const ageFilters = React.useMemo(() => {
    const known = AGE_GROUPS.filter((g) => allAgeGroups.includes(g.value));
    return [{ value: "all", label: "All Ages" }, ...known];
  }, [allAgeGroups]);

  const displayed = React.useMemo(() => {
    if (ageFilter === "all") return camps;
    return (camps || []).filter((c: any) => {
      const groups: string[] = Array.isArray(c.ageGroup)
        ? c.ageGroup
        : c.ageGroup
        ? [c.ageGroup]
        : [];
      return groups.includes(ageFilter);
    });
  }, [camps, ageFilter]);

  return (
    <Layout>
      <PageHero
        eyebrow={<><Users className="h-3.5 w-3.5" /> Skill Development · Expert Coaches</>}
        eyebrowColor="#60a5fa"
        title="Camps & Clinics"
        subtitle="Intensive training programs led by expert coaches. Built for youth players ready to elevate their game."
        glowColor="rgba(30,74,118,0.22)"
        glowPosition="right"
        pattern="horizontal-lines"
        patternId="camps-hero-pattern"
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
              {displayed.map((camp: any, i: number) => {
                const spotsUsed = camp.participantsRegistered || 0;
                const spotsTotal = camp.maxParticipants || 0;
                const ageGroups: string[] = Array.isArray(camp.ageGroup)
                  ? camp.ageGroup
                  : camp.ageGroup
                  ? [camp.ageGroup]
                  : [];
                const startFmt = camp.startDate
                  ? format(new Date(camp.startDate), "MMM d")
                  : null;
                const endFmt = camp.endDate
                  ? format(new Date(camp.endDate), "MMM d, yyyy")
                  : null;
                const dateLabel = startFmt
                  ? endFmt
                    ? `${startFmt} – ${endFmt}`
                    : startFmt
                  : "Date TBD";
                const price = camp.price ?? 0;
                const status = computeStatus(
                  isEventRegistrationOpen(camp.registrationOpen),
                  spotsUsed,
                  spotsTotal
                );
                return (
                  <EventCard
                    key={camp.id}
                    href={`/camps/${camp.id}`}
                    imageUrl={camp.imageUrl}
                    type="Camp"
                    accent="#60a5fa"
                    placeholderChar="C"
                    placeholderBg="bg-gradient-to-br from-[#080f1a] to-[#1e4976]"
                    patternId={`cp-${camp.id}`}
                    title={camp.name}
                    ageGroups={ageGroups}
                    gender={camp.gender}
                    dateLabel={dateLabel}
                    priceLabel={price ? `$${price}` : "Free"}
                    spotsUsed={spotsUsed}
                    spotsTotal={spotsTotal}
                    status={status}
                    index={i}
                  />
                );
              })}
            </div>
          ) : (
            <EventListEmpty
              icon={<Users className="h-12 w-12" />}
              message="No camps scheduled at the moment."
              hint="New training programs are added regularly — check back soon."
              onClearFilters={ageFilter !== "all" ? () => setAgeFilter("all") : undefined}
            />
          )}
        </div>
      </div>
    </Layout>
  );
}
