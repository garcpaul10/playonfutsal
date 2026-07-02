import React, { useState } from "react";
import { Redirect } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { format } from "date-fns";
import {
  FileText, Plus, CheckCircle, Clock, AlertTriangle,
  ChevronDown, ChevronRight, Pen, Type, RefreshCw,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const API = (import.meta.env.VITE_API_URL ?? "https://workspaceapi-server-production-3488.up.railway.app").replace(/\/$/, "") + "/api";

interface WaiverTemplate {
  id: number;
  name: string;
  version: number;
  body: string;
  applicableTo: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface WaiverSignatureRow {
  id: number;
  templateId: number;
  userId: number | null;
  youthUserId: number | null;
  signedAt: string;
  expiresAt: string | null;
  signatureType: string;
  ipAddress: string | null;
  user: { id: number; firstName: string | null; lastName: string | null; email: string } | null;
  youthUser: { id: number; firstName: string | null; lastName: string | null } | null;
  templateVersion: number | null;
  templateName: string | null;
  isExpired: boolean;
}

function VersionBadge({ isActive }: { isActive: boolean }) {
  if (isActive) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800 font-medium">
        <CheckCircle className="w-3 h-3" /> Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
      <Clock className="w-3 h-3" /> Archived
    </span>
  );
}

function NewVersionForm({ onSave, onCancel, defaultName = "", defaultBody = "" }: {
  onSave: (name: string, body: string) => void;
  onCancel: () => void;
  defaultName?: string;
  defaultBody?: string;
}) {
  const [name, setName] = useState(defaultName);
  const [body, setBody] = useState(defaultBody);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">Waiver name</label>
        <input
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. PlayOn Liability Waiver & Release"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">Waiver body text</label>
        <textarea
          className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary min-h-[320px] resize-y"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Enter the full waiver text here…"
        />
      </div>
      <div className="flex gap-2">
        <Button
          onClick={() => onSave(name.trim(), body.trim())}
          disabled={!name.trim() || !body.trim()}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          Publish new version
        </Button>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

export default function AdminWaivers() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const [showNewForm, setShowNewForm] = useState(false);
  const [expandedTemplateId, setExpandedTemplateId] = useState<number | null>(null);

  const { data: templates, isLoading: templatesLoading } = useQuery<WaiverTemplate[]>({
    queryKey: ["admin", "waivers", "templates"],
    enabled: !profileLoading && (profile?.role === "admin" || profile?.adminLevel === "super" || profile?.adminLevel === "admin"),
    queryFn: async () => {
      const token = await getToken();
      const r = await fetch(`${API}/admin/waivers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error("Failed to load waiver templates");
      return r.json();
    },
  });

  const { data: signatures, isLoading: sigsLoading } = useQuery<WaiverSignatureRow[]>({
    queryKey: ["admin", "waivers", "signatures"],
    enabled: !profileLoading && (profile?.role === "admin" || profile?.adminLevel === "super" || profile?.adminLevel === "admin"),
    queryFn: async () => {
      const token = await getToken();
      const r = await fetch(`${API}/admin/waivers/signatures`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error("Failed to load signatures");
      return r.json();
    },
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const r = await fetch(`${API}/waivers/seed`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error("Failed to seed waiver");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "waivers"] });
    },
  });

  const createVersion = useMutation({
    mutationFn: async ({ name, body }: { name: string; body: string }) => {
      const token = await getToken();
      const r = await fetch(`${API}/admin/waivers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name, body }),
      });
      if (!r.ok) throw new Error("Failed to create version");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "waivers"] });
      setShowNewForm(false);
    },
  });

  if (profileLoading) {
    return (
      <Layout>
        <div className="p-12">
          <Skeleton className="h-64" />
        </div>
      </Layout>
    );
  }
  if (!profile || (profile.role !== "admin" && profile.adminLevel !== "super" && profile.adminLevel !== "admin")) return <Redirect to="/dashboard" />;

  const activeTemplate = templates?.find((t) => t.isActive);
  const hasTemplates = (templates?.length ?? 0) > 0;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-5xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold font-sans uppercase tracking-tight text-primary">
              Waiver Management
            </h1>
            <p className="text-muted-foreground mt-1">
              Edit & version the liability waiver · view all signed records
            </p>
          </div>
          <Button variant="outline" onClick={() => history.back()}>
            Back to Admin
          </Button>
        </div>

        {!hasTemplates && !templatesLoading && (
          <Card className="mb-6 border-amber-200 bg-amber-50">
            <CardContent className="pt-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="font-semibold text-amber-800">No waiver template found</p>
                  <p className="text-amber-700 text-sm mt-1">
                    Seed the default waiver document to get started. This loads the original liability text into the database as version 1.
                  </p>
                  <Button
                    className="mt-3 bg-amber-600 hover:bg-amber-700 text-white"
                    disabled={seedMutation.isPending}
                    onClick={() => seedMutation.mutate()}
                  >
                    {seedMutation.isPending ? "Seeding…" : "Seed default waiver"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="templates">
          <TabsList className="mb-6">
            <TabsTrigger value="templates">
              <FileText className="w-4 h-4 mr-1.5" />
              Document versions
            </TabsTrigger>
            <TabsTrigger value="signatures">
              <CheckCircle className="w-4 h-4 mr-1.5" />
              Signature log
              {signatures && signatures.length > 0 && (
                <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
                  {signatures.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="templates" className="space-y-4">
            {activeTemplate && !showNewForm && (
              <Card className="border-green-200 bg-green-50">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base text-green-800">{activeTemplate.name}</CardTitle>
                      <p className="text-xs text-green-700 mt-0.5">
                        Version {activeTemplate.version} · Published {format(new Date(activeTemplate.createdAt), "MMM d, yyyy")}
                      </p>
                    </div>
                    <VersionBadge isActive={true} />
                  </div>
                </CardHeader>
                <CardContent>
                  <div
                    className="text-xs text-green-900 leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto bg-white/60 rounded p-3 border border-green-200 cursor-pointer"
                    onClick={() => setExpandedTemplateId(expandedTemplateId === activeTemplate.id ? null : activeTemplate.id)}
                  >
                    {expandedTemplateId === activeTemplate.id
                      ? activeTemplate.body
                      : activeTemplate.body.slice(0, 300) + (activeTemplate.body.length > 300 ? "…" : "")}
                  </div>
                  {activeTemplate.body.length > 300 && (
                    <button
                      className="text-xs text-green-700 mt-1 hover:underline"
                      onClick={() => setExpandedTemplateId(expandedTemplateId === activeTemplate.id ? null : activeTemplate.id)}
                    >
                      {expandedTemplateId === activeTemplate.id ? "Collapse" : "Read full text"}
                    </button>
                  )}
                </CardContent>
              </Card>
            )}

            {showNewForm ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Plus className="w-4 h-4" /> Publish new version
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Publishing this version will archive the current active waiver. All existing signatures remain linked to the version they were signed against.
                  </p>
                </CardHeader>
                <CardContent>
                  <NewVersionForm
                    defaultName={activeTemplate ? `${activeTemplate.name}` : ""}
                    defaultBody={activeTemplate?.body ?? ""}
                    onSave={(name, body) => createVersion.mutate({ name, body })}
                    onCancel={() => setShowNewForm(false)}
                  />
                  {createVersion.isError && (
                    <p className="text-red-600 text-sm mt-2">Failed to publish. Please try again.</p>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Button
                onClick={() => setShowNewForm(true)}
                disabled={!hasTemplates}
                className="flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Publish new version
              </Button>
            )}

            {templatesLoading ? (
              <div className="space-y-2">
                {[1, 2].map((i) => <Skeleton key={i} className="h-16" />)}
              </div>
            ) : (
              <div className="space-y-2">
                {(templates ?? []).filter((t) => !t.isActive).map((t) => (
                  <Card key={t.id} className="opacity-70">
                    <CardContent className="pt-4 pb-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">{t.name}</p>
                          <p className="text-xs text-muted-foreground">
                            Version {t.version} · Archived {format(new Date(t.updatedAt), "MMM d, yyyy")}
                          </p>
                        </div>
                        <VersionBadge isActive={false} />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="signatures">
            {sigsLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16" />)}
              </div>
            ) : (signatures?.length ?? 0) === 0 ? (
              <p className="text-muted-foreground text-center py-12">No signatures on file yet.</p>
            ) : (
              <div className="space-y-2">
                {(signatures ?? []).map((s) => {
                  const signerName = s.user
                    ? `${s.user.firstName ?? ""} ${s.user.lastName ?? ""}`.trim() || s.user.email
                    : `User #${s.userId}`;
                  const youthName = s.youthUser
                    ? `${s.youthUser.firstName ?? ""} ${s.youthUser.lastName ?? ""}`.trim()
                    : null;

                  return (
                    <Card key={s.id} className={s.isExpired ? "opacity-60" : ""}>
                      <CardContent className="pt-4 pb-3">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-sm truncate">{signerName}</p>
                              {youthName && (
                                <span className="text-xs text-muted-foreground">
                                  (for child: {youthName})
                                </span>
                              )}
                              {s.signatureType === "drawn" ? (
                                <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                                  <Pen className="w-2.5 h-2.5" /> Drawn
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                                  <Type className="w-2.5 h-2.5" /> Typed
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 flex-wrap mt-1">
                              <p className="text-xs text-muted-foreground">
                                Signed {format(new Date(s.signedAt), "MMM d, yyyy 'at' h:mm a")}
                              </p>
                              {s.templateName && (
                                <span className="text-xs text-muted-foreground">
                                  · {s.templateName} v{s.templateVersion}
                                </span>
                              )}
                              {s.expiresAt && (
                                <span className={`text-xs ${s.isExpired ? "text-red-600" : "text-muted-foreground"}`}>
                                  · {s.isExpired ? "Expired" : "Expires"} {format(new Date(s.expiresAt), "MMM d, yyyy")}
                                </span>
                              )}
                            </div>
                          </div>
                          {s.isExpired ? (
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium shrink-0">
                              <AlertTriangle className="w-3 h-3" /> Expired
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium shrink-0">
                              <CheckCircle className="w-3 h-3" /> Valid
                            </span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
