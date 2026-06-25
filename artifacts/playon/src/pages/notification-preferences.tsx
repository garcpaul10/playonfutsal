import { API_BASE } from "@/lib/api-base";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Bell,
  Mail,
  MessageSquare,
  Globe,
  Loader2,
  Info,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

interface NotifPref {
  notificationType: string;
  label: string;
  channelEmail: boolean;
  channelSms: boolean;
  channelPush: boolean;
}

const SMS_IMPORTANT = ["waitlist_movement", "cancellation_rainout", "payment_receipt", "schedule_change"];

// Notification categories for grouped display
const CATEGORIES: { label: string; types: string[] }[] = [
  {
    label: "Transactional",
    types: [
      "registration_confirmed",
      "registration_cancelled",
      "payment_receipt",
      "payment_due",
      "balance_due",
      "refund_issued",
      "waitlist_movement",
      "cancellation_rainout",
    ],
  },
  {
    label: "Reminders",
    types: ["upcoming_session", "schedule_change", "dropin_reminder"],
  },
  {
    label: "Community",
    types: [
      "announcement",
      "results_standings",
      "sub_ref_alert",
      "fa_match_proposal",
      "fa_match_response",
    ],
  },
];

// ─── Web Push helpers ─────────────────────────────────────────────────────────

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function getOrCreatePushSubscription(
  reg: ServiceWorkerRegistration,
): Promise<PushSubscription | null> {
  if (!VAPID_PUBLIC_KEY) return null;
  try {
    const existing = await reg.pushManager.getSubscription();
    if (existing) return existing;
    return await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  } catch {
    return null;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

type PushPermission = "unsupported" | "default" | "granted" | "denied";

export default function NotificationPreferences() {
  const { getToken } = useAuth();
  const { toast } = useToast();

  const [prefs, setPrefs] = useState<NotifPref[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Web push state
  const [pushPermission, setPushPermission] = useState<PushPermission>("unsupported");
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [enablingPush, setEnablingPush] = useState(false);

  // Detect push support and current permission on mount
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !VAPID_PUBLIC_KEY) {
      setPushPermission("unsupported");
      return;
    }
    const perm = Notification.permission as PushPermission;
    setPushPermission(perm);

    if (perm === "granted") {
      navigator.serviceWorker.ready.then(async (reg) => {
        const sub = await reg.pushManager.getSubscription();
        setPushSubscribed(!!sub);
      });
    }
  }, []);

  const loadPrefs = useCallback(async () => {
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
  }, [getToken, toast]);

  useEffect(() => { loadPrefs(); }, [loadPrefs]);

  function toggle(index: number, channel: "channelEmail" | "channelSms" | "channelPush") {
    setPrefs((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [channel]: !p[channel] } : p)),
    );
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/notification-preferences`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Preferences saved" });
      setDirty(false);
    } catch {
      toast({ title: "Failed to save preferences", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function enableWebPush() {
    if (!("serviceWorker" in navigator) || !VAPID_PUBLIC_KEY) return;
    setEnablingPush(true);
    try {
      const permission = await Notification.requestPermission();
      setPushPermission(permission as PushPermission);

      if (permission !== "granted") {
        toast({
          title: "Permission denied",
          description: "Enable notifications in your browser settings to use web push.",
          variant: "destructive",
        });
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await getOrCreatePushSubscription(reg);
      if (!sub) throw new Error("Could not subscribe");

      const token = await getToken();
      const res = await fetch(`${API_BASE}/notification-preferences/push-subscription`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          keys: {
            p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey("p256dh")!))),
            auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey("auth")!))),
          },
        }),
      });

      if (!res.ok) throw new Error("Backend registration failed");

      setPushSubscribed(true);
      toast({ title: "Web notifications enabled!" });

      // Default all push toggles to on for priority types, then save
      setPrefs((prev) =>
        prev.map((p) =>
          SMS_IMPORTANT.includes(p.notificationType) ? { ...p, channelPush: true } : p,
        ),
      );
      setDirty(true);
    } catch (err) {
      console.error("[push] Enable error:", err);
      toast({ title: "Could not enable web notifications", variant: "destructive" });
    } finally {
      setEnablingPush(false);
    }
  }

  async function disableWebPush() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const token = await getToken();
        await fetch(`${API_BASE}/notification-preferences/push-subscription`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setPushSubscribed(false);
      setPrefs((prev) => prev.map((p) => ({ ...p, channelPush: false })));
      setDirty(true);
      toast({ title: "Web notifications disabled" });
    } catch {
      toast({ title: "Could not disable web notifications", variant: "destructive" });
    }
  }

  // ─── Render helpers ─────────────────────────────────────────────────────────

  function renderWebPushHeader() {
    if (pushPermission === "unsupported") {
      return (
        <div className="flex flex-col items-center gap-1 text-center px-1">
          <Globe className="h-4 w-4 text-muted-foreground/50" />
          <span className="text-[10px] text-muted-foreground/50 leading-tight">Not supported</span>
        </div>
      );
    }
    if (pushPermission === "denied") {
      return (
        <div className="flex flex-col items-center gap-1 text-center px-1">
          <AlertCircle className="h-4 w-4 text-destructive/70" />
          <span className="text-[10px] text-destructive/70 leading-tight">Blocked</span>
        </div>
      );
    }
    if (pushSubscribed) {
      return (
        <div className="flex flex-col items-center gap-1">
          <Globe className="h-4 w-4 text-primary" />
          <CheckCircle2 className="h-3 w-3 text-primary" />
        </div>
      );
    }
    return <Globe className="h-4 w-4 mx-auto" />;
  }

  function renderWebPushCell(pref: NotifPref, index: number) {
    if (pushPermission === "unsupported" || pushPermission === "denied") {
      return <span className="text-muted-foreground/30 text-xs mx-auto block text-center">—</span>;
    }
    if (!pushSubscribed) {
      return null; // Enable button shown in column header area
    }
    return (
      <Switch
        checked={pref.channelPush}
        onCheckedChange={() => toggle(index, "channelPush")}
        aria-label={`Web push for ${pref.label}`}
      />
    );
  }

  const showPushEnableRow =
    pushPermission !== "unsupported" && pushPermission !== "denied" && !pushSubscribed;

  // Build ordered list based on CATEGORIES, with "Other" catch-all
  const orderedPrefs: { category: string; items: (NotifPref & { originalIndex: number })[] }[] = [];
  const categoryTypeSet = new Set(CATEGORIES.flatMap((c) => c.types));

  for (const cat of CATEGORIES) {
    const items = cat.types
      .map((type) => {
        const idx = prefs.findIndex((p) => p.notificationType === type);
        if (idx === -1) return null;
        return { ...prefs[idx], originalIndex: idx };
      })
      .filter(Boolean) as (NotifPref & { originalIndex: number })[];
    if (items.length > 0) orderedPrefs.push({ category: cat.label, items });
  }

  const otherItems = prefs
    .map((p, i) => ({ ...p, originalIndex: i }))
    .filter((p) => !categoryTypeSet.has(p.notificationType));
  if (otherItems.length > 0) orderedPrefs.push({ category: "Other", items: otherItems });

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <Bell className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Notification Preferences</h1>
            <p className="text-muted-foreground text-sm">
              Choose how you want to be notified for each event type.
            </p>
          </div>
        </div>

        {/* Info banner */}
        <div className="mb-5 p-3 rounded-lg bg-muted/40 flex gap-2 items-start text-sm text-muted-foreground">
          <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
          <span>
            <strong className="text-foreground">SMS recommended for guardian accounts.</strong>{" "}
            Youth families get SMS on by default for critical updates like waitlist movement,
            cancellations, and payment receipts — so you never miss something important.
          </span>
        </div>

        {/* Web push enable prompt */}
        {showPushEnableRow && (
          <div className="mb-5 p-4 rounded-lg border border-primary/20 bg-primary/5 flex flex-col sm:flex-row sm:items-center gap-3">
            <Globe className="h-5 w-5 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">Enable browser notifications</p>
              <p className="text-muted-foreground text-xs mt-0.5">
                Get instant alerts in this browser — even when the tab is in the background.
              </p>
            </div>
            <Button
              size="sm"
              onClick={enableWebPush}
              disabled={enablingPush}
              className="shrink-0"
            >
              {enablingPush ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Enable
            </Button>
          </div>
        )}

        {/* Disable push option */}
        {pushSubscribed && (
          <div className="mb-5 p-3 rounded-lg border border-primary/20 bg-primary/5 flex flex-col sm:flex-row sm:items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm text-primary">Browser notifications active</p>
              <p className="text-muted-foreground text-xs mt-0.5">
                This browser will receive push alerts for categories you enable below.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={disableWebPush}
              className="shrink-0 text-muted-foreground"
            >
              Disable
            </Button>
          </div>
        )}

        {/* Permission denied warning */}
        {pushPermission === "denied" && (
          <div className="mb-5 p-3 rounded-lg border border-destructive/20 bg-destructive/5 flex gap-2 items-start text-sm">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
            <span className="text-muted-foreground">
              Browser notifications are <strong className="text-foreground">blocked</strong> for
              this site. To enable them, click the lock icon in your address bar and allow
              notifications, then refresh the page.
            </span>
          </div>
        )}

        {/* Preferences table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left px-6 py-3 font-medium text-muted-foreground">
                      Notification type
                    </th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground w-20">
                      <div className="flex flex-col items-center gap-0.5">
                        <Mail className="h-4 w-4" />
                        <span className="text-[10px]">Email</span>
                      </div>
                    </th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground w-20">
                      <div className="flex flex-col items-center gap-0.5">
                        <MessageSquare className="h-4 w-4" />
                        <span className="text-[10px]">SMS</span>
                      </div>
                    </th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground w-24">
                      {renderWebPushHeader()}
                      {pushPermission !== "unsupported" && (
                        <span className="text-[10px] block mt-0.5">Web</span>
                      )}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loading
                    ? Array.from({ length: 8 }).map((_, i) => (
                        <tr key={i} className="border-b">
                          <td className="px-6 py-4">
                            <div className="h-4 w-40 bg-muted animate-pulse rounded" />
                          </td>
                          {[0, 1, 2].map((j) => (
                            <td key={j} className="px-4 py-4 text-center">
                              <div className="h-5 w-9 bg-muted animate-pulse rounded-full mx-auto" />
                            </td>
                          ))}
                        </tr>
                      ))
                    : orderedPrefs.map(({ category, items }) => (
                        <>
                          <tr key={`cat-${category}`} className="bg-muted/20 border-b">
                            <td
                              colSpan={4}
                              className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                            >
                              {category}
                            </td>
                          </tr>
                          {items.map((p) => (
                            <tr
                              key={p.notificationType}
                              className="border-b hover:bg-muted/20 transition-colors"
                            >
                              <td className="px-6 py-3.5 font-medium">
                                <span>{p.label}</span>
                                {SMS_IMPORTANT.includes(p.notificationType) && (
                                  <Badge variant="outline" className="ml-2 text-xs py-0">
                                    Priority
                                  </Badge>
                                )}
                              </td>
                              <td className="px-4 py-3.5 text-center">
                                <Switch
                                  checked={p.channelEmail}
                                  onCheckedChange={() => toggle(p.originalIndex, "channelEmail")}
                                  aria-label={`Email for ${p.label}`}
                                />
                              </td>
                              <td className="px-4 py-3.5 text-center">
                                <Switch
                                  checked={p.channelSms}
                                  onCheckedChange={() => toggle(p.originalIndex, "channelSms")}
                                  aria-label={`SMS for ${p.label}`}
                                />
                              </td>
                              <td className="px-4 py-3.5 text-center">
                                {renderWebPushCell(p, p.originalIndex)}
                              </td>
                            </tr>
                          ))}
                        </>
                      ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" /> Email
            </span>
            <span className="flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" /> SMS / Text
            </span>
            {pushPermission !== "unsupported" && (
              <span className="flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5" /> Web notifications
                {pushSubscribed && (
                  <CheckCircle2 className="h-3 w-3 text-primary" />
                )}
              </span>
            )}
          </div>
          <Button onClick={save} disabled={!dirty || saving} className="min-w-32">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save preferences
          </Button>
        </div>
      </div>
    </Layout>
  );
}
