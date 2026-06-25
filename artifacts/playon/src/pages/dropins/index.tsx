import React, { useMemo } from "react";
import { useListDropins } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Activity } from "lucide-react";
import { format } from "date-fns";
import { formatEastern } from "@/lib/timezone";
import { PageHero } from "@/components/brand-ui";
import {
  EventCard,
  EventCardSkeleton,
  EventListEmpty,
  computeStatus,
} from "@/components/event-card";

import { API_BASE as API } from "@/lib/api-base";

export default function DropinsList() {
  const { data: legacySessions, isLoading: legacyLoading } = useListDropins();

  // Fetch new-style template occurrences
  const { data: occurrences, isLoading: occLoading } = useQuery({
    queryKey: ["dropin-occurrences-public"],
    queryFn: async () => {
      const r = await fetch(`${API}/dropin-occurrences`);
      return r.ok ? r.json() : [];
    },
  });

  const isLoading = legacyLoading || occLoading;

  // Build unified pool cards from both sources
  const poolCards = useMemo(() => {
    const cards: any[] = [];

    // Legacy sessions
    for (const session of (legacySessions as any[]) ?? []) {
      const pools = session.pools ?? [];
      if (pools.length === 0) {
        cards.push({ _source: "legacy", session, pool: null, sortTime: session.startsAt ? new Date(session.startsAt).getTime() : Infinity });
      } else {
        for (const pool of pools) {
          cards.push({ _source: "legacy", session, pool, sortTime: pool.startsAt ? new Date(pool.startsAt).getTime() : Infinity });
        }
      }
    }

    // New-style template occurrences
    for (const occ of (occurrences as any[]) ?? []) {
      const pools = occ.pools ?? [];
      if (pools.length === 0) {
        cards.push({ _source: "occurrence", occ, pool: null, sortTime: occ.startsAt ? new Date(occ.startsAt).getTime() : Infinity });
      } else {
        for (const pool of pools) {
          cards.push({ _source: "occurrence", occ, pool, sortTime: new Date(occ.startsAt).getTime() });
        }
      }
    }

    cards.sort((a, b) => a.sortTime - b.sortTime);
    return cards;
  }, [legacySessions, occurrences]);

  return (
    <Layout>
      <PageHero
        eyebrow={<><Activity className="h-3.5 w-3.5" /> No Commitment · Just Play</>}
        eyebrowColor="#4ade80"
        title="Drop-ins"
        subtitle="Organized pickup sessions with guaranteed court time. Show up, pay, and play. No teams, no commitment."
        glowColor="rgba(22,101,52,0.2)"
        glowPosition="center"
        pattern="grid-lines"
        patternId="dropins-hero-pattern"
      />

      <div className="bg-[#0a0a10] min-h-screen py-16">
        <div className="container mx-auto px-4">
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => <EventCardSkeleton key={i} />)}
            </div>
          ) : poolCards.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {poolCards.map((item, i) => {
                if (item._source === "occurrence") {
                  const { occ, pool } = item;
                  const template = occ.template ?? {};
                  const price = pool ? Number(pool.price ?? 0) : 0;
                  const spotsUsed = pool?.spotsTaken ?? 0;
                  const spotsTotal = pool?.cap ?? 0;
                  const registrationOpen = !(pool?.registrationOpen === false);
                  const status = computeStatus(registrationOpen, spotsUsed, spotsTotal);
                  const rule = template.recurrenceRule ?? {};
                  const startsAt = occ.startsAt ? new Date(occ.startsAt) : null;
                  const dateLabel = startsAt ? `${format(startsAt, "EEE, MMM d")} · ${formatEastern(startsAt, "h:mm a 'ET'")}` : "Date TBD";
                  const rawAgeGroup = pool?.ageGroup ?? ["adult"];
                  const ageGroupArr: string[] = Array.isArray(rawAgeGroup) ? rawAgeGroup : [rawAgeGroup];
                  const ageGroups = ageGroupArr.includes("all_ages") ? ["all_ages"] : [...new Set<string>(ageGroupArr.map((ag: string) => ag === "adult" ? "adult" : "youth"))];

                  return (
                    <EventCard
                      key={`occ-${occ.templateId}-${occ.occurrenceDate}-${pool?.id ?? "nopools"}`}
                      href={`/dropins/occ/${occ.templateId}/${occ.occurrenceDate}${pool?.id ? `?poolId=${pool.id}` : ""}`}
                      imageUrl={template.imageUrl ?? null}
                      type="Drop-in"
                      accent="#4ade80"
                      placeholderChar="D"
                      placeholderBg="bg-gradient-to-br from-[#080f08] to-[#0f2410]"
                      patternId={`occ-${occ.templateId}-${occ.occurrenceDate}-${pool?.id ?? "s"}`}
                      title={template.name ?? "Drop-in Session"}
                      ageGroups={ageGroups}
                      gender={pool?.gender ?? null}
                      dateLabel={dateLabel}
                      priceLabel={price ? `$${price}` : "Free"}
                      spotsUsed={spotsUsed}
                      spotsTotal={spotsTotal}
                      status={status}
                      index={i}
                    />
                  );
                }

                // Legacy session card
                const { session, pool } = item;
                const price = pool ? Number(pool.price ?? 0) : 0;
                const spotsUsed = pool?.spotsTaken ?? 0;
                const spotsTotal = pool?.cap ?? 0;
                const registrationOpen = pool?.registrationOpen ?? false;
                let dateLabel = "Date TBD";
                if (pool?.startsAt) {
                  const t = new Date(pool.startsAt);
                  dateLabel = `${format(t, "EEE, MMM d")} · ${formatEastern(t, "h:mm a 'ET'")}`;
                }
                const rawAgeGroup = pool?.ageGroup ?? session.ageGroup;
                const ageGroupArr: string[] = Array.isArray(rawAgeGroup) ? rawAgeGroup : rawAgeGroup ? [rawAgeGroup] : ["adult"];
                const ageGroups: string[] = ageGroupArr.includes("all_ages") ? ["all_ages"] : [...new Set<string>(ageGroupArr.map((ag: string) => ag === "adult" ? "adult" : "youth"))];
                const status = computeStatus(registrationOpen, spotsUsed, spotsTotal);

                return (
                  <EventCard
                    key={`${session.id}-${pool?.id ?? "nopools"}-${i}`}
                    href={`/dropins/${session.id}`}
                    imageUrl={session.imageUrl ?? null}
                    type="Drop-in"
                    accent="#4ade80"
                    placeholderChar="D"
                    placeholderBg="bg-gradient-to-br from-[#080f08] to-[#0f2410]"
                    patternId={`di-${session.id}-${pool?.id ?? "s"}`}
                    title={session.name}
                    ageGroups={ageGroups}
                    gender={pool?.gender ?? session.gender}
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
              icon={<Activity className="h-12 w-12" />}
              message="No drop-in sessions scheduled right now."
              hint="New sessions are posted regularly — check back soon."
            />
          )}
        </div>
      </div>
    </Layout>
  );
}
