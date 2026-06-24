import React from "react";
import { Link, Redirect } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { GraduationCap, CheckCircle2, Circle, ChevronRight, Clock, BookOpen } from "lucide-react";
import { TRAINING_SECTIONS, REQUIRED_SECTIONS } from "@/data/trainingContent";
import { format } from "date-fns";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

interface TrainingStatus {
  isComplete: boolean;
  trainingCompletedAt: string | null;
  requiredSections: number[];
  progress: Record<string, { passed: boolean; score: number; total: number; completedAt: string }>;
  roles: string[];
}

export default function StaffTraining() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();

  const roles: string[] = (profile as any)?.roles ?? [];
  const isRefOrSK = roles.includes("ref") || roles.includes("scorekeeper");

  const { data: trainingStatus, isLoading: statusLoading } = useQuery<TrainingStatus>({
    queryKey: ["training-status"],
    enabled: !profileLoading && isRefOrSK,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/training/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load training status");
      return res.json();
    },
  });

  if (profileLoading || statusLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-12 max-w-2xl">
          <Skeleton className="h-10 w-64 mb-4" />
          <div className="space-y-4">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}
          </div>
        </div>
      </Layout>
    );
  }

  if (!isRefOrSK) return <Redirect to="/dashboard" />;

  const required = trainingStatus?.requiredSections ?? [];
  const progress = trainingStatus?.progress ?? {};

  const allSections = TRAINING_SECTIONS.filter((s) => required.includes(s.id));
  const completedCount = allSections.filter((s) => progress[String(s.id)]?.passed).length;
  const isAllDone = trainingStatus?.isComplete;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-2xl">
        <div className="mb-8 flex items-start gap-3">
          <GraduationCap className="h-8 w-8 text-primary mt-0.5 shrink-0" />
          <div>
            <h1 className="text-3xl font-bold font-sans uppercase tracking-tight text-primary">
              Rules Training
            </h1>
            <p className="text-muted-foreground mt-1">
              Complete all sections to confirm your training. Sections can be retaken at any time.
            </p>
          </div>
        </div>

        {isAllDone && trainingStatus?.trainingCompletedAt && (
          <div className="mb-6 rounded-xl bg-green-500/10 border border-green-500/30 p-4 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
            <div>
              <p className="font-semibold text-green-700">Training Complete</p>
              <p className="text-sm text-muted-foreground">
                Completed {format(new Date(trainingStatus.trainingCompletedAt), "MMMM d, yyyy")}
              </p>
            </div>
          </div>
        )}

        {!isAllDone && (
          <div className="mb-6 rounded-xl bg-amber-500/10 border border-amber-500/30 p-4 flex items-center gap-3">
            <Clock className="h-5 w-5 text-amber-500 shrink-0" />
            <div>
              <p className="font-semibold text-amber-700">
                {completedCount} of {allSections.length} section{allSections.length !== 1 ? "s" : ""} complete
              </p>
              <p className="text-sm text-muted-foreground">
                Pass all required sections (80%+ each) to complete your training.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {allSections.map((section) => {
            const sectionProgress = progress[String(section.id)];
            const isPassed = sectionProgress?.passed === true;
            const isFailed = sectionProgress && !sectionProgress.passed;

            return (
              <Card
                key={section.id}
                className={`transition-colors ${isPassed ? "border-green-500/40 bg-green-500/5" : isFailed ? "border-red-500/30" : ""}`}
              >
                <CardContent className="pt-5 pb-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="mt-0.5 shrink-0">
                        {isPassed ? (
                          <CheckCircle2 className="h-5 w-5 text-green-500" />
                        ) : (
                          <Circle className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Section {section.id}
                          </span>
                          {isPassed && (
                            <span className="text-[11px] font-semibold bg-green-500/15 text-green-700 border border-green-500/30 px-2 py-0.5 rounded-full">
                              Passed — {sectionProgress.score}/{sectionProgress.total}
                            </span>
                          )}
                          {isFailed && (
                            <span className="text-[11px] font-semibold bg-red-500/15 text-red-700 border border-red-500/30 px-2 py-0.5 rounded-full">
                              Not passed — {sectionProgress!.score}/{sectionProgress!.total}
                            </span>
                          )}
                        </div>
                        <h3 className="font-semibold text-base mt-0.5">{section.title}</h3>
                        <p className="text-sm text-muted-foreground">{section.subtitle}</p>
                        <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground">
                          <BookOpen className="h-3.5 w-3.5" />
                          <span>{section.cards.length} rule cards · {section.questions.length} questions</span>
                        </div>
                      </div>
                    </div>
                    <Link href={`/staff/training/${section.id}`}>
                      <Button
                        size="sm"
                        variant={isPassed ? "outline" : "default"}
                        className="shrink-0 gap-1.5"
                      >
                        {isPassed ? "Review" : isFailed ? "Retake" : "Start"}
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="mt-8 text-center">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm">← Back to Dashboard</Button>
          </Link>
        </div>
      </div>
    </Layout>
  );
}
