import { API_BASE } from "@/lib/api-base";
import React, { useEffect, useRef, useState } from "react";
import { useAuth, useUser, Show } from "@clerk/react";
import { useGetMyProfile, useUpdateMyProfile } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";
import {
  User, QrCode, Bell, Crown, CheckCircle2, CalendarClock,
  DollarSign, ClipboardList, AlertTriangle, Loader2, History,
  Trophy, Tent, Users, Zap, ChevronRight, ChevronLeft, Clock,
  ShieldCheck, ShieldOff,
} from "lucide-react";
import QRCodeLib from "qrcode";


type Tab = "profile" | "qr" | "notifications" | "history";

interface NotifPref {
  notificationType: string;
  label: string;
  channelEmail: boolean;
  channelSms: boolean;
  channelPush: boolean;
}

const SMS_IMPORTANT = ["waitlist_movement", "cancellation_rainout", "payment_receipt", "schedule_change"];

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  return /iP(hone|od|ad)/.test(ua) && /WebKit/.test(ua) && !/CriOS|FxiOS|OPiOS/.test(ua);
}
function isInStandaloneMode(): boolean {
  return (
    ("standalone" in window.navigator && (window.navigator as any).standalone === true) ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function useCountdown(expiresAt: string | null | undefined): string | null {
  const [remaining, setRemaining] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (!expiresAt) { setRemaining(null); return; }
    const target = new Date(expiresAt).getTime();
    const tick = () => setRemaining(Math.max(0, Math.floor((target - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  if (remaining === null) return null;
  if (remaining <= 0) return "Expired";
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

function PendingSpotCard({ spot }: { spot: any }) {
  const countdown = useCountdown(spot.expiresAt);
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
      <div className="flex items-start gap-3">
        <Clock className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-100 leading-tight">
            Payment pending: {spot.dropinName ?? "Drop-In Session"}
          </p>
          <p className="text-xs text-amber-300/80 mt-0.5 leading-snug">
            {countdown && countdown !== "Expired"
              ? `This spot will be released if payment isn't made in ${countdown}.`
              : countdown === "Expired"
              ? "Payment window expired — this spot will be released shortly."
              : "Complete payment to secure your drop-in spot."}
          </p>
        </div>
        {spot.entityId && (
          <Link href={`/dropins/${spot.entityId}`}>
            <Button size="sm" variant="outline" className="shrink-0 text-xs h-7 border-amber-500/40 text-amber-200 hover:bg-amber-500/20 hover:text-amber-100">
              Complete Payment
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}

function PendingDropinSpots() {
  const { getToken } = useAuth();
  const { data: pendingSpots } = useQuery({
    queryKey: ["pending-dropin-spots"],
    queryFn: async () => {
      const token = await getToken();
      const r = await fetch(`${API_BASE}/me/pending-dropin-spots`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return [] as any[];
      return r.json() as Promise<any[]>;
    },
    refetchInterval: 30_000,
  });
  if (!pendingSpots || pendingSpots.length === 0) return null;
  return (
    <div className="mb-6 space-y-2">
      {pendingSpots.map((spot: any) => (
        <PendingSpotCard key={spot.spotId} spot={spot} />
      ))}
    </div>
  );
}

function ProfileSection() {
  const { data: profile, isLoading } = useGetMyProfile();
  const updateProfile = useUpdateMyProfile();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useUser();

  const { data: membership } = useQuery({
    queryKey: ["memberships", "my"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/memberships/my`, { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
  });

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    gender: "",
    phone: "",
    addressLine1: "",
    city: "",
    state: "",
    zip: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
  });

  const initializedRef = useRef(false);
  useEffect(() => {
    if (profile && !initializedRef.current) {
      setFormData({
        firstName: profile.firstName || "",
        lastName: profile.lastName || "",
        dateOfBirth: profile.dateOfBirth ? profile.dateOfBirth.split("T")[0] : "",
        gender: (profile as any).gender || "",
        phone: profile.phone || "",
        addressLine1: profile.addressLine1 || "",
        city: profile.city || "",
        state: profile.state || "",
        zip: profile.zip || "",
        emergencyContactName: profile.emergencyContactName || "",
        emergencyContactPhone: profile.emergencyContactPhone || "",
      });
      initializedRef.current = true;
    }
  }, [profile]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload: any = {
        firstName: formData.firstName,
        lastName: formData.lastName,
        phone: formData.phone,
        dateOfBirth: formData.dateOfBirth || null,
        gender: formData.gender || null,
        addressLine1: formData.addressLine1 || null,
        city: formData.city || null,
        state: formData.state || null,
        zip: formData.zip || null,
        emergencyContactName: formData.emergencyContactName || null,
        emergencyContactPhone: formData.emergencyContactPhone || null,
      };
      await updateProfile.mutateAsync({ data: payload });
      await queryClient.invalidateQueries({ queryKey: ["/api/me"] });
      initializedRef.current = false;
      toast({ title: "Profile updated" });
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    }
  };

  if (isLoading) return <div className="space-y-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>;

  const roles: string[] = (profile as any)?.roles ?? [];
  const idVerified: boolean = (profile as any)?.idVerified ?? false;
  const idVerifiedAt: string | null = (profile as any)?.idVerifiedAt ?? null;

  return (
    <div className="space-y-6">
      {/* Avatar + identity */}
      <div className="flex items-center gap-4">
        <Avatar className="h-16 w-16">
          <AvatarImage src={user?.imageUrl} alt={[profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || ""} />
          <AvatarFallback className="text-xl">{profile?.firstName?.charAt(0)}{profile?.lastName?.charAt(0)}</AvatarFallback>
        </Avatar>
        <div>
          <p className="font-bold text-lg text-foreground">{[profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || "—"}</p>
          <p className="text-sm text-muted-foreground">{user?.primaryEmailAddress?.emailAddress}</p>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {roles.map((r) => (
              <Badge key={r} variant="outline" className="text-[10px] capitalize">{r}</Badge>
            ))}
          </div>
        </div>
      </div>

      {/* Membership badge */}
      {membership && (
        <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-xl p-4">
          <Crown className="h-5 w-5 text-primary shrink-0" />
          <div>
            <p className="font-semibold text-sm">{membership.planName} Member</p>
            <p className="text-xs text-muted-foreground">
              {membership.status === "active" ? (
                <span className="flex items-center gap-1 text-green-500"><CheckCircle2 className="h-3 w-3" /> Active</span>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground"><CalendarClock className="h-3 w-3" /> {membership.status}</span>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Staff links — for staff/ref/coach roles */}
      {(roles.some((r) => ["staff", "admin", "ref", "coach", "scorekeeper"].includes(r))) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Staff Access</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {roles.some((r) => ["staff", "admin", "ref", "coach"].includes(r)) && (
              <Button variant="outline" size="sm" className="w-full justify-start gap-2" asChild>
                <Link href="/staff/game-cards"><ClipboardList className="h-4 w-4" /> My Games</Link>
              </Button>
            )}
            {roles.includes("ref") && (
              <Button variant="outline" size="sm" className="w-full justify-start gap-2" asChild>
                <Link href="/ref-alerts"><AlertTriangle className="h-4 w-4" /> Open Ref Slots</Link>
              </Button>
            )}
            {roles.some((r) => ["staff", "admin"].includes(r)) && (
              <Button variant="outline" size="sm" className="w-full justify-start gap-2" asChild>
                <Link href="/staff/earnings"><DollarSign className="h-4 w-4" /> My Earnings</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Profile form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Personal Info</CardTitle>
          <CardDescription>Update your name, date of birth, gender, phone, address, and emergency contact</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            {/* Name */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">First name</Label>
                <Input id="firstName" name="firstName" value={formData.firstName} onChange={handleChange} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName">Last name</Label>
                <Input id="lastName" name="lastName" value={formData.lastName} onChange={handleChange} />
              </div>
            </div>

            {/* DOB + Gender */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="dateOfBirth">Date of birth</Label>
                <Input id="dateOfBirth" name="dateOfBirth" type="date" value={formData.dateOfBirth} onChange={handleChange} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gender">Gender</Label>
                <select
                  id="gender"
                  name="gender"
                  value={formData.gender}
                  onChange={handleChange}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Select…</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="nonbinary">Non-binary</option>
                  <option value="prefer_not_to_say">Prefer not to say</option>
                </select>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Changes to date of birth and address do not re-trigger ID verification.
            </p>

            {/* Phone */}
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <PhoneInput
                id="phone"
                value={formData.phone}
                onChange={(formatted) => setFormData((fd) => ({ ...fd, phone: formatted }))}
              />
            </div>

            <Separator />

            {/* Address */}
            <p className="text-sm font-medium text-foreground">Home Address</p>
            <div className="space-y-1.5">
              <Label htmlFor="addressLine1">Street address</Label>
              <Input id="addressLine1" name="addressLine1" value={formData.addressLine1} onChange={handleChange} placeholder="123 Main St" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-1 space-y-1.5">
                <Label htmlFor="city">City</Label>
                <Input id="city" name="city" value={formData.city} onChange={handleChange} />
              </div>
              <div className="col-span-1 space-y-1.5">
                <Label htmlFor="state">State</Label>
                <Input id="state" name="state" value={formData.state} onChange={handleChange} placeholder="CA" maxLength={2} className="uppercase" />
              </div>
              <div className="col-span-1 space-y-1.5">
                <Label htmlFor="zip">ZIP</Label>
                <Input id="zip" name="zip" value={formData.zip} onChange={handleChange} placeholder="90210" maxLength={10} />
              </div>
            </div>

            <Separator />

            {/* Emergency contact */}
            <p className="text-sm font-medium text-foreground">Emergency Contact</p>
            <div className="space-y-1.5">
              <Label htmlFor="emergencyContactName">Contact name</Label>
              <Input id="emergencyContactName" name="emergencyContactName" value={formData.emergencyContactName} onChange={handleChange} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emergencyContactPhone">Contact phone</Label>
              <PhoneInput
                id="emergencyContactPhone"
                value={formData.emergencyContactPhone}
                onChange={(formatted) => setFormData((fd) => ({ ...fd, emergencyContactPhone: formatted }))}
              />
            </div>

            <Button type="submit" disabled={updateProfile.isPending} className="w-full">
              {updateProfile.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save changes
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Read-only Account Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account Info</CardTitle>
          <CardDescription>These details are managed by the platform and cannot be edited here</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Email</p>
              <p className="text-sm font-medium">{user?.primaryEmailAddress?.emailAddress || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">PlayOn ID</p>
              <p className="text-sm font-mono font-medium">{profile?.playonId || "Pending"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-2">Roles</p>
              <div className="flex flex-wrap gap-1">
                {roles.length > 0
                  ? roles.map((r) => <Badge key={r} variant="secondary" className="capitalize text-xs">{r}</Badge>)
                  : <span className="text-sm text-muted-foreground">—</span>}
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">ID Verification</p>
              {idVerified ? (
                <div className="flex items-center gap-1.5 text-green-600">
                  <ShieldCheck className="h-4 w-4" />
                  <span className="text-sm font-medium">Verified</span>
                  {idVerifiedAt && (
                    <span className="text-xs text-muted-foreground ml-1">
                      {new Date(idVerifiedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <ShieldOff className="h-4 w-4" />
                  <span className="text-sm">Not verified</span>
                </div>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Avatar is managed via your account settings (top-right menu).
            To change your email or roles, contact support.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function QRSection() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const { data: profile } = useGetMyProfile();
  const [bright, setBright] = useState(false);
  const [dataUrl, setDataUrl] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [childrenQr, setChildrenQr] = useState<any[]>([]);
  const isParent = (profile as any)?.roles?.includes("parent") ?? false;

  useEffect(() => {
    if (!isParent) return;
    getToken().then((token) => {
      fetch(`${API_BASE}/me/children-qr-today`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => { if (data?.children) setChildrenQr(data.children.filter((c: any) => c.qrCode)); })
        .catch(() => {});
    });
  }, [isParent]);

  const qrValue = (profile as any)?.qrCode ?? (user?.id ? `playon:player:${user.id}` : "");

  const profiles = [
    { label: "My QR", name: "Me", qrCode: qrValue },
    ...childrenQr.map((c) => ({
      label: c.firstName ?? "Child",
      name: `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Child",
      qrCode: c.qrCode,
    })),
  ];

  const safeIdx = Math.min(selectedIdx, profiles.length - 1);
  const active = profiles[safeIdx];

  useEffect(() => {
    if (!active?.qrCode) { setDataUrl(""); return; }
    QRCodeLib.toDataURL(active.qrCode, {
      width: 300,
      margin: 2,
      color: { dark: "#1E2829", light: "#FFFFFF" },
    }).then(setDataUrl).catch(() => {});
  }, [active?.qrCode]);

  return (
    <div className="max-w-sm mx-auto space-y-4">
      <div className={`rounded-2xl p-6 flex flex-col items-center gap-4 border transition-colors ${bright ? "bg-white border-gray-200" : "bg-card border-border"}`}>
        <div className="flex items-center justify-between w-full">
          <h3 className={`font-bold text-lg ${bright ? "text-gray-900" : "text-foreground"}`}>
            {safeIdx === 0 ? "My PlayOn ID" : `${active.name}'s PlayOn ID`}
          </h3>
          <button
            onClick={() => setBright(!bright)}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${bright ? "bg-yellow-100 border-yellow-300 text-yellow-800" : "border-border text-muted-foreground hover:bg-muted"}`}
          >
            ☀ {bright ? "Bright on" : "Brighten"}
          </button>
        </div>

        {profiles.length > 1 && (
          <div className="flex gap-2 overflow-x-auto w-full">
            {profiles.map((p, i) => (
              <button key={i} onClick={() => setSelectedIdx(i)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${i === safeIdx ? "bg-primary text-primary-foreground" : bright ? "bg-gray-100 text-gray-600" : "bg-muted text-muted-foreground"}`}>
                {p.label}
              </button>
            ))}
          </div>
        )}

        <div className={`p-4 rounded-2xl ${bright ? "bg-white border border-gray-100" : "bg-white"}`}>
          {dataUrl ? (
            <img src={dataUrl} alt="QR Code" className="w-[260px] h-[260px]" style={{ imageRendering: "pixelated" }} />
          ) : (
            <div className="w-[260px] h-[260px] flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>

        <p className={`text-xs text-center ${bright ? "text-gray-500" : "text-muted-foreground"}`}>
          Show this to check in at any PlayOn event
        </p>
      </div>
    </div>
  );
}

function NotificationsSection() {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<NotifPref[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Push notification state
  const [pushSupported, setPushSupported] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushDenied, setPushDenied] = useState(false);
  const [enablingPush, setEnablingPush] = useState(false);
  const iosNeedsHomeScreen = isIosSafari() && !isInStandaloneMode();

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API_BASE}/notification-preferences`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) setPrefs(await res.json());
      } catch {
        toast({ title: "Failed to load preferences", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !VAPID_PUBLIC_KEY) return;
    setPushSupported(true);
    if (Notification.permission === "denied") { setPushDenied(true); return; }
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      setPushSubscribed(!!sub);
    });
  }, []);

  async function enablePush() {
    if (!VAPID_PUBLIC_KEY) return;
    setEnablingPush(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushDenied(permission === "denied");
        toast({ title: "Notifications blocked", description: "Allow notifications in your browser settings.", variant: "destructive" });
        return;
      }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
      const token = await getToken();
      await fetch(`${API_BASE}/notification-preferences/push-subscription`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ endpoint: sub.endpoint, p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey("p256dh")!))), auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey("auth")!))) }),
      });
      setPushSubscribed(true);
      toast({ title: "Push notifications enabled!" });
    } catch (e: any) {
      toast({ title: "Could not enable push", description: e.message, variant: "destructive" });
    } finally {
      setEnablingPush(false);
    }
  }

  async function disablePush() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const token = await getToken();
        await fetch(`${API_BASE}/notification-preferences/push-subscription`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setPushSubscribed(false);
      toast({ title: "Push notifications disabled" });
    } catch {
      toast({ title: "Could not disable push", variant: "destructive" });
    }
  }

  function toggle(index: number, channel: "channelEmail" | "channelSms" | "channelPush") {
    setPrefs((prev) => prev.map((p, i) => (i === index ? { ...p, [channel]: !p[channel] } : p)));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/notification-preferences`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(prefs),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Preferences saved" });
      setDirty(false);
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Choose how you want to receive notifications for each type of event.</p>

      {/* iOS: needs Add to Home Screen first */}
      {iosNeedsHomeScreen && (
        <div className="p-4 rounded-lg border border-amber-200 bg-amber-50 flex gap-3 items-start text-sm">
          <span className="text-xl leading-none shrink-0">📱</span>
          <div>
            <p className="font-semibold text-amber-900">Add to Home Screen to enable push notifications</p>
            <p className="text-amber-800/80 text-xs mt-1 leading-relaxed">
              On iPhone and iPad, push notifications only work when PlayOn is installed as an app.
              Tap the <strong>Share</strong> button in Safari, then choose <strong>"Add to Home Screen"</strong>.
              Once installed, open the app from your home screen and return here to enable push.
            </p>
          </div>
        </div>
      )}

      {/* Push blocked in browser */}
      {pushDenied && (
        <div className="p-3 rounded-lg border border-destructive/20 bg-destructive/5 flex gap-2 items-start text-sm">
          <span className="text-destructive">⚠️</span>
          <span className="text-muted-foreground">
            Push notifications are <strong className="text-foreground">blocked</strong>. Click the lock icon in your address bar and allow notifications, then refresh.
          </span>
        </div>
      )}

      {/* Push enable prompt */}
      {pushSupported && !pushSubscribed && !pushDenied && !iosNeedsHomeScreen && (
        <div className="p-4 rounded-lg border border-primary/20 bg-primary/5 flex flex-col sm:flex-row sm:items-center gap-3">
          <Bell className="h-5 w-5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">Enable push notifications</p>
            <p className="text-muted-foreground text-xs mt-0.5">Get instant alerts on this device — even when the app is in the background.</p>
          </div>
          <Button size="sm" onClick={enablePush} disabled={enablingPush} className="shrink-0">
            {enablingPush ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
            Enable
          </Button>
        </div>
      )}

      {/* Push active */}
      {pushSubscribed && (
        <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 flex flex-col sm:flex-row sm:items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
          <p className="flex-1 text-sm font-medium">Push notifications are active on this device</p>
          <Button size="sm" variant="outline" onClick={disablePush} className="shrink-0 text-muted-foreground">Disable</Button>
        </div>
      )}

      {prefs.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">No notification preferences found.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {prefs.map((pref, index) => (
            <Card key={pref.notificationType}>
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="font-medium text-sm">{pref.label}</p>
                    {SMS_IMPORTANT.includes(pref.notificationType) && (
                      <p className="text-[11px] text-muted-foreground">Time-sensitive</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-6 flex-wrap">
                  {[
                    { key: "channelEmail" as const, icon: "✉", label: "Email" },
                    { key: "channelSms" as const, icon: "💬", label: "SMS" },
                    { key: "channelPush" as const, icon: "🔔", label: "Push" },
                  ].map(({ key, icon, label }) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                      <Switch checked={pref[key]} onCheckedChange={() => toggle(index, key)} />
                      <span className="text-xs text-muted-foreground">{icon} {label}</span>
                    </label>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {dirty && (
        <Button onClick={save} disabled={saving} className="w-full">
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save preferences
        </Button>
      )}
    </div>
  );
}

type HistoryItem = {
  id: string;
  type: "league" | "camp" | "tournament" | "dropin";
  eventId: number;
  eventName: string | null;
  startDate: string | null;
  endDate: string | null;
  venueName: string | null;
  teamId: number | null;
  teamName: string | null;
  status: string;
  paymentStatus: string;
  createdAt: string;
};

const TYPE_LABEL: Record<string, string> = {
  league: "League", camp: "Camp", tournament: "Tournament", dropin: "Drop-In",
};
const TYPE_ICON: Record<string, React.ElementType> = {
  league: Users, camp: Tent, tournament: Trophy, dropin: Zap,
};

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "cancelled") return "destructive";
  if (status === "confirmed" || status === "active") return "default";
  return "secondary";
}

function paymentVariant(ps: string): "default" | "secondary" | "destructive" | "outline" {
  if (ps === "paid_inapp" || ps === "paid_external") return "default";
  if (ps === "refunded") return "destructive";
  return "secondary";
}

function formatDateRange(startDate: string | null, endDate: string | null) {
  if (!startDate) return null;
  const fmt = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  if (!endDate || endDate === startDate) return fmt(startDate);
  return `${fmt(startDate)} – ${fmt(endDate)}`;
}

function HistorySection() {
  const { getToken } = useAuth();
  const { data: profile } = useGetMyProfile();
  const isParent = (profile as any)?.roles?.includes("parent") ?? false;

  const [selectedYouthId, setSelectedYouthId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const LIMIT = 20;

  const { data: childrenData } = useQuery({
    queryKey: ["family", "dashboard"],
    queryFn: async () => {
      if (!isParent) return null;
      const token = await getToken();
      const r = await fetch(`${API_BASE}/family/dashboard`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return null;
      return r.json();
    },
    enabled: isParent,
  });

  const children: { youthUserId: number; name: string }[] = React.useMemo(() => {
    if (!childrenData?.children) return [];
    return childrenData.children.map((c: any) => ({
      youthUserId: c.youthUserId,
      name: [c.firstName, c.lastName].filter(Boolean).join(" ") || "Child",
    }));
  }, [childrenData]);

  const { data: historyData, isLoading, error } = useQuery({
    queryKey: ["registration-history", selectedYouthId, page],
    queryFn: async () => {
      const token = await getToken();
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (selectedYouthId != null) params.set("youthUserId", String(selectedYouthId));
      const r = await fetch(`${API_BASE}/me/registration-history?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error("Failed to load history");
      return r.json() as Promise<{ total: number; page: number; limit: number; items: HistoryItem[] }>;
    },
  });

  const allItems = historyData?.items ?? [];
  const total = historyData?.total ?? 0;

  // Group by year
  type Group = { year: string; items: HistoryItem[] };
  const grouped = React.useMemo(() => {
    const map: Record<string, HistoryItem[]> = {};
    for (const item of allItems) {
      const year = new Date(item.startDate || item.createdAt).getFullYear().toString();
      if (!map[year]) map[year] = [];
      map[year].push(item);
    }
    return Object.entries(map)
      .sort(([a], [b]) => parseInt(b) - parseInt(a))
      .map(([year, items]) => ({ year, items })) as Group[];
  }, [allItems]);

  const switchPlayer = (youthId: number | null) => {
    setSelectedYouthId(youthId);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      {/* Family switcher */}
      {isParent && children.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => switchPlayer(null)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
              selectedYouthId === null ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            Me
          </button>
          {children.map((c) => (
            <button
              key={c.youthUserId}
              onClick={() => switchPlayer(c.youthUserId)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                selectedYouthId === c.youthUserId ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : error ? (
        <Card>
          <CardContent className="py-8 text-center text-destructive">
            Failed to load history. Please try again.
          </CardContent>
        </Card>
      ) : grouped.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <History className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-semibold text-base mb-1">No history yet</p>
            <p className="text-sm text-muted-foreground">Past events will appear here once they've ended.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {grouped.map(({ year, items }) => (
            <div key={year} className="space-y-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">{year}</h3>
              <div className="space-y-2">
                {items.map((item) => {
                  const Icon = TYPE_ICON[item.type] ?? History;
                  return (
                    <Card key={item.id}>
                      <CardContent className="py-3 px-4">
                        <div className="flex items-start gap-3">
                          <div className="p-2 rounded-lg bg-primary/10 shrink-0 mt-0.5">
                            <Icon className="h-4 w-4 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-sm truncate">{item.eventName ?? "—"}</p>
                              <Badge variant="outline" className="text-[10px] capitalize shrink-0">{TYPE_LABEL[item.type]}</Badge>
                            </div>
                            {item.teamName && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <Users className="h-3 w-3" />{item.teamName}
                              </p>
                            )}
                            {(item.startDate || item.venueName) && (
                              <p className="text-xs text-muted-foreground">
                                {formatDateRange(item.startDate, item.endDate)}
                                {item.venueName && item.startDate ? ` · ${item.venueName}` : item.venueName}
                              </p>
                            )}
                            <div className="flex gap-1.5 flex-wrap pt-0.5">
                              <Badge variant={statusVariant(item.status)} className="text-[10px] capitalize">{item.status}</Badge>
                              <Badge variant={paymentVariant(item.paymentStatus)} className="text-[10px]">{item.paymentStatus.replace(/_/g, " ")}</Badge>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Pagination */}
          {total > LIMIT && (
            <div className="flex items-center justify-between pt-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Previous
              </Button>
              <span className="text-xs text-muted-foreground">
                {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}
              </span>
              <Button variant="outline" size="sm" disabled={page * LIMIT >= total} onClick={() => setPage((p) => p + 1)}>
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AccountPage() {
  const [location] = useLocation();

  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("tab") as Tab;
    return (t === "qr" || t === "notifications" || t === "history") ? t : "profile";
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("tab") as Tab;
    if (t === "qr" || t === "notifications" || t === "history") setActiveTab(t);
  }, [location]);

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "profile",       label: "Profile",       icon: User },
    { id: "qr",            label: "QR Code",        icon: QrCode },
    { id: "notifications", label: "Notifications",  icon: Bell },
    { id: "history",       label: "History",        icon: History },
  ];

  return (
    <Layout>
      <Show when="signed-out">
        <div className="container mx-auto px-4 py-24 max-w-md text-center">
          <User className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-3">Sign in to view your Settings</h1>
          <Button asChild><Link href="/sign-in">Sign In</Link></Button>
        </div>
      </Show>
      <Show when="signed-in">
        <div className="container mx-auto px-4 py-8 max-w-2xl">
          <h1 className="text-3xl font-bold uppercase tracking-tight mb-6">Settings</h1>

          <PendingDropinSpots />

          {/* Tab bar */}
          <div className="flex gap-0 border-b border-border mb-8 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "profile" && <ProfileSection />}
          {activeTab === "qr" && <QRSection />}
          {activeTab === "notifications" && <NotificationsSection />}
          {activeTab === "history" && <HistorySection />}
        </div>
      </Show>
    </Layout>
  );
}
