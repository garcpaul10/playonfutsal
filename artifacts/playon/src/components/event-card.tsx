import React from "react";
import { Link } from "wouter";
import { Calendar, Users, ArrowRight, MapPin } from "lucide-react";
import { motion } from "framer-motion";

export type EventStatus = "Open" | "Full" | "Upcoming";

export interface EventCardProps {
  href: string;
  imageUrl?: string | null;
  type: "League" | "Camp" | "Drop-in" | "Tournament" | "King of the Court";
  accent: string;
  placeholderChar: string;
  placeholderBg: string;
  patternId: string;
  title: string;
  ageGroups?: string[];
  gender?: string | null;
  dateLabel: string;
  priceLabel: string;
  spotsUsed: number;
  spotsTotal: number;
  poolCount?: number | null;
  status: EventStatus;
  secondaryBadge?: string | null;
  index?: number;
  teamSize?: number;
}

const STATUS_STYLES: Record<EventStatus, string> = {
  Open: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  Full: "bg-red-500/20 text-red-400 border-red-500/30",
  Upcoming: "bg-white/10 text-white/60 border-white/20",
};

const TYPE_STYLES: Record<string, string> = {
  League: "bg-[#dc2626]/80 text-white border-[#dc2626]/30",
  Camp: "bg-[#1d4ed8]/80 text-white border-[#1d4ed8]/30",
  "Drop-in": "bg-[#166534]/80 text-[#4ade80] border-[#4ade80]/30",
  Tournament: "bg-[#92400e]/80 text-[#fbbf24] border-[#fbbf24]/30",
  "King of the Court": "bg-[#78350f]/80 text-[#f59e0b] border-[#f59e0b]/30",
};

const ACCENT_HOVER: Record<string, string> = {
  League: "group-hover:bg-[#dc2626]/80 group-hover:border-[#dc2626]",
  Camp: "group-hover:bg-[#1d4ed8]/80 group-hover:border-[#1d4ed8]",
  "Drop-in": "group-hover:bg-[#166534]/80 group-hover:border-[#4ade80]/30",
  Tournament: "group-hover:bg-[#92400e]/60 group-hover:border-[#fbbf24]/30",
  "King of the Court": "group-hover:bg-[#78350f]/60 group-hover:border-[#f59e0b]/40",
};

const TITLE_HOVER: Record<string, string> = {
  League: "group-hover:text-[#ef4444]",
  Camp: "group-hover:text-[#60a5fa]",
  "Drop-in": "group-hover:text-[#4ade80]",
  Tournament: "group-hover:text-[#fbbf24]",
  "King of the Court": "group-hover:text-[#f59e0b]",
};

const CARD_SHADOW: Record<string, string> = {
  League: "hover:shadow-[0_16px_48px_rgba(0,0,0,0.8),0_0_0_1px_rgba(239,68,68,0.2)]",
  Camp: "hover:shadow-[0_16px_48px_rgba(0,0,0,0.8),0_0_0_1px_rgba(96,165,250,0.25)]",
  "Drop-in": "hover:shadow-[0_16px_48px_rgba(0,0,0,0.8),0_0_0_1px_rgba(74,222,128,0.2)]",
  Tournament: "hover:shadow-[0_16px_48px_rgba(0,0,0,0.8),0_0_0_1px_rgba(251,191,36,0.2)]",
  "King of the Court": "hover:shadow-[0_16px_48px_rgba(0,0,0,0.8),0_0_0_1px_rgba(245,158,11,0.25)]",
};

