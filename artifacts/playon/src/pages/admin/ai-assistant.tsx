import { API_BASE } from "@/lib/api-base";
import React, { useState, useRef, useEffect } from "react";
import { Redirect, Link } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { format } from "date-fns";
import {
  Bot, Send, Plus, Trash2, CheckCircle2, AlertTriangle,
  Sparkles, ChevronRight, RotateCcw, History, X,
  Trophy, Calendar, Users, DollarSign, Settings, Layers, Pencil,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

interface Session {
  id: number;
  entityType: string;
  status: string;
  createdEntityId: number | null;
  createdEntityType: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SessionDetail extends Session {
  thread: { role: "user" | "assistant"; content: string; createdAt: string }[];
  partialEntity: Record<string, any>;
}

interface AgentResponse {
  sessionId: number;
  message: string;
  fieldUpdates: Record<string, any>;
  conflictWarning: string | null;
  readyToCreate: boolean;
  entitySummary: Record<string, any> | null;
  partialEntity: Record<string, any>;
  isEditMode?: boolean;
  currentEntity?: Record<string, any>;
}

// ── Entity type cards ──────────────────────────────────────────────────────

const ENTITY_TYPES = [
  { id: "league",      label: "League",         icon: Trophy,    color: "text-amber-500",  bg: "bg-amber-500/10",  desc: "Seasonal competition with teams, fixtures & standings" },
  { id: "tournament",  label: "Tournament",      icon: Layers,    color: "text-blue-500",   bg: "bg-blue-500/10",   desc: "Bracket-style event with seeding & knockout rounds" },
  { id: "camp",        label: "Camp",            icon: Calendar,  color: "text-green-500",  bg: "bg-green-500/10",  desc: "Multi-day skill development program" },
  { id: "drop_in",     label: "Drop-in",         icon: Users,     color: "text-purple-500", bg: "bg-purple-500/10", desc: "Single session open play" },
  { id: "membership",  label: "Membership Plan", icon: Settings,  color: "text-rose-500",   bg: "bg-rose-500/10",   desc: "Subscription tier with billing & benefits" },
  { id: "pricing",     label: "Pricing Rule",    icon: DollarSign, color: "text-teal-500",  bg: "bg-teal-500/10",   desc: "Fee structure for registration or events" },
];

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  drafting:  { label: "In Progress", variant: "secondary" },
  confirmed: { label: "Ready",       variant: "outline" },
  created:   { label: "Created",     variant: "default" },
  editing:   { label: "Editing",     variant: "secondary" },
};

// ── Entity preview panel ───────────────────────────────────────────────────

function EntityPreview({
  partialEntity, entityType, originalEntity,
}: {
  partialEntity: Record<string, any>;
  entityType: string;
  originalEntity?: Record<string, any> | null;
}) {
  const skipKeys = new Set(["_entityType", "_editTargetId"]);
  const fields = Object.entries(partialEntity).filter(([k]) => !skipKeys.has(k) && !k.startsWith("_"));
  const isEditMode = !!originalEntity;

  if (!fields.length) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-30" />
        <p>Fields will appear here as you answer questions</p>
      </div>
    );
  }

  const entityInfo = ENTITY_TYPES.find(e => e.id === entityType);
  const Icon = entityInfo?.icon ?? Bot;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-3">
        <div className={`p-1.5 rounded ${entityInfo?.bg ?? "bg-muted"}`}>
          <Icon className={`h-4 w-4 ${entityInfo?.color ?? "text-muted-foreground"}`} />
        </div>
        <span className="text-sm font-semibold">{entityInfo?.label ?? entityType}</span>
        <span className="text-xs text-muted-foreground">
          {isEditMode ? "— proposed changes" : "— live preview"}
        </span>
      </div>
      <div className="space-y-1.5">
        {fields.map(([key, value]) => {
          const original = originalEntity?.[key];
          const changed = isEditMode && original !== undefined && String(original) !== String(value ?? "");
          return (
            <div key={key} className={`flex items-start justify-between gap-2 py-1 border-b border-muted/40 last:border-0 ${changed ? "bg-amber-500/5 rounded px-1" : ""}`}>
              <span className="text-xs text-muted-foreground capitalize shrink-0">
                {key.replace(/([A-Z])/g, " $1").replace(/_/g, " ").trim()}
              </span>
              <div className="text-right">
                {changed && (
                  <div className="text-xs text-muted-foreground/60 line-through">{String(original ?? "—")}</div>
                )}
                <span className={`text-xs font-medium break-all ${changed ? "text-amber-600 dark:text-amber-400" : ""}`}>
                  {typeof value === "boolean" ? (value ? "Yes" : "No") : String(value ?? "—")}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {isEditMode && (
        <p className="text-xs text-muted-foreground pt-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-amber-500/30 mr-1" />
          Changed fields shown in amber
        </p>
      )}
    </div>
  );
}

// ── Message bubble ─────────────────────────────────────────────────────────

function MessageBubble({
  role, content, conflictWarning, readyToCreate, isEditMode, onConfirmCreate, onApplyEdit,
}: {
  role: "user" | "assistant";
  content: string;
  conflictWarning?: string | null;
  readyToCreate?: boolean;
  isEditMode?: boolean;
  onConfirmCreate?: () => void;
  onApplyEdit?: () => void;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      {!isUser && (
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center mr-2 mt-0.5">
          <Bot className="h-3.5 w-3.5 text-primary" />
        </div>
      )}
      <div className={`max-w-[85%] space-y-2`}>
        <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted text-foreground rounded-bl-sm"
        }`}>
          {content}
        </div>
        {conflictWarning && (
          <div className="flex items-start gap-2 text-xs text-amber-500 bg-amber-500/10 rounded-lg px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{conflictWarning}</span>
          </div>
        )}
        {readyToCreate && (isEditMode ? onApplyEdit : onConfirmCreate) && (
          <Button
            size="sm"
            className={`h-8 gap-1.5 ${isEditMode ? "bg-amber-600 hover:bg-amber-700" : ""}`}
            onClick={isEditMode ? onApplyEdit : onConfirmCreate}
          >
            {isEditMode ? <Pencil className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {isEditMode ? "Apply Changes" : "Confirm & Create"}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Edit mode: entity picker ───────────────────────────────────────────────

function EditEntityPicker({ onLoad }: { onLoad: (entityType: string, entityId: number) => void }) {
  const [entityType, setEntityType] = useState("league");
  const [entityId, setEntityId] = useState("");

  return (
    <div className="flex flex-col items-center gap-4 p-4 max-w-sm mx-auto">
      <Pencil className="h-8 w-8 text-primary opacity-60" />
      <p className="text-sm font-medium">Edit an existing record</p>
      <p className="text-xs text-muted-foreground text-center">Select the type and enter the numeric ID from the admin panel.</p>
      <div className="w-full space-y-3">
        <select
          className="w-full text-sm border rounded-md px-3 py-2 bg-background"
          value={entityType}
          onChange={e => setEntityType(e.target.value)}
        >
          {ENTITY_TYPES.map(et => <option key={et.id} value={et.id}>{et.label}</option>)}
        </select>
        <Input
          type="number"
          placeholder="Entity ID (e.g. 42)"
          value={entityId}
          onChange={e => setEntityId(e.target.value)}
          className="text-sm"
        />
        <Button
          className="w-full"
          disabled={!entityId || !Number(entityId)}
          onClick={() => onLoad(entityType, Number(entityId))}
        >
          Load for editing
        </Button>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function AdminAiAssistant() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedEntityType, setSelectedEntityType] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [thread, setThread] = useState<{ role: "user" | "assistant"; content: string; conflictWarning?: string | null; readyToCreate?: boolean }[]>([]);
  const [partialEntity, setPartialEntity] = useState<Record<string, any>>({});
  const [originalEntity, setOriginalEntity] = useState<Record<string, any> | null>(null);
  const [lastEntitySummary, setLastEntitySummary] = useState<Record<string, any> | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showEditPicker, setShowEditPicker] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: sessions, isLoading: sessionsLoading } = useQuery<Session[]>({
    queryKey: ["ai-creation-sessions"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/ai/creation-sessions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load sessions");
      return res.json();
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread]);

  if (profileLoading) {
    return (
      <Layout>
        <div className="container mx-auto py-8"><Skeleton className="h-96" /></div>
      </Layout>
    );
  }
  if (profile?.role !== "admin" && profile?.adminLevel !== "super" && profile?.adminLevel !== "admin") return <Redirect to="/" />;

  async function sendMessage(text?: string) {
    const msg = (text ?? message).trim();
    if (!msg || sending) return;

    setSending(true);
    setMessage("");

    const optimisticUser = { role: "user" as const, content: msg };
    setThread(prev => [...prev, optimisticUser]);

    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/ai/creation-agent`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: activeSessionId,
          message: msg,
          entityType: selectedEntityType ?? "unknown",
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "AI request failed");
      }

      const data: AgentResponse = await res.json();
      setActiveSessionId(data.sessionId);
      setPartialEntity(data.partialEntity);
      if (data.entitySummary) setLastEntitySummary(data.entitySummary);
      if (!selectedEntityType && data.partialEntity._entityType) {
        setSelectedEntityType(data.partialEntity._entityType);
      }

      setThread(prev => [
        ...prev,
        {
          role: "assistant",
          content: data.message,
          conflictWarning: data.conflictWarning,
          readyToCreate: data.readyToCreate,
        },
      ]);
      queryClient.invalidateQueries({ queryKey: ["ai-creation-sessions"] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setThread(prev => prev.slice(0, -1));
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  async function confirmCreate() {
    if (!activeSessionId) return;
    setCreating(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/ai/creation-agent/create`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: activeSessionId,
          confirmedEntity: { ...partialEntity, ...(lastEntitySummary ?? {}) },
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Create failed");
      }

      const data = await res.json();
      toast({ title: "Created!", description: data.message });
      setThread(prev => [
        ...prev,
        { role: "assistant", content: data.message, readyToCreate: false },
      ]);
      setPartialEntity({});
      setLastEntitySummary(null);
      queryClient.invalidateQueries({ queryKey: ["ai-creation-sessions"] });
    } catch (err: any) {
      toast({ title: "Creation failed", description: err.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  async function applyEdit() {
    if (!activeSessionId) return;
    setCreating(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/ai/creation-agent/apply-edit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: activeSessionId,
          confirmedEntity: { ...partialEntity, ...(lastEntitySummary ?? {}) },
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Apply changes failed");
      }

      const data = await res.json();
      toast({ title: "Changes applied!", description: data.message });
      setThread(prev => [
        ...prev,
        { role: "assistant", content: data.message, readyToCreate: false },
      ]);
      setOriginalEntity(data.updated ?? null);
      setIsEditMode(false);
      queryClient.invalidateQueries({ queryKey: ["ai-creation-sessions"] });
    } catch (err: any) {
      toast({ title: "Failed to apply changes", description: err.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  async function loadForEdit(entityType: string, entityId: number) {
    setSending(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/ai/creation-agent/load-for-edit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ entityType, entityId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to load entity for editing");
      }
      const data: AgentResponse = await res.json();
      setActiveSessionId(data.sessionId);
      setSelectedEntityType(entityType);
      setPartialEntity(data.partialEntity);
      setOriginalEntity(data.currentEntity ?? null);
      setIsEditMode(true);
      setShowEditPicker(false);
      setThread([{ role: "assistant", content: data.message }]);
      queryClient.invalidateQueries({ queryKey: ["ai-creation-sessions"] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  async function deleteSession(id: number) {
    const token = await getToken();
    await fetch(`${API_BASE}/admin/ai/creation-sessions/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    queryClient.invalidateQueries({ queryKey: ["ai-creation-sessions"] });
    if (activeSessionId === id) startNew();
  }

  async function loadSession(id: number) {
    const token = await getToken();
    const res = await fetch(`${API_BASE}/admin/ai/creation-sessions/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data: SessionDetail = await res.json();

    setActiveSessionId(data.id);
    setSelectedEntityType(data.entityType !== "unknown" ? data.entityType : null);
    setPartialEntity(data.partialEntity);
    setIsEditMode(data.status === "editing");
    setOriginalEntity(null);
    setThread(data.thread.map(m => ({ role: m.role, content: m.content })));
    setShowHistory(false);
  }

  function startNew() {
    setActiveSessionId(null);
    setSelectedEntityType(null);
    setThread([]);
    setPartialEntity({});
    setLastEntitySummary(null);
    setOriginalEntity(null);
    setIsEditMode(false);
    setMessage("");
    setShowHistory(false);
    setShowEditPicker(false);
  }

  function selectEntityType(id: string) {
    setSelectedEntityType(id);
    const entityInfo = ENTITY_TYPES.find(e => e.id === id);
    const greeting = `I'd like to create a new ${entityInfo?.label ?? id}.`;
    sendMessage(greeting);
  }

  const lastReadyToCreate = thread.length > 0 && thread[thread.length - 1]?.readyToCreate;
  const hasConversation = thread.length > 0;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">AI Assistant</h1>
              <p className="text-sm text-muted-foreground">Create or edit leagues, tournaments, camps, memberships & more through conversation</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowHistory(!showHistory)}>
              <History className="h-4 w-4 mr-1.5" />
              History
              {sessions && sessions.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-xs">{sessions.length}</Badge>
              )}
            </Button>
            {hasConversation && (
              <Button variant="outline" size="sm" onClick={startNew}>
                <Plus className="h-4 w-4 mr-1.5" />
                New
              </Button>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin">← Admin</Link>
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-220px)] min-h-[500px]">
          {/* LEFT: Chat panel */}
          <div className="lg:col-span-2 flex flex-col bg-background border rounded-xl overflow-hidden">
            {/* Chat messages */}
            <div className="flex-1 overflow-y-auto p-4">
              {!hasConversation && !showHistory && !showEditPicker && (
                <div className="h-full flex flex-col items-center justify-center">
                  {!selectedEntityType ? (
                    <>
                      <Bot className="h-10 w-10 text-primary mb-3 opacity-60" />
                      <p className="text-sm font-medium mb-1">What would you like to do?</p>
                      <p className="text-xs text-muted-foreground mb-6">Create a new record, or edit an existing one</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 w-full max-w-lg mb-4">
                        {ENTITY_TYPES.map(et => {
                          const Icon = et.icon;
                          return (
                            <button
                              key={et.id}
                              onClick={() => selectEntityType(et.id)}
                              className="flex flex-col items-center gap-2 p-3 rounded-xl border hover:border-primary hover:bg-primary/5 transition-all text-center group"
                            >
                              <div className={`p-2 rounded-lg ${et.bg}`}>
                                <Icon className={`h-4 w-4 ${et.color}`} />
                              </div>
                              <span className="text-xs font-medium">{et.label}</span>
                            </button>
                          );
                        })}
                      </div>
                      <button
                        onClick={() => setShowEditPicker(true)}
                        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground border border-dashed rounded-lg px-4 py-2 transition-colors"
                      >
                        <Pencil className="h-4 w-4" />
                        Edit an existing record instead
                      </button>
                    </>
                  ) : (
                    <div className="text-center">
                      <Sparkles className="h-8 w-8 text-primary mx-auto mb-2 opacity-60" />
                      <p className="text-sm text-muted-foreground">Starting conversation…</p>
                    </div>
                  )}
                </div>
              )}

              {showEditPicker && !hasConversation && (
                <div className="h-full flex flex-col">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-sm font-semibold">Edit Existing Record</p>
                    <Button size="sm" variant="ghost" onClick={() => setShowEditPicker(false)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <EditEntityPicker onLoad={loadForEdit} />
                </div>
              )}

              {showHistory && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold">Session History</p>
                    <Button size="sm" variant="ghost" onClick={() => setShowHistory(false)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  {sessionsLoading && <Skeleton className="h-24" />}
                  {!sessionsLoading && !sessions?.length && (
                    <p className="text-sm text-muted-foreground text-center py-8">No sessions yet.</p>
                  )}
                  {sessions?.map(s => {
                    const badge = STATUS_BADGE[s.status] ?? { label: s.status, variant: "secondary" as const };
                    return (
                      <div key={s.id} className="flex items-center justify-between gap-2 p-3 border rounded-lg hover:bg-muted/30 cursor-pointer group" onClick={() => loadSession(s.id)}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <Badge variant="outline" className="text-xs capitalize">{s.entityType}</Badge>
                            <Badge variant={badge.variant} className="text-xs">{badge.label}</Badge>
                            {s.createdEntityType && <Badge variant="secondary" className="text-xs">→ {s.createdEntityType} #{s.createdEntityId}</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground">{format(new Date(s.updatedAt), "MMM d, h:mm a")}</p>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {hasConversation && !showHistory && (
                <div className="space-y-1">
                  {isEditMode && (
                    <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2 mb-3">
                      <Pencil className="h-3.5 w-3.5 shrink-0" />
                      <span>Edit mode — changes will be applied to the existing {selectedEntityType} #{partialEntity._editTargetId}</span>
                    </div>
                  )}
                  {thread.map((msg, i) => (
                    <MessageBubble
                      key={i}
                      role={msg.role}
                      content={msg.content}
                      conflictWarning={msg.conflictWarning}
                      readyToCreate={msg.readyToCreate && i === thread.length - 1}
                      isEditMode={isEditMode}
                      onConfirmCreate={confirmCreate}
                      onApplyEdit={applyEdit}
                    />
                  ))}
                  {(sending || creating) && (
                    <div className="flex justify-start mb-3">
                      <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center mr-2 mt-0.5 shrink-0">
                        <Bot className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-2.5">
                        <span className="inline-flex gap-1">
                          <span className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                          <span className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                        </span>
                      </div>
                    </div>
                  )}
                  <div ref={bottomRef} />
                </div>
              )}
            </div>

            {/* Input area */}
            <div className="border-t p-3 bg-background/80">
              <div className="flex gap-2 items-end">
                <Textarea
                  ref={inputRef}
                  className="flex-1 resize-none min-h-[44px] max-h-28 text-sm"
                  placeholder={
                    isEditMode
                      ? "Describe what to change…"
                      : selectedEntityType
                      ? "Continue the conversation…"
                      : "Describe what you want to create…"
                  }
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  rows={1}
                  disabled={sending || creating}
                />
                <Button
                  size="sm"
                  className="h-10 w-10 p-0 shrink-0"
                  onClick={() => sendMessage()}
                  disabled={!message.trim() || sending || creating}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5 text-center">
                Press Enter to send · Shift+Enter for new line
              </p>
            </div>
          </div>

          {/* RIGHT: Entity preview panel */}
          <div className="flex flex-col gap-4">
            <Card className="flex-1 overflow-hidden">
              <CardHeader className="pb-3 pt-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  {isEditMode ? <Pencil className="h-4 w-4 text-amber-500" /> : <Sparkles className="h-4 w-4 text-primary" />}
                  {isEditMode ? "Proposed Changes" : "Live Preview"}
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-y-auto max-h-[calc(100%-60px)]">
                <EntityPreview
                  partialEntity={partialEntity}
                  entityType={selectedEntityType ?? "unknown"}
                  originalEntity={isEditMode ? originalEntity : null}
                />
              </CardContent>
            </Card>

            {/* Quick actions */}
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Quick Tips</p>
                <div className="space-y-2 text-xs text-muted-foreground">
                  {isEditMode ? (
                    <>
                      <p>• Tell the AI what field to change and the new value</p>
                      <p>• The preview shows old vs new values in amber</p>
                      <p>• Confirm before applying — changes go directly to the DB</p>
                      <p>• Date or capacity changes may require fixture review</p>
                    </>
                  ) : (
                    <>
                      <p>• The AI checks for scheduling conflicts in real time</p>
                      <p>• Say "use court 2" or "adult format" naturally</p>
                      <p>• Ask to change any field before confirming</p>
                      <p>• Sessions are auto-saved — resume anytime</p>
                    </>
                  )}
                  {lastReadyToCreate && (
                    <div className="mt-3 pt-3 border-t">
                      <Button
                        className={`w-full h-9 text-sm gap-2 ${isEditMode ? "bg-amber-600 hover:bg-amber-700" : ""}`}
                        onClick={isEditMode ? applyEdit : confirmCreate}
                        disabled={creating}
                      >
                        {isEditMode ? <Pencil className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                        {creating
                          ? (isEditMode ? "Applying…" : "Creating…")
                          : (isEditMode ? "Apply Changes" : "Confirm & Create")}
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </Layout>
  );
}
