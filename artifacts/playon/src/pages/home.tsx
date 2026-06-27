import React from "react";
import { Link } from "wouter";
import {
  ChevronRight,
  Calendar,
  Trophy,
  Users,
  Activity,
  Zap,
  Clock,
  MapPin,
  ArrowRight,
  Star,
} from "lucide-react";
import { motion, useMotionValue, useTransform, useSpring } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useListFeaturedPrograms } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { format } from "date-fns";
import { formatEastern } from "@/lib/timezone";

export default function Home() {
  const { data: featuredPrograms, isLoading } = useListFeaturedPrograms();

  return (
    <Layout>
      <HeroSection featuredPrograms={featuredPrograms} />
      <FeaturedProgramsSection featuredPrograms={featuredPrograms} isLoading={isLoading} />
      <WaysToPlaySection />
      <HowItWorksSection />
      <StatsSection />
      <ReferralBanner />
      <CtaSection />
    </Layout>
  );
}

function HeroSection({ featuredPrograms }: { featuredPrograms?: any[] }) {
  const nextProgram = featuredPrograms?.find((p) => p.status === "upcoming") ?? featuredPrograms?.[0];
  const programCount = featuredPrograms?.length ?? 0;

  return (
    <section className="relative min-h-[90vh] flex items-center overflow-hidden bg-[#050508]">
      {/* Full-bleed background image */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage:
            "url('https://images.unsplash.com/photo-1543326727-cf6c39e8f84c?q=80&w=2940&auto=format&fit=crop')",
          opacity: 0.38,
        }}
      />
      {/* Multi-stop gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#050508] via-[#050508]/70 to-[#050508]/20" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#050508]/80 via-transparent to-[#050508]/60" />
      {/* Crimson glow bloom */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[400px] rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(ellipse, rgba(157,20,40,0.22) 0%, transparent 70%)",
          filter: "blur(40px)",
        }}
      />
      {/* Court-line texture overlay */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.04]"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="court-lines" x="0" y="0" width="120" height="120" patternUnits="userSpaceOnUse">
            <line x1="60" y1="0" x2="60" y2="120" stroke="white" strokeWidth="1" />
            <line x1="0" y1="60" x2="120" y2="60" stroke="white" strokeWidth="1" />
            <circle cx="60" cy="60" r="30" stroke="white" strokeWidth="1" fill="none" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#court-lines)" />
      </svg>
      <div className="container mx-auto px-4 relative z-10 pt-20 pb-32">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <span className="inline-flex items-center gap-2 bg-white/5 border border-white/10 backdrop-blur-sm text-white/80 text-sm px-4 py-2 rounded-full font-medium">
              <span className="w-2 h-2 rounded-full bg-[#dc2626] animate-pulse inline-block" />
              Lexington's Premier Futsal Hub
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-6xl md:text-8xl font-black tracking-tight uppercase leading-none text-white"
            style={{ textShadow: "0 0 80px rgba(157,20,40,0.4)" }}
          >
            OWN THE{" "}
            <span
              className="text-[#ef4444]"
              style={{ textShadow: "0 0 60px rgba(239,68,68,0.6)" }}
            >
              COURT.
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-xl text-white/60 leading-relaxed max-w-2xl mx-auto"
          >
            Join the fastest growing youth and adult futsal leagues at the Alumni Center.
            Fast-paced, intense, and built for players who want to elevate their game.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2"
          >
            <Button
              size="lg"
              className="hidden w-full sm:w-auto text-base h-14 px-10 rounded-full bg-[#dc2626] border-[#b91c1c] text-white hover:bg-[#b91c1c] font-bold tracking-wide shadow-[0_0_30px_rgba(220,38,38,0.4)]"
              asChild
            >
              <Link href="/leagues">Find Your League</Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="w-full sm:w-auto text-base h-14 px-10 rounded-full border-white/20 text-white bg-white/5 backdrop-blur-sm hover:bg-white/10 font-semibold"
              asChild
            >
              <Link href="/dropins">Join  A Drop-in</Link>
            </Button>
          </motion.div>

          {/* Stat teaser */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="pt-6 flex flex-col sm:flex-row items-center justify-center gap-6 text-sm text-white/50"
          >
            {nextProgram && (
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-[#ef4444]" />
                <span>
                  Next program:{" "}
                  <span className="text-white/80 font-semibold">{nextProgram.name}</span>
                  {nextProgram.startDate && (
                    <> — {format(new Date(String(nextProgram.startDate).slice(0, 10) + "T00:00:00"), "MMM d")}</>
                  )}
                </span>
              </div>
            )}
            {programCount > 0 && (
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-[#ef4444]" />
                <span>
                  <span className="text-white/80 font-semibold">{programCount}</span> programs open for registration
                </span>
              </div>
            )}
          </motion.div>
        </div>
      </div>
      {/* Bottom fade to next section */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#050508] to-transparent pointer-events-none" />
    </section>
  );
}

function FeaturedProgramsSection({
  featuredPrograms,
  isLoading,
}: {
  featuredPrograms?: any[];
  isLoading: boolean;
}) {
  return (
    <section className="py-24 bg-[#0a0a10] relative overflow-hidden">
      {/* Court-line SVG texture */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.03]"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="court-diag" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
            <path d="M0 80 L80 0" stroke="white" strokeWidth="1" />
            <path d="M-20 80 L60 0" stroke="white" strokeWidth="0.5" />
            <path d="M20 80 L100 0" stroke="white" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#court-diag)" />
      </svg>

      <div className="container mx-auto px-4 relative z-10">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-14 gap-4">
          <div>
            <p className="text-[#ef4444] text-sm font-bold uppercase tracking-widest mb-2">
              Registration Open
            </p>
            <h2 className="text-4xl font-black uppercase tracking-tight text-white">
              Featured Programs
            </h2>
            <p className="text-white/40 mt-2 text-base">
              Claim your spot before they fill up
            </p>
          </div>
          <Button
            variant="ghost"
            className="group text-white/60 hover:text-white border-white/10 hover:border-white/20"
            asChild
          >
            <Link href="/leagues">
              View all programs
              <ChevronRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </Button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-[480px] rounded-2xl bg-white/5 animate-pulse border border-white/10" />
            ))}
          </div>
        ) : featuredPrograms && featuredPrograms.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {featuredPrograms.map((program) => (
              <RichProgramCard
                key={`${(program as any).type ?? "program"}-${program.id}`}
                program={program}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-24 bg-white/5 rounded-2xl border border-white/10 border-dashed">
            <p className="text-white/40">No featured programs available right now.</p>
            <Button variant="link" className="mt-4 text-[#ef4444]" asChild>
              <Link href="/leagues">Browse all leagues</Link>
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

const TYPE_CONFIG: Record<string, {
  accent: string;
  secondary: string;
  glowRgb: string;
  gradient: string;
  svgPattern: (id: string) => React.ReactNode;
  progressColorClass: string;
  priceTextClass: string;
  titleHoverClass: string;
  btnHoverBg: string;
  btnHoverBorder: string;
}> = {
  league: {
    accent: "#ef4444",
    secondary: "#dc2626",
    glowRgb: "239,68,68",
    gradient: "from-[#1a0a0a] to-[#2d0d0d]",
    svgPattern: (id) => (
      <pattern id={id} x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
        <circle cx="20" cy="20" r="15" stroke="white" strokeWidth="1" fill="none" />
      </pattern>
    ),
    progressColorClass: "bg-red-500",
    priceTextClass: "text-white",
    titleHoverClass: "group-hover:text-[#ef4444]",
    btnHoverBg: "rgba(220,38,38,0.8)",
    btnHoverBorder: "#dc2626",
  },
  camp: {
    accent: "#60a5fa",
    secondary: "#1d4ed8",
    glowRgb: "96,165,250",
    gradient: "from-[#080f1a] to-[#1e4976]",
    svgPattern: (id) => (
      <pattern id={id} x="0" y="0" width="50" height="50" patternUnits="userSpaceOnUse">
        <rect x="5" y="5" width="40" height="40" stroke="white" strokeWidth="1" fill="none" />
      </pattern>
    ),
    progressColorClass: "bg-blue-500",
    priceTextClass: "text-white",
    titleHoverClass: "group-hover:text-[#60a5fa]",
    btnHoverBg: "rgba(29,78,216,0.8)",
    btnHoverBorder: "#1d4ed8",
  },
  dropin: {
    accent: "#4ade80",
    secondary: "#166534",
    glowRgb: "74,222,128",
    gradient: "from-[#080f08] to-[#0f2410]",
    svgPattern: (id) => (
      <pattern id={id} x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
        <line x1="0" y1="0" x2="40" y2="0" stroke="white" strokeWidth="1" />
        <line x1="0" y1="0" x2="0" y2="40" stroke="white" strokeWidth="1" />
      </pattern>
    ),
    progressColorClass: "bg-emerald-500",
    priceTextClass: "text-[#4ade80]",
    titleHoverClass: "group-hover:text-[#4ade80]",
    btnHoverBg: "rgba(22,101,52,0.8)",
    btnHoverBorder: "rgba(74,222,128,0.3)",
  },
  tournament: {
    accent: "#fbbf24",
    secondary: "#92400e",
    glowRgb: "251,191,36",
    gradient: "from-[#100d02] to-[#3a2a06]",
    svgPattern: (id) => (
      <pattern id={id} x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M0 0 L40 40 M40 0 L0 40" stroke="white" strokeWidth="1" />
      </pattern>
    ),
    progressColorClass: "bg-amber-500",
    priceTextClass: "text-[#fbbf24]",
    titleHoverClass: "group-hover:text-[#fbbf24]",
    btnHoverBg: "rgba(146,64,14,0.6)",
    btnHoverBorder: "rgba(251,191,36,0.3)",
  },
};

function RichProgramCard({ program }: { program: any }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [6, -6]), { stiffness: 200, damping: 20 });
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-6, 6]), { stiffness: 200, damping: 20 });
  const [isCardHovered, setIsCardHovered] = React.useState(false);
  const [isBtnHovered, setIsBtnHovered] = React.useState(false);

  const cfg = TYPE_CONFIG[program.type] ?? TYPE_CONFIG.league;
  const patternId = `rpc-${program.type ?? "p"}-${program.id}`;

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    x.set((e.clientX - rect.left) / rect.width - 0.5);
    y.set((e.clientY - rect.top) / rect.height - 0.5);
  };
  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
    setIsCardHovered(false);
  };

  const spotsTotal = program.spotsTotal ?? program.capacity ?? 20;
  const spotsAvailable = program.spotsAvailable ?? 0;
  const spotsTaken = spotsTotal - spotsAvailable;
  const fillPct = Math.min(100, Math.round((spotsTaken / spotsTotal) * 100));
  const almostFull = fillPct >= 70;

  const ageLabel = program.ageGroup
    ? (Array.isArray(program.ageGroup) ? program.ageGroup.flatMap((g: string) => g.split(",").map((s: string) => s.trim())) : program.ageGroup.split(",").map((s: string) => s.trim()))
        .map((ag: string) => ag.replace("_", "-").toUpperCase())
        .join(" · ")
    : null;

  const displayPrice = program.price ?? program.registrationPrice ?? program.teamPrice;

  const parseDate = (s: string) => new Date(String(s).slice(0, 10) + "T00:00:00");
  const dateText = (() => {
    // For drop-ins with a full timestamp, show "Fri, Jun 20 · 6:00 PM"
    if (program.startsAt) {
      try {
        return formatEastern(new Date(program.startsAt), "EEE, MMM d · h:mm a 'ET'");
      } catch {
        // fall through
      }
    }
    if (!program.startDate) return null;
    try {
      const start = format(parseDate(String(program.startDate)), "MMM d");
      if (program.endDate) {
        return `${start} – ${format(parseDate(String(program.endDate)), "MMM d, yyyy")}`;
      }
      return `${start}, ${format(parseDate(String(program.startDate)), "yyyy")}`;
    } catch {
      return null;
    }
  })();

  return (
    <motion.div
      style={{ rotateX, rotateY, transformPerspective: 800, transformStyle: "preserve-3d" }}
      whileHover={{ scale: 1.02 }}
      transition={{ type: "spring", stiffness: 260, damping: 22 }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="h-full group"
    >
      <div
        className="relative h-full flex flex-col rounded-2xl overflow-hidden border border-white/10 bg-[#111118] transition-all duration-300"
        style={{
          boxShadow: isCardHovered
            ? `0 16px 48px rgba(0,0,0,0.8), 0 0 0 1px rgba(${cfg.glowRgb},0.2)`
            : "0 8px 32px rgba(0,0,0,0.6)",
        }}
        onMouseEnter={() => setIsCardHovered(true)}
      >
        {/* Card image / header */}
        <div className="relative h-48 overflow-hidden flex-shrink-0">
          {program.imageUrl ? (
            <img
              src={program.imageUrl}
              alt={program.name}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className={`w-full h-full bg-gradient-to-br ${cfg.gradient} flex items-center justify-center relative`}>
              <svg className="absolute inset-0 w-full h-full opacity-10" preserveAspectRatio="xMidYMid slice">
                <defs>{cfg.svgPattern(patternId)}</defs>
                <rect width="100%" height="100%" fill={`url(#${patternId})`} />
              </svg>
              <span className="text-[80px] opacity-10 font-black text-white select-none">
                {(program.type ?? "P").charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          {/* Gradient fade */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#111118] via-transparent to-transparent" />

          {/* Top-left: age group badge + status */}
          <div className="absolute top-3 left-3 flex gap-2 flex-wrap">
            {ageLabel && (
              <span className="inline-flex items-center bg-black/60 backdrop-blur-sm text-white text-xs font-bold px-2.5 py-1 rounded-full border border-white/10 uppercase">
                {ageLabel}
              </span>
            )}
            {program.status && (
              <span
                className={`inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-full border ${
                  program.status === "upcoming"
                    ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                    : program.status === "active"
                    ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                    : "bg-white/10 text-white/70 border-white/10"
                }`}
              >
                {program.status.toUpperCase()}
              </span>
            )}
          </div>

          {/* Price badge top-right */}
          <div className="absolute top-3 right-3">
            <span
              className={`inline-flex items-center backdrop-blur-sm ${cfg.priceTextClass} text-sm font-black px-3 py-1 rounded-full shadow-lg`}
              style={{ backgroundColor: `${cfg.secondary}e6` }}
            >
              {displayPrice ? `$${displayPrice}` : "Free"}
            </span>
          </div>
        </div>

        {/* Card body */}
        <div className="flex flex-col flex-1 p-5 gap-4">
          {/* Title (+ coach for camps) */}
          <div>
            <h3 className={`text-white font-bold text-lg leading-snug line-clamp-2 transition-colors ${cfg.titleHoverClass}`}>
              {program.name}
            </h3>
            {program.type === "camp" && program.coachName && (
              <p className="text-white/40 text-xs mt-1">Coach: {program.coachName}</p>
            )}
          </div>

          {/* Description */}
          <p className="text-white/45 text-sm leading-relaxed line-clamp-2 flex-1">
            {program.description || "Join this upcoming program at the Alumni Center. Competitive play for all skill levels."}
          </p>

          {/* Schedule / location row */}
          <div className="space-y-1.5">
            {dateText && (
              <div className="flex items-center gap-2 text-white/50 text-xs">
                <Calendar className="h-3.5 w-3.5 flex-shrink-0" style={{ color: cfg.accent }} />
                <span>{dateText}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-white/50 text-xs">
              <Users className="h-3.5 w-3.5 flex-shrink-0" style={{ color: cfg.accent }} />
              {(program.type === "drop_in" || program.type === "dropin") && program.poolCount
                ? <span>{program.poolCount} session{program.poolCount !== 1 ? "s" : ""} available</span>
                : <span>{spotsTaken} / {spotsTotal} Spots</span>
              }
            </div>
            <div className="flex items-center gap-2 text-white/50 text-xs">
              <MapPin className="h-3.5 w-3.5 flex-shrink-0" style={{ color: cfg.accent }} />
              <span>Alumni Center · Lexington, KY</span>
            </div>
          </div>

          {/* Spots progress bar */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <span className={`text-xs font-semibold ${almostFull ? "text-orange-400" : "text-white/50"}`}>
                {almostFull ? "⚡ Filling fast" : `${spotsAvailable} spots left`}
              </span>
              <span className="text-xs text-white/30">{spotsTaken}/{spotsTotal}</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${cfg.progressColorClass}`}
                style={{ width: `${fillPct}%` }}
              />
            </div>
          </div>

          {/* CTA */}
          <Link href={
            (program.type === "drop_in" || program.type === "dropin")
              ? program.isTemplate
                ? `/dropins/occ/${program.id}/${program.occurrenceDate}`
                : `/dropins/${program.id}`
              : `/${({ league: "leagues", camp: "camps", tournament: "tournaments" } as Record<string, string>)[program.type] ?? `${program.type}s`}/${program.id}`
          } className="block">
            <button
              className="w-full h-11 rounded-xl text-white font-semibold text-sm transition-all duration-200 flex items-center justify-center gap-2"
              style={{
                backgroundColor: isBtnHovered ? cfg.btnHoverBg : "rgba(255,255,255,0.05)",
                borderWidth: 1,
                borderStyle: "solid",
                borderColor: isBtnHovered ? cfg.btnHoverBorder : "rgba(255,255,255,0.10)",
              }}
              onMouseEnter={() => setIsBtnHovered(true)}
              onMouseLeave={() => setIsBtnHovered(false)}
            >
              View Details
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </button>
          </Link>
        </div>
      </div>
    </motion.div>
  );
}

const waysToPlay = [
  {
    href: "/leagues",
    icon: <Trophy className="h-8 w-8" />,
    label: "Leagues",
    tagline: "Compete every week",
    desc: "Competitive and recreational seasons for youth and adult divisions. 5v5 and 4v4 formats.",
    gradient: "from-[#7c1d1d] to-[#991b1b]",
    accent: "#ef4444",
    bg: "bg-[#1a0808]",
  },
  {
    href: "/camps",
    icon: <Users className="h-8 w-8" />,
    label: "Camps",
    tagline: "Level up your skills",
    desc: "Intensive skill development run by expert coaches. Perfect for youth players ready to elevate.",
    gradient: "from-[#1a3a5c] to-[#1e4976]",
    accent: "#60a5fa",
    bg: "bg-[#080f1a]",
  },
  {
    href: "/dropins",
    icon: <Activity className="h-8 w-8" />,
    label: "Drop-ins",
    tagline: "Show up and play",
    desc: "Organized pickup sessions with limited spots. Max playing time guaranteed, zero commitment needed.",
    gradient: "from-[#1a3a1a] to-[#1e4a1e]",
    accent: "#4ade80",
    bg: "bg-[#080f08]",
  },
  {
    href: "/tournaments",
    icon: <Calendar className="h-8 w-8" />,
    label: "Tournaments",
    tagline: "Win it all",
    desc: "Weekend shootouts and holiday tournaments. High stakes, intense competition, cash prizes on the line.",
    gradient: "from-[#3a2a06] to-[#4a3408]",
    accent: "#fbbf24",
    bg: "bg-[#100d02]",
  },
];

function WaysToPlaySection() {
  return (
    <section className="py-24 bg-[#f7f6f4]">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <p className="text-[#dc2626] text-sm font-bold uppercase tracking-widest mb-2">
            Find Your Fit
          </p>
          <h2 className="text-4xl font-black uppercase tracking-tight text-[#0a0a10]">
            Ways to Play
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {waysToPlay.map((item) => (
            <Link key={item.href} href={item.href} className="group block">
              <motion.div
                whileHover={{ y: -6, scale: 1.02 }}
                transition={{ type: "spring", stiffness: 300, damping: 22 }}
                className={`relative h-full rounded-2xl overflow-hidden ${item.bg} border border-white/5 shadow-xl`}
              >
                {/* Gradient top bar */}
                <div className={`h-1.5 w-full bg-gradient-to-r ${item.gradient}`} />

                <div className="p-6 space-y-4">
                  {/* Icon */}
                  <div
                    className="w-14 h-14 rounded-xl flex items-center justify-center"
                    style={{ background: `${item.accent}18`, color: item.accent }}
                  >
                    {item.icon}
                  </div>

                  {/* Text */}
                  <div>
                    <div className="flex items-baseline gap-2 mb-1">
                      <h3
                        className="font-black text-xl uppercase tracking-tight"
                        style={{ color: item.accent }}
                      >
                        {item.label}
                      </h3>
                    </div>
                    <p className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-3">
                      {item.tagline}
                    </p>
                    <p className="text-white/40 text-sm leading-relaxed">{item.desc}</p>
                  </div>

                  {/* Arrow CTA */}
                  <div
                    className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide group-hover:gap-2 transition-all"
                    style={{ color: item.accent }}
                  >
                    Explore <ArrowRight className="h-3.5 w-3.5" />
                  </div>
                </div>
              </motion.div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  const steps = [
    {
      step: "01",
      title: "Browse Programs",
      desc: "Explore upcoming leagues, camps, drop-ins, and tournaments. Filter by age group and format to find your fit.",
    },
    {
      step: "02",
      title: "Register & Pay",
      desc: "Create your free account, complete your profile, and secure your spot in seconds with our secure checkout.",
    },
    {
      step: "03",
      title: "Show Up & Play",
      desc: "Receive your schedule, manage your team, and check in on game day via QR code. We handle the rest.",
    },
  ];

  return (
    <section className="py-24 bg-[#0d0d15] relative overflow-hidden">
      {/* Subtle radial glow */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] pointer-events-none"
        style={{ background: "radial-gradient(ellipse, rgba(157,20,40,0.08) 0%, transparent 70%)" }}
      />

      <div className="container mx-auto px-4 relative z-10">
        <div className="text-center mb-16">
          <p className="text-[#ef4444] text-sm font-bold uppercase tracking-widest mb-2">
            Simple as 1-2-3
          </p>
          <h2 className="text-4xl font-black uppercase tracking-tight text-white mb-4">
            How It Works
          </h2>
          <p className="text-white/40 max-w-md mx-auto">
            Getting on the court takes three simple steps. No waitlists, no hidden fees.
          </p>
        </div>

        <div className="max-w-4xl mx-auto relative">
          {/* Connector line */}
          <div className="hidden md:block absolute top-8 left-[calc(16.67%+2rem)] right-[calc(16.67%+2rem)] h-px bg-gradient-to-r from-transparent via-[#dc2626]/30 to-transparent" />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-6">
            {steps.map(({ step, title, desc }, i) => (
              <motion.div
                key={step}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.12, duration: 0.5 }}
                className="flex flex-col items-center text-center gap-5"
              >
                {/* Step circle */}
                <div className="relative">
                  <div className="w-16 h-16 rounded-full bg-[#dc2626]/10 border border-[#dc2626]/30 flex items-center justify-center shadow-[0_0_24px_rgba(220,38,38,0.15)]">
                    <span className="text-[#ef4444] font-black text-xl">{step}</span>
                  </div>
                </div>

                <div>
                  <h3 className="font-bold text-lg uppercase tracking-tight text-white mb-2">
                    {title}
                  </h3>
                  <p className="text-white/40 text-sm leading-relaxed">{desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function StatsSection() {
  const stats = [
    { value: "2", label: "Dedicated Courts", sub: "at the Alumni Center" },
    { value: "4", label: "Program Types", sub: "leagues, camps, drop-ins, tournaments" },
    { value: "Youth & Adults", label: "Age Groups", sub: "something for everyone" },
    { value: "Lexington", label: "Location", sub: "Alumni Center, KY" },
  ];

  return (
    <section className="py-20 bg-[#f7f6f4] border-y border-black/5">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {stats.map(({ value, label, sub }) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
            >
              <p className="text-4xl md:text-5xl font-black text-[#dc2626] leading-none mb-1">
                {value}
              </p>
              <p className="text-sm font-bold uppercase tracking-wide text-[#0a0a10] mt-2">
                {label}
              </p>
              <p className="text-xs text-black/40 mt-1">{sub}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ReferralBanner() {
  return (
    <section className="py-16 bg-[#0a0a10]">
      <div className="container mx-auto px-4">
        <div className="relative rounded-2xl overflow-hidden border border-[#dc2626]/20 bg-gradient-to-br from-[#1a0808] to-[#0a0a10] p-8 md:p-12 flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Glow accent */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: "radial-gradient(ellipse at 20% 50%, rgba(220,38,38,0.08) 0%, transparent 60%)" }}
          />

          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-2">
              <Star className="h-4 w-4 text-[#ef4444]" />
              <p className="text-[#ef4444] text-xs font-bold uppercase tracking-widest">
                Refer & Earn
              </p>
            </div>
            <h3 className="text-2xl font-black uppercase tracking-tight text-white mb-2">
              Refer a Friend, Earn Credit
            </h3>
            <p className="text-white/40 max-w-md">
              Share PlayOn with teammates and parents. Earn account credit for every successful signup through your link.
            </p>
          </div>
          <div className="relative z-10 flex-shrink-0">
            <Button
              size="lg"
              className="rounded-full px-8 bg-[#dc2626] border-[#b91c1c] text-white hover:bg-[#b91c1c] font-bold shadow-[0_0_20px_rgba(220,38,38,0.3)]"
              asChild
            >
              <Link href="/referrals">Get Your Link</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function CtaSection() {
  return (
    <section className="py-28 bg-[#dc2626] relative overflow-hidden">
      {/* Texture */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.06]"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <pattern id="cta-dots" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="12" cy="12" r="1.5" fill="white" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#cta-dots)" />
      </svg>

      {/* Bloom */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] pointer-events-none"
        style={{ background: "radial-gradient(ellipse, rgba(255,255,255,0.12) 0%, transparent 70%)" }}
      />

      <div className="container mx-auto px-4 text-center max-w-3xl relative z-10">
        <h2 className="text-5xl font-black uppercase tracking-tight text-white mb-6 leading-tight">
          Ready to hit<br />the court?
        </h2>
        <p className="text-white/70 text-lg mb-10 max-w-xl mx-auto">
          Create an account to register for leagues, manage your team, and track your schedule all in one place.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button
            size="lg"
            className="text-lg h-14 px-10 rounded-full bg-white text-[#dc2626] border-white hover:bg-white/90 font-black"
            asChild
          >
            <Link href="/sign-up">Create Free Account</Link>
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="hidden text-lg h-14 px-10 rounded-full border-white/30 text-white bg-white/5 hover:bg-white/10 font-semibold"
            asChild
          >
            <a href="/api/docs" target="_blank" rel="noopener noreferrer">
              API Docs
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}
