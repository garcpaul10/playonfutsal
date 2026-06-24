import React from "react";
import { motion } from "framer-motion";

// ─── PageHero ─────────────────────────────────────────────────────────────────
// Full-bleed dark hero section shared across all public listing pages.

type GlowPosition = "left" | "center" | "right";
type CourtPattern = "court-grid" | "horizontal-lines" | "grid-lines" | "diagonal" | "circles" | "none";

export interface PageHeroProps {
  eyebrow: React.ReactNode;
  eyebrowColor?: string;
  title: string;
  subtitle: string;
  glowColor?: string;
  glowPosition?: GlowPosition;
  pattern?: CourtPattern;
  patternId?: string;
  bottomColor?: string;
  centered?: boolean;
}

function CourtPatternSvg({ type, id }: { type: CourtPattern; id: string }) {
  if (type === "none") return null;

  const baseProps = {
    className: "absolute inset-0 w-full h-full pointer-events-none opacity-[0.03]",
    preserveAspectRatio: "xMidYMid slice" as const,
  };

  if (type === "court-grid") {
    return (
      <svg {...baseProps}>
        <defs>
          <pattern id={id} x="0" y="0" width="100" height="100" patternUnits="userSpaceOnUse">
            <path d="M0 50 H100 M50 0 V100" stroke="white" strokeWidth="1" />
            <circle cx="50" cy="50" r="30" stroke="white" strokeWidth="1" fill="none" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${id})`} />
      </svg>
    );
  }

  if (type === "horizontal-lines") {
    return (
      <svg {...baseProps}>
        <defs>
          <pattern id={id} x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
            <path d="M0 40 H80 M40 0 V80" stroke="white" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${id})`} />
      </svg>
    );
  }

  if (type === "grid-lines") {
    return (
      <svg {...baseProps}>
        <defs>
          <pattern id={id} x="0" y="0" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M0 30 H60 M30 0 V60" stroke="white" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${id})`} />
      </svg>
    );
  }

  if (type === "diagonal") {
    return (
      <svg {...baseProps}>
        <defs>
          <pattern id={id} x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
            <path d="M0 0 L80 80 M80 0 L0 80" stroke="white" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${id})`} />
      </svg>
    );
  }

  if (type === "circles") {
    return (
      <svg {...baseProps}>
        <defs>
          <pattern id={id} x="0" y="0" width="60" height="60" patternUnits="userSpaceOnUse">
            <circle cx="30" cy="30" r="20" stroke="white" strokeWidth="1" fill="none" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${id})`} />
      </svg>
    );
  }

  return null;
}

export function PageHero({
  eyebrow,
  eyebrowColor = "#ef4444",
  title,
  subtitle,
  glowColor = "rgba(157,20,40,0.18)",
  glowPosition = "left",
  pattern = "court-grid",
  patternId = "hero-pattern",
  bottomColor = "#0a0a10",
  centered = false,
}: PageHeroProps) {
  const glowPositionStyle: React.CSSProperties = {
    position: "absolute",
    top: 0,
    width: 600,
    height: 400,
    borderRadius: "50%",
    pointerEvents: "none",
    background: `radial-gradient(ellipse, ${glowColor} 0%, transparent 70%)`,
    filter: "blur(60px)",
    ...(glowPosition === "left" && { left: "25%" }),
    ...(glowPosition === "center" && { left: "50%", transform: "translateX(-50%)" }),
    ...(glowPosition === "right" && { right: "25%" }),
  };

  return (
    <div className="relative bg-[#050508] pt-32 pb-20 overflow-hidden">
      <div style={glowPositionStyle} />
      {pattern !== "none" && <CourtPatternSvg type={pattern} id={patternId} />}
      <div className={`container mx-auto px-4 relative z-10 ${centered ? "text-center" : ""}`}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <p
            className="text-xs font-bold uppercase tracking-widest mb-3 flex items-center gap-2"
            style={{ color: eyebrowColor, justifyContent: centered ? "center" : "flex-start" }}
          >
            {eyebrow}
          </p>
          <h1 className="text-5xl md:text-7xl font-black uppercase tracking-tight text-white leading-none mb-4">
            {title}
          </h1>
          <p className={`text-white/50 text-lg ${centered ? "max-w-xl mx-auto" : "max-w-2xl"}`}>
            {subtitle}
          </p>
        </motion.div>
      </div>
      <div
        className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none"
        style={{ background: `linear-gradient(to top, ${bottomColor}, transparent)` }}
      />
    </div>
  );
}

// ─── SectionEntry ─────────────────────────────────────────────────────────────
// whileInView entrance animation wrapper for content sections.
// Use this around every major section block on detail and listing pages.

export interface SectionEntryProps {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  direction?: "up" | "left" | "right";
}

export function SectionEntry({
  children,
  delay = 0,
  className,
  direction = "up",
}: SectionEntryProps) {
  const initial =
    direction === "left"
      ? { opacity: 0, x: -24 }
      : direction === "right"
      ? { opacity: 0, x: 24 }
      : { opacity: 0, y: 24 };

  const animate =
    direction === "left" || direction === "right"
      ? { opacity: 1, x: 0 }
      : { opacity: 1, y: 0 };

  return (
    <motion.div
      initial={initial}
      whileInView={animate}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ─── DarkCard ─────────────────────────────────────────────────────────────────
// Standard dark glass card surface used across all branded pages.

export interface DarkCardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
}

export function DarkCard({ children, className = "", hover = false }: DarkCardProps) {
  return (
    <div
      className={[
        "rounded-2xl border border-white/10 bg-[#111118]",
        "shadow-[0_8px_32px_rgba(0,0,0,0.6)]",
        hover &&
          "hover:shadow-[0_16px_48px_rgba(0,0,0,0.8),0_0_0_1px_rgba(255,255,255,0.05)] hover:border-white/20 transition-all duration-300",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}

// ─── DarkCardHeader ───────────────────────────────────────────────────────────
export function DarkCardHeader({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white/5 border-b border-white/10 px-5 py-4 ${className}`}>
      {children}
    </div>
  );
}