export function EventCard({
  href,
  imageUrl,
  type,
  accent,
  placeholderChar,
  placeholderBg,
  patternId,
  title,
  ageGroups,
  gender,
  dateLabel,
  priceLabel,
  spotsUsed,
  spotsTotal,
  poolCount,
  status,
  secondaryBadge,
  index = 0,
  teamSize,
}: EventCardProps) {
  const fillPct = spotsTotal > 0 ? Math.min(100, Math.round((spotsUsed / spotsTotal) * 100)) : 0;
  const spotsLeft = spotsTotal - spotsUsed;
  const fillBarColor =
    fillPct >= 90 ? "bg-red-500" : fillPct >= 70 ? "bg-orange-400" : `bg-[${accent}]`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay: index * 0.07 }}
    >
      <Link href={href} className="block h-full group">
        <div
          className={`relative h-full flex flex-col rounded-2xl overflow-hidden border border-white/10 bg-[#111118] shadow-[0_8px_32px_rgba(0,0,0,0.6)] hover:border-white/20 transition-all duration-300 ${CARD_SHADOW[type] ?? ""}`}
        >
          <div className="relative h-44 overflow-hidden flex-shrink-0">
            {imageUrl ? (
              <div className={`w-full h-full relative ${placeholderBg}`}>
                <img
                  src={imageUrl}
                  alt={title}
                  className="absolute inset-0 w-full h-full object-cover opacity-35 transition-opacity duration-500 group-hover:opacity-45"
                />
                <div className="absolute inset-0 bg-[#0a1a0e]/60" />
                <svg
                  className="absolute inset-0 w-full h-full opacity-15"
                  preserveAspectRatio="xMidYMid slice"
                >
                  <defs>
                    <pattern
                      id={patternId}
                      x="0"
                      y="0"
                      width="40"
                      height="40"
                      patternUnits="userSpaceOnUse"
                    >
                      <circle cx="20" cy="20" r="15" stroke="white" strokeWidth="1" fill="none" />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill={`url(#${patternId})`} />
                </svg>
              </div>
            ) : (
              <div
                className={`w-full h-full flex items-center justify-center relative ${placeholderBg}`}
              >
                <svg
                  className="absolute inset-0 w-full h-full opacity-10"
                  preserveAspectRatio="xMidYMid slice"
                >
                  <defs>
                    <pattern
                      id={patternId}
                      x="0"
                      y="0"
                      width="40"
                      height="40"
                      patternUnits="userSpaceOnUse"
                    >
                      <circle cx="20" cy="20" r="15" stroke="white" strokeWidth="1" fill="none" />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill={`url(#${patternId})`} />
                </svg>
                <span className="text-[72px] opacity-10 font-black text-white select-none">
                  {placeholderChar}
                </span>
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[#111118] via-transparent to-transparent" />

            <div className="absolute top-3 left-3 flex gap-1.5 flex-wrap">
              <span
                className={`inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-full border ${TYPE_STYLES[type] ?? "bg-white/10 text-white border-white/10"}`}
              >
                {type}
              </span>
              {secondaryBadge && (
                <span className="inline-flex items-center bg-black/60 backdrop-blur-sm text-white text-xs font-bold px-2.5 py-1 rounded-full border border-white/10 uppercase">
                  {secondaryBadge}
                </span>
              )}
            </div>

            <div className="absolute top-3 right-3">
              <span
                className={`inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-full border ${STATUS_STYLES[status]}`}
              >
                {status}
              </span>
            </div>
          </div>

          <div className="flex flex-col flex-1 p-4 gap-3">
            <div>
              {(ageGroups && ageGroups.length > 0) || gender ? (
                <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                  {ageGroups && ageGroups.length > 0 && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-white/5 text-white/50 border border-white/10 inline-block">
                      {ageGroups.map((ag) => ag === "adult" ? "Adult" : ag === "youth" ? "Youth" : ag === "all_ages" || ag === "All Ages" ? "All Ages" : ag.toUpperCase()).join(" · ")}
                    </span>
                  )}
                  {gender && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-white/5 text-purple-300/70 border border-purple-500/15 inline-block capitalize">
                      {gender}
                    </span>
                  )}
                </div>
              ) : null}
              <h3
                className={`text-white font-bold text-base leading-snug line-clamp-2 transition-colors ${TITLE_HOVER[type] ?? ""}`}
              >
                {title}
              </h3>
            </div>

            <div className="space-y-1 flex-1">
              <div className="flex items-center gap-2 text-white/50 text-xs">
                <Calendar className="h-3.5 w-3.5 flex-shrink-0" style={{ color: accent }} />
                <span>{dateLabel}</span>
              </div>
              <div className="flex items-center gap-2 text-white/50 text-xs">
                <MapPin className="h-3.5 w-3.5 flex-shrink-0" style={{ color: accent }} />
                <span>Alumni Center · Lexington, KY</span>
              </div>
              <div className="flex items-center gap-2 text-white/50 text-xs">
                <Users className="h-3.5 w-3.5 flex-shrink-0" style={{ color: accent }} />
                <span>
                  {type === "King of the Court"
                    ? `${spotsUsed} team${spotsUsed !== 1 ? "s" : ""} registered${teamSize ? ` · ${teamSize}v${teamSize}` : ""}`
                    : type === "Drop-in" && poolCount
                    ? `${poolCount} session${poolCount !== 1 ? "s" : ""} available`
                    : `${spotsUsed}/${spotsTotal} ${type === "League" || type === "Tournament" ? "teams" : "spots"}`
                  }
                </span>
                <span
                  className="ml-auto font-black text-sm"
                  style={{ color: accent }}
                >
                  {priceLabel}
                </span>
              </div>
            </div>

            <div>
              {status !== "Full" && type !== "King of the Court" ? (
                <div className="mb-2">
                  <div className="flex justify-between items-center mb-1">
                    <span
                      className={`text-xs font-medium ${fillPct >= 70 ? "text-orange-400" : "text-white/40"}`}
                    >
                      {fillPct >= 70 ? "⚡ Filling fast" : `${spotsLeft} left`}
                    </span>
                  </div>
                  <div className="w-full h-1 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${fillPct >= 90 ? "bg-red-500" : fillPct >= 70 ? "bg-orange-400" : ""}`}
                      style={{
                        width: `${fillPct}%`,
                        backgroundColor:
                          fillPct >= 90
                            ? undefined
                            : fillPct >= 70
                            ? undefined
                            : accent,
                      }}
                    />
                  </div>
                </div>
              ) : null}

              {status === "Full" ? (
                <div className="w-full h-10 rounded-xl bg-white/5 border border-white/20 text-white/60 font-semibold text-sm transition-all duration-200 flex items-center justify-center gap-2 hover:bg-white/10 hover:text-white/80 hover:border-white/30">
                  Join Waitlist
                  <ArrowRight className="h-3.5 w-3.5" />
                </div>
              ) : (
                <div
                  className={`w-full h-10 rounded-xl bg-white/5 border border-white/10 text-white font-semibold text-sm transition-all duration-200 flex items-center justify-center gap-2 ${ACCENT_HOVER[type] ?? ""}`}
                >
                  View Details
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                </div>
              )}
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

export function EventCardSkeleton() {
  return (
    <div className="h-[340px] rounded-2xl bg-white/5 animate-pulse border border-white/10" />
  );
}

export function EventListEmpty({
  icon,
  message,
  hint,
  onClearFilters,
}: {
  icon: React.ReactNode;
  message: string;
  hint?: string;
  onClearFilters?: () => void;
}) {
  return (
    <div className="text-center py-20 rounded-2xl border border-white/10 border-dashed bg-white/5">
      <div className="text-white/20 mx-auto mb-4 w-12 h-12 flex items-center justify-center">
        {icon}
      </div>
      <p className="text-white/40 text-base font-medium">{message}</p>
      {hint && <p className="text-white/25 text-sm mt-1">{hint}</p>}
      {onClearFilters && (
        <button
          onClick={onClearFilters}
          className="mt-4 text-sm font-semibold text-white/50 hover:text-white underline underline-offset-2 transition-colors"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

export function AgeFilterChips({
  filters,
  active,
  onChange,
}: {
  filters: { value: string; label: string }[];
  active: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 mb-8">
      {filters.map((f) => (
        <button
          key={f.value}
          onClick={() => onChange(f.value)}
          className={`px-3.5 py-1.5 rounded-full text-sm font-semibold border transition-all duration-150 ${
            active === f.value
              ? "bg-[#dc2626] border-[#dc2626] text-white"
              : "bg-white/5 border-white/10 text-white/55 hover:border-white/30 hover:text-white"
          }`}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

export function computeStatus(
  registrationOpen: boolean,
  spotsUsed: number,
  spotsTotal: number
): EventStatus {
  if (spotsTotal > 0 && spotsUsed >= spotsTotal) return "Full";
  if (registrationOpen === true) return "Open";
  return "Upcoming";
}

export function isDropinRegistrationOpen(status: string | undefined): boolean {
  return status === "upcoming";
}

export function isEventRegistrationOpen(registrationOpen: boolean | null | undefined): boolean {
  return registrationOpen === true;
}
