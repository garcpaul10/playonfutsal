import { API_BASE } from "@/lib/api-base";
import React, { useEffect, useState } from "react";
import { useUser } from "@clerk/react";
import { useGetMyProfile } from "@workspace/api-client-react";
import { useParticipantProfile } from "@/components/waiver-modal";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { Sun, Moon, ArrowLeft, CheckCircle2, ChevronDown } from "lucide-react";
import QRCode from "qrcode";


type WalletStatus = "idle" | "loading" | "unavailable";

type GuardianLink = {
  id: number;
  youthUserId: number;
  relationship: string;
  status: string;
  youthFirstName: string | null;
  youthLastName: string | null;
  youthQrCode: string | null;
  youthPlayonId: string | null;
};

type Profile = {
  label: string;
  displayName: string;
  initials: string;
  playonId: string;
  qrCode: string | null;
};

function useGuardianLinks() {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ["guardian-links"],
    queryFn: async () => {
      const token = await getToken();
      const r = await fetch(`${API_BASE}/me/guardian-links`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return [] as GuardianLink[];
      return r.json() as Promise<GuardianLink[]>;
    },
  });
}

export default function ProfileQR() {
  const { user } = useUser();
  const { data: profile } = useGetMyProfile();
  const { data: playerProfile } = useParticipantProfile();
  const { data: guardianLinks = [] } = useGuardianLinks();

  const [brightness, setBrightness] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [appleStatus, setAppleStatus] = useState<WalletStatus>("idle");
  const [googleStatus, setGoogleStatus] = useState<WalletStatus>("idle");
  const [selectedIdx, setSelectedIdx] = useState(0);

  // Build the list of selectable profiles: own first, then each child
  const selfDisplayName =
    [profile?.firstName ?? user?.firstName, profile?.lastName ?? user?.lastName]
      .filter(Boolean)
      .join(" ") ||
    user?.emailAddresses?.[0]?.emailAddress ||
    "Me";

  const selfInitials =
    [(profile?.firstName ?? user?.firstName)?.[0], (profile?.lastName ?? user?.lastName)?.[0]]
      .filter(Boolean)
      .join("")
      .toUpperCase() || "P";

  const profiles: Profile[] = [
    {
      label: "My QR",
      displayName: selfDisplayName,
      initials: selfInitials,
      playonId: (profile as any)?.playonId ?? "Pending",
      qrCode: playerProfile?.qrCode ?? null,
    },
    ...guardianLinks
      .filter((l) => l.status === "approved" && l.youthQrCode)
      .map((l) => ({
        label: `${l.youthFirstName ?? "Child"}'s QR`,
        displayName: [l.youthFirstName, l.youthLastName].filter(Boolean).join(" ") || "Child",
        initials: [l.youthFirstName?.[0], l.youthLastName?.[0]].filter(Boolean).join("").toUpperCase() || "C",
        playonId: l.youthPlayonId ?? "Pending",
        qrCode: l.youthQrCode,
      })),
  ];

  const safeIdx = Math.min(selectedIdx, profiles.length - 1);
  const active = profiles[safeIdx];
  const hasQrCode = !!active?.qrCode;

  useEffect(() => {
    if (!active?.qrCode) {
      setQrDataUrl("");
      return;
    }
    QRCode.toDataURL(active.qrCode, {
      width: 220,
      margin: 2,
      color: { dark: "#1E2829", light: "#FFFFFF" },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [active?.qrCode]);

  async function handleAppleWallet() {
    setAppleStatus("loading");
    try {
      const r = await fetch(`${API_BASE}/me/wallet/apple`, { credentials: "include" });
      if (r.status === 503) { setAppleStatus("unavailable"); return; }
      if (!r.ok) throw new Error("failed");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "playon-pass.pkpass";
      a.click();
      URL.revokeObjectURL(url);
      setAppleStatus("idle");
    } catch {
      setAppleStatus("unavailable");
    }
  }

  async function handleGoogleWallet() {
    setGoogleStatus("loading");
    try {
      const r = await fetch(`${API_BASE}/me/wallet/google`, { credentials: "include" });
      if (r.status === 503) { setGoogleStatus("unavailable"); return; }
      if (!r.ok) throw new Error("failed");
      const { saveUrl } = await r.json();
      window.open(saveUrl, "_blank", "noopener,noreferrer");
      setGoogleStatus("idle");
    } catch {
      setGoogleStatus("unavailable");
    }
  }

  const dark = !brightness;

  return (
    <Layout>
      <div
        className={`min-h-screen transition-colors duration-200 ${dark ? "bg-[#1E2829]" : "bg-white"}`}
        style={{ margin: "-1.5rem", padding: "1.5rem" }}
      >
        <div className="max-w-sm mx-auto">
          {/* Header row */}
          <div className="flex items-center justify-between mb-8 pt-2">
            <Link href="/profile">
              <button
                className={`flex items-center gap-1.5 text-sm font-medium transition-opacity hover:opacity-70 ${
                  dark ? "text-[#99a1a3]" : "text-[#585E5E]"
                }`}
              >
                <ArrowLeft className="h-4 w-4" />
                Profile
              </button>
            </Link>
            <h1 className={`text-lg font-bold ${dark ? "text-white" : "text-[#1E2829]"}`}>
              My PlayOn ID
            </h1>
            <button
              onClick={() => setBrightness((b) => !b)}
              className={`p-2 rounded-full transition-opacity hover:opacity-70 ${
                dark ? "text-[#99a1a3]" : "text-[#585E5E]"
              }`}
              aria-label="Toggle brightness"
            >
              {brightness ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
          </div>

          {/* Profile selector — shown when parent has linked children */}
          {profiles.length > 1 && (
            <div className="mb-5">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {profiles.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedIdx(i)}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      i === safeIdx
                        ? "bg-primary text-primary-foreground"
                        : dark
                          ? "bg-[#2b353a] text-[#99a1a3] hover:text-white"
                          : "bg-gray-100 text-[#585E5E] hover:text-[#1E2829]"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Avatar + name + PlayOn ID */}
          <div className="flex flex-col items-center mb-6">
            <div
              className="flex items-center justify-center rounded-full bg-primary mb-3 shrink-0"
              style={{ width: 72, height: 72 }}
            >
              <span className="text-white text-2xl font-bold">{active?.initials ?? "P"}</span>
            </div>
            <h2 className={`text-xl font-bold text-center ${dark ? "text-white" : "text-[#1E2829]"}`}>
              {active?.displayName ?? "Player"}
            </h2>
            <p className={`text-sm mt-1 ${dark ? "text-[#99a1a3]" : "text-[#585E5E]"}`}>
              ID: {active?.playonId ?? "Pending"}
            </p>
          </div>

          {/* QR card — or CTA if no profile yet */}
          {hasQrCode ? (
            <>
              <div
                className={`rounded-2xl border p-6 flex items-center justify-center mb-4 ${
                  dark ? "bg-[#222E2E] border-[#2b353a]" : "bg-white border-[#E0DADA]"
                }`}
              >
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="PlayOn player QR code"
                    className="w-[220px] h-[220px]"
                    style={{ imageRendering: "pixelated" }}
                  />
                ) : (
                  <div className="w-[220px] h-[220px] flex items-center justify-center">
                    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
              </div>

              <p className={`text-sm text-center mb-6 ${dark ? "text-[#99a1a3]" : "text-[#585E5E]"}`}>
                Show this to check in at any PlayOn event
              </p>

              {/* Event types strip */}
              <div
                className={`flex items-center w-full rounded-xl border px-2 py-3 mb-6 ${
                  dark
                    ? "bg-primary/15 border-primary/30"
                    : "bg-primary/10 border-primary/20"
                }`}
              >
                {["Leagues", "Camps", "Drop-ins", "Tournaments"].map((label, i) => (
                  <React.Fragment key={label}>
                    {i > 0 && (
                      <div
                        className="h-6 w-px mx-1 shrink-0"
                        style={{ backgroundColor: dark ? "color-mix(in srgb, var(--brand-crimson-700) 40%, transparent)" : "color-mix(in srgb, var(--brand-crimson-700) 25%, transparent)" }}
                      />
                    )}
                    <div className="flex-1 flex flex-col items-center gap-1">
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                      <span
                        className={`text-[11px] font-medium ${dark ? "text-white" : "text-[#1E2829]"}`}
                      >
                        {label}
                      </span>
                    </div>
                  </React.Fragment>
                ))}
              </div>

              {/* Wallet buttons — only for own profile */}
              {safeIdx === 0 && (
                <div className="flex flex-col gap-3">
                  <AppleWalletButton status={appleStatus} onClick={handleAppleWallet} dark={dark} />
                  <GoogleWalletButton status={googleStatus} onClick={handleGoogleWallet} />
                </div>
              )}
            </>
          ) : (
            /* No participant profile yet — prompt to complete profile */
            <div
              className={`rounded-2xl border p-8 flex flex-col items-center text-center mb-6 ${
                dark ? "bg-[#222E2E] border-[#2b353a]" : "bg-white border-[#E0DADA]"
              }`}
            >
              <div className="w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center mb-4">
                <ChevronDown className="h-8 w-8 text-primary" />
              </div>
              <h3 className={`text-lg font-bold mb-2 ${dark ? "text-white" : "text-[#1E2829]"}`}>
                QR code not ready yet
              </h3>
              <p className={`text-sm mb-5 ${dark ? "text-[#99a1a3]" : "text-[#585E5E]"}`}>
                Your participant profile hasn't been created yet. Register for a league, camp, or drop-in and you'll be prompted to complete your profile — your QR code will appear here.
              </p>
              <Link href="/dashboard">
                <button className="px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/85 transition-colors">
                  Browse programs
                </button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

function AppleWalletButton({ status, onClick, dark }: { status: WalletStatus; onClick: () => void; dark: boolean }) {
  if (status === "unavailable") {
    return (
      <div className="flex items-center justify-center gap-2 w-full rounded-xl py-3 px-4 text-sm font-medium bg-muted/30 text-muted-foreground border border-border cursor-not-allowed">
        <AppleLogo className="h-5 w-5 opacity-40" />
        Apple Wallet — Not configured
      </div>
    );
  }
  return (
    <button
      onClick={onClick}
      disabled={status === "loading"}
      className={`
        flex items-center justify-center gap-2 w-full rounded-xl py-3 px-4 font-semibold text-sm
        transition-all active:scale-95 disabled:opacity-70
        ${dark ? "bg-white text-black hover:bg-gray-100" : "bg-black text-white hover:bg-gray-900"}
      `}
    >
      {status === "loading" ? (
        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : (
        <AppleLogo className="h-5 w-5 fill-current" />
      )}
      Add to Apple Wallet
    </button>
  );
}

function GoogleWalletButton({ status, onClick }: { status: WalletStatus; onClick: () => void }) {
  if (status === "unavailable") {
    return (
      <div className="flex items-center justify-center gap-2 w-full rounded-xl py-3 px-4 text-sm font-medium bg-muted/30 text-muted-foreground border border-border cursor-not-allowed">
        <GoogleWalletLogo className="h-5 w-5 opacity-40" />
        Google Wallet — Not configured
      </div>
    );
  }
  return (
    <button
      onClick={onClick}
      disabled={status === "loading"}
      className="flex items-center justify-center gap-2 w-full rounded-xl py-3 px-4 font-semibold text-sm bg-[#4285F4] text-white hover:bg-[#3b78e7] transition-all active:scale-95 disabled:opacity-70"
    >
      {status === "loading" ? (
        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
      ) : (
        <GoogleWalletLogo className="h-5 w-5" />
      )}
      Add to Google Wallet
    </button>
  );
}

function AppleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

function GoogleWalletLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="5" width="20" height="14" rx="2" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 9h20" stroke="currentColor" strokeWidth="1.5" />
      <rect x="5" y="13" width="5" height="2" rx="1" fill="currentColor" />
    </svg>
  );
}
