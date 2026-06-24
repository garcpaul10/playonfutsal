import { useState } from "react";
import { useAuth } from "@clerk/react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Bell, Search, Loader2, Mail, MessageSquare, Smartphone } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

interface UserResult {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
}

interface Pref {
  notificationType: string;
  label: string;
  channelEmail: boolean;
  channelSms: boolean;
  channelPush: boolean;
}

interface UserPrefsResult {
  user: UserResult;
  prefs: Pref[];
}

const SMS_PRIORITY = [
  "waitlist_movement",
  "cancellation_rainout",
  "payment_receipt",
  "schedule_change",
];

export default function AdminNotificationPreferences() {
  const { getToken } = useAuth();
  const { toast } = useToast();

  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<UserResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [selected, setSelected] = useState<UserPrefsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prefs, setPrefs] = useState<Pref[]>([]);

  async function search() {
    if (!searchTerm.trim()) return;
    setSearching(true);
    try {
      const token = await getToken();
      const res = await fetch(
        `${API_BASE}/users?q=${encodeURIComponent(searchTerm)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : data.users ?? [];
        setSearchResults(list.slice(0, 10));
      }
    } catch {
      toast({ title: "Search failed", variant: "destructive" });
    } finally {
      setSearching(false);
    }
  }

  async function loadPrefs(user: UserResult) {
    setLoading(true);
    setSelected(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/notification-preferences/${user.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data: UserPrefsResult = await res.json();
        setSelected(data);
        setPrefs(data.prefs);
      } else {
        toast({ title: "Failed to load preferences", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to load preferences", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  function toggle(type: string, channel: "channelEmail" | "channelSms" | "channelPush") {
    setPrefs((prev) =>
      prev.map((p) =>
        p.notificationType === type ? { ...p, [channel]: !p[channel] } : p,
      ),
    );
  }

  async function save() {
    if (!selected) return;
    setSaving(true);
    try {
      const token = await getToken();
      const res = await fetch(
        `${API_BASE}/admin/notification-preferences/${selected.user.id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            prefs.map((p) => ({
              notificationType: p.notificationType,
              channelEmail: p.channelEmail,
              channelSms: p.channelSms,
              channelPush: p.channelPush,
            })),
          ),
        },
      );
      if (res.ok) {
        toast({ title: "Preferences saved" });
      } else {
        toast({ title: "Failed to save", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex items-center gap-3 mb-8">
          <Bell className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Notification Preferences</h1>
            <p className="text-muted-foreground text-sm">
              View and override notification channel preferences for any user.
            </p>
          </div>
        </div>

        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Find user</CardTitle>
            <CardDescription>Search by name or email address.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input
                placeholder="Name or email…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && search()}
                className="flex-1"
              />
              <Button onClick={search} disabled={searching} className="gap-2">
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Search
              </Button>
            </div>

            {searchResults.length > 0 && (
              <div className="mt-3 divide-y border rounded-md overflow-hidden">
                {searchResults.map((u) => (
                  <button
                    key={u.id}
                    className="w-full text-left px-4 py-3 hover:bg-accent transition-colors flex items-center justify-between"
                    onClick={() => { loadPrefs(u); setSearchResults([]); }}
                  >
                    <div>
                      <p className="font-medium text-sm">
                        {u.firstName || u.lastName
                          ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim()
                          : u.email}
                      </p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </div>
                    <Badge variant="outline" className="text-xs capitalize shrink-0">
                      {u.role}
                    </Badge>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        )}

        {selected && prefs.length > 0 && (
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">
                  {selected.user.firstName || selected.user.lastName
                    ? `${selected.user.firstName ?? ""} ${selected.user.lastName ?? ""}`.trim()
                    : selected.user.email}
                </CardTitle>
                <CardDescription>
                  {selected.user.email} · <span className="capitalize">{selected.user.role}</span>
                </CardDescription>
              </div>
              <Button onClick={save} disabled={saving} size="sm" className="gap-1.5">
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save
              </Button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-2 text-xs font-medium text-muted-foreground uppercase mb-3 px-1">
                <span className="col-span-1">Type</span>
                <span className="text-center flex items-center justify-center gap-1">
                  <Mail className="h-3 w-3" /> Email
                </span>
                <span className="text-center flex items-center justify-center gap-1">
                  <MessageSquare className="h-3 w-3" /> SMS
                </span>
                <span className="text-center flex items-center justify-center gap-1">
                  <Smartphone className="h-3 w-3" /> Push
                </span>
              </div>
              <div className="space-y-2">
                {prefs.map((p) => (
                  <div
                    key={p.notificationType}
                    className="grid grid-cols-4 gap-2 items-center rounded-md border px-3 py-2.5"
                  >
                    <div className="col-span-1 flex items-center gap-1.5 min-w-0">
                      <Label className="text-sm font-normal leading-tight truncate">
                        {p.label}
                      </Label>
                      {SMS_PRIORITY.includes(p.notificationType) && (
                        <Badge variant="secondary" className="text-[10px] px-1 py-0 shrink-0">
                          Priority
                        </Badge>
                      )}
                    </div>
                    <div className="flex justify-center">
                      <Switch
                        checked={p.channelEmail}
                        onCheckedChange={() => toggle(p.notificationType, "channelEmail")}
                      />
                    </div>
                    <div className="flex justify-center">
                      <Switch
                        checked={p.channelSms}
                        onCheckedChange={() => toggle(p.notificationType, "channelSms")}
                      />
                    </div>
                    <div className="flex justify-center">
                      <Switch
                        checked={p.channelPush}
                        onCheckedChange={() => toggle(p.notificationType, "channelPush")}
                        disabled
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
