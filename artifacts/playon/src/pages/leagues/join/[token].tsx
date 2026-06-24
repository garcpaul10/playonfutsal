import React, { useState } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, AlertCircle, Users, Shield, Loader2, ChevronLeft } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth, Show } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";

const API = "/api";

function useAuthHeaders() {
  const { getToken } = useAuth();
  return async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  };
}

const FUTSAL_POSITIONS = ["Goalkeeper", "Defender", "Midfielder", "Attacker", "Utility"];
const SKILL_LEVELS = [
  { value: "beginner", label: "Beginner", desc: "Just starting out" },
  { value: "intermediate", label: "Intermediate", desc: "Regular recreational player" },
  { value: "competitive", label: "Competitive", desc: "Experienced / tournament player" },
];
const SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL"];

export default function LeagueJoin() {
  const [, params] = useRoute("/leagues/join/:token");
  const token = params?.token ?? "";
  const [, navigate] = useLocation();
  const { getToken, isSignedIn } = useAuth();
  const { toast } = useToast();
  const getHeaders = useAuthHeaders();

  const [positions, setPositions] = useState<string[]>([]);
  const [skillLevel, setSkillLevel] = useState("intermediate");
  const [shirtSize, setShirtSize] = useState("M");
  const [waiverChecked, setWaiverChecked] = useState(false);
  const [done, setDone] = useState<{ teamName: string; leagueName: string | null } | null>(null);

  const { data: invite, isLoading, error } = useQuery({
    queryKey: ["league-invite", token],
    queryFn: async () => {
      const r = await fetch(`${API}/leagues/join/${token}`);
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Invalid link" }));
        throw new Error(err.error ?? "Invalid or expired invite link");
      }
      return r.json();
    },
    enabled: !!token,
    retry: false,
  });

  const togglePosition = (pos: string) =>
    setPositions((prev) => prev.includes(pos) ? prev.filter((p) => p !== pos) : [...prev, pos]);

  const join = useMutation({
    mutationFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/leagues/join/${token}`, {
        method: "POST", headers,
        body: JSON.stringify({ positions, skillLevel, shirtSize }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Failed to join" }));
        throw new Error(err.error ?? "Failed to join team");
      }
      return r.json();
    },
    onSuccess: (data) => {
      setDone({ teamName: data.teamName ?? invite?.teamName, leagueName: data.leagueName ?? invite?.leagueName });
      toast({ title: "Welcome to the team! 🎉" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <Layout>
        <div className="bg-[#050508] min-h-screen flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-white/30" />
        </div>
      </Layout>
    );
  }

  if (error || !invite) {
    return (
      <Layout>
        <div className="dark bg-[#050508] min-h-screen flex items-center justify-center px-4">
          <div className="text-center max-w-sm">
            <AlertCircle className="h-16 w-16 text-red-400/50 mx-auto mb-4" />
            <h1 className="text-2xl font-black text-white mb-2">Invalid Invite</h1>
            <p className="text-white/50 mb-6">{(error as Error)?.message ?? "This invite link is no longer valid or has expired."}</p>
            <Button asChild className="bg-[#dc2626] hover:bg-[#b91c1c] border-none">
              <Link href="/leagues">Browse Leagues</Link>
            </Button>
          </div>
        </div>
      </Layout>
    );
  }

  if (done) {
    return (
      <Layout>
        <div className="dark bg-[#050508] min-h-screen flex items-center justify-center px-4">
          <div className="text-center max-w-sm">
            <div className="h-20 w-20 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="h-10 w-10 text-emerald-400" />
            </div>
            <h1 className="text-3xl font-black text-white mb-2 uppercase">You're In!</h1>
            <p className="text-white/60 mb-1">
              You've joined <span className="text-white font-semibold">{done.teamName}</span>
            </p>
            {done.leagueName && (
              <p className="text-white/40 text-sm mb-6">in {done.leagueName}</p>
            )}
            <div className="flex gap-3 justify-center">
              <Button asChild className="bg-[#dc2626] hover:bg-[#b91c1c] border-none">
                <Link href="/dashboard">Go to Dashboard</Link>
              </Button>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="dark bg-[#050508] text-white min-h-screen">
        <div className="relative h-40 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[#0a0005] via-[#1a0a10] to-[#2d0d1a]" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#050508] to-transparent" />
          <div className="absolute inset-0 z-10 flex flex-col justify-end pb-6">
            <div className="container mx-auto px-4">
              <Button variant="outline" size="sm" className="mb-3 bg-white/10 hover:bg-white/20 border-white/20 text-white backdrop-blur" asChild>
                <Link href="/leagues"><ChevronLeft className="mr-1 h-4 w-4" /> Leagues</Link>
              </Button>
              <p className="text-xs text-white/40 uppercase tracking-widest font-bold">Team Invite</p>
              <h1 className="text-2xl font-black text-white uppercase tracking-tight">{invite.teamName}</h1>
              {invite.leagueName && <p className="text-white/50 text-sm">{invite.leagueName}</p>}
            </div>
          </div>
        </div>

        <div className="container mx-auto px-4 py-8 max-w-lg">
          <div className="bg-[#111118] border border-white/10 rounded-2xl overflow-hidden">
            <div className="bg-white/5 border-b border-white/10 px-5 py-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-[#dc2626]/20 border border-[#dc2626]/30 flex items-center justify-center">
                <Shield className="h-5 w-5 text-[#ef4444]" />
              </div>
              <div>
                <p className="font-semibold text-white">Join {invite.teamName}</p>
                <p className="text-xs text-white/40">Fill in your player details to complete registration</p>
              </div>
            </div>

            <div className="p-5 space-y-6">
              <Show when="signed-out">
                <div className="text-center space-y-3 py-4">
                  <Users className="h-12 w-12 text-white/20 mx-auto" />
                  <p className="text-white/60">Sign in or create an account to join this team.</p>
                  <Button className="w-full bg-[#dc2626] hover:bg-[#b91c1c] border-none" asChild>
                    <Link href={`/sign-in?redirect_url=/leagues/join/${token}`}>Sign In to Continue</Link>
                  </Button>
                  <Button variant="outline" className="w-full border-white/20 text-white hover:bg-white/10" asChild>
                    <Link href={`/sign-up?redirect_url=/leagues/join/${token}`}>Create Account</Link>
                  </Button>
                </div>
              </Show>

              <Show when="signed-in">
                <div className="space-y-6">
                  <div>
                    <Label className="text-xs text-white/50 mb-2 block">Positions you can play *</Label>
                    <div className="flex flex-wrap gap-2">
                      {FUTSAL_POSITIONS.map((pos) => (
                        <button key={pos} type="button"
                          className={`text-sm px-3 py-1.5 rounded-full border font-medium transition-all ${positions.includes(pos) ? "bg-[#dc2626] border-[#dc2626] text-white" : "bg-white/5 border-white/10 text-white/50 hover:border-white/30"}`}
                          onClick={() => togglePosition(pos)}>
                          {pos}
                        </button>
                      ))}
                    </div>
                    {positions.length === 0 && (
                      <p className="text-xs text-amber-400/70 mt-1.5">Select at least one position</p>
                    )}
                  </div>

                  <div>
                    <Label className="text-xs text-white/50 mb-2 block">Skill Level</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {SKILL_LEVELS.map((sl) => (
                        <button key={sl.value} type="button"
                          className={`text-left p-2.5 rounded-xl border transition-all ${skillLevel === sl.value ? "bg-[#dc2626]/20 border-[#dc2626] text-white" : "bg-white/5 border-white/10 text-white/50 hover:border-white/30"}`}
                          onClick={() => setSkillLevel(sl.value)}>
                          <div className="text-xs font-semibold">{sl.label}</div>
                          <div className="text-xs opacity-60 mt-0.5 leading-tight">{sl.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs text-white/50">T-Shirt Size</Label>
                    <div className="flex gap-2 mt-1.5 flex-wrap">
                      {SHIRT_SIZES.map((s) => (
                        <button key={s} type="button"
                          className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${shirtSize === s ? "bg-[#dc2626] border-[#dc2626] text-white" : "bg-white/5 border-white/10 text-white/50 hover:border-white/30"}`}
                          onClick={() => setShirtSize(s)}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="flex items-start gap-2.5 cursor-pointer bg-white/5 border border-white/10 rounded-xl p-4">
                    <input type="checkbox" className="mt-0.5 accent-[#dc2626] shrink-0" checked={waiverChecked} onChange={(e) => setWaiverChecked(e.target.checked)} />
                    <span className="text-sm text-white/70 leading-relaxed">
                      I confirm I have read and agree to the{" "}
                      <span className="text-[#ef4444] underline cursor-pointer">liability waiver</span>
                      {" "}and understand the risks associated with futsal.
                    </span>
                  </label>

                  <Button
                    className="w-full h-12 text-base font-semibold bg-[#dc2626] hover:bg-[#b91c1c] border-none"
                    disabled={!waiverChecked || positions.length === 0 || join.isPending}
                    onClick={() => join.mutate()}
                  >
                    {join.isPending ? (
                      <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Joining…</>
                    ) : (
                      <>Join {invite.teamName}</>
                    )}
                  </Button>

                  {invite.usedAt && (
                    <p className="text-xs text-center text-amber-400">This link was already used once — multi-use links allow multiple players to join the same team.</p>
                  )}
                </div>
              </Show>
            </div>
          </div>

          <p className="text-center text-xs text-white/20 mt-6">
            This invite link expires {invite.expiresAt ? new Date(invite.expiresAt).toLocaleDateString() : "soon"}.
          </p>
        </div>
      </div>
    </Layout>
  );
}
