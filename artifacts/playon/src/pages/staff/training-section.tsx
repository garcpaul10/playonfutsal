import { API_BASE } from "@/lib/api-base";
import React, { useState } from "react";
import { Link, Redirect, useParams } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import {
  ChevronLeft, ChevronRight, CheckCircle2, XCircle, BookOpen,
  GraduationCap, ArrowLeft, RotateCcw, Trophy,
} from "lucide-react";
import { TRAINING_SECTIONS, PASSING_SCORE } from "@/data/trainingContent";


type Phase = "reading" | "quiz" | "result";

interface TrainingStatus {
  isComplete: boolean;
  requiredSections: number[];
  progress: Record<string, { passed: boolean; score: number; total: number; completedAt: string }>;
}

export default function TrainingSectionPage() {
  const { id } = useParams<{ id: string }>();
  const sectionId = parseInt(id ?? "", 10);

  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const roles: string[] = (profile as any)?.roles ?? [];
  const isRefOrSK = roles.includes("ref") || roles.includes("scorekeeper");

  const section = TRAINING_SECTIONS.find((s) => s.id === sectionId);

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

  const [phase, setPhase] = useState<Phase>("reading");
  const [cardIndex, setCardIndex] = useState(0);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [quizResult, setQuizResult] = useState<{ passed: boolean; score: number; total: number } | null>(null);

  const submitSection = useMutation({
    mutationFn: async ({ score, total }: { score: number; total: number }) => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/training/section-complete`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sectionId, score, total }),
      });
      if (!res.ok) throw new Error("Failed to record section result");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["training-status"] });
    },
  });

  if (profileLoading || statusLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-12 max-w-2xl">
          <Skeleton className="h-8 w-48 mb-6" />
          <Skeleton className="h-64" />
        </div>
      </Layout>
    );
  }

  if (!isRefOrSK || !section) return <Redirect to="/staff/training" />;

  const required = trainingStatus?.requiredSections ?? [];
  if (!required.includes(sectionId)) return <Redirect to="/staff/training" />;

  const cards = section.cards;
  const questions = section.questions;
  const currentCard = cards[cardIndex];
  const currentQuestion = questions[questionIndex];

  function handleNextCard() {
    if (cardIndex < cards.length - 1) {
      setCardIndex((i) => i + 1);
    } else {
      setPhase("quiz");
      setQuestionIndex(0);
      setSelectedAnswer(null);
      setSubmitted(false);
      setCorrectCount(0);
    }
  }

  function handlePrevCard() {
    if (cardIndex > 0) setCardIndex((i) => i - 1);
  }

  function handleSubmitAnswer() {
    if (selectedAnswer === null) return;
    setSubmitted(true);
    if (selectedAnswer === currentQuestion.correctIndex) {
      setCorrectCount((c) => c + 1);
    }
  }

  function handleNextQuestion() {
    const isLast = questionIndex === questions.length - 1;
    if (!isLast) {
      setQuestionIndex((i) => i + 1);
      setSelectedAnswer(null);
      setSubmitted(false);
    } else {
      const finalCorrect = selectedAnswer === currentQuestion.correctIndex ? correctCount + 1 : correctCount;
      const total = questions.length;
      const passed = finalCorrect / total >= PASSING_SCORE;
      setQuizResult({ passed, score: finalCorrect, total });
      setPhase("result");
      submitSection.mutate({ score: finalCorrect, total });
    }
  }

  function handleRetake() {
    setPhase("reading");
    setCardIndex(0);
    setQuestionIndex(0);
    setSelectedAnswer(null);
    setSubmitted(false);
    setCorrectCount(0);
    setQuizResult(null);
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-2xl">
        <div className="flex items-center gap-2 mb-6">
          <Link href="/staff/training">
            <Button variant="ghost" size="sm" className="gap-1.5">
              <ArrowLeft className="h-4 w-4" /> Training
            </Button>
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-medium">{section.title}</span>
        </div>

        {phase === "reading" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Section {section.id} — Reading Material
                </p>
                <h1 className="text-2xl font-bold text-primary">{section.title}</h1>
              </div>
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <BookOpen className="h-4 w-4" />
                <span>{cardIndex + 1} / {cards.length}</span>
              </div>
            </div>

            <div className="w-full bg-muted rounded-full h-1.5">
              <div
                className="bg-primary h-1.5 rounded-full transition-all"
                style={{ width: `${((cardIndex + 1) / cards.length) * 100}%` }}
              />
            </div>

            <Card className="min-h-[260px]">
              <CardContent className="pt-6 pb-6">
                <h2 className="text-lg font-bold mb-3">{currentCard.title}</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">{currentCard.body}</p>
                {currentCard.playonNote && (
                  <div className="mt-4 rounded-lg bg-primary/10 border border-primary/20 px-4 py-3">
                    <p className="text-xs font-bold text-primary uppercase tracking-wide mb-1">PlayOn Note</p>
                    <p className="text-sm text-foreground leading-relaxed">{currentCard.playonNote}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex justify-between gap-3">
              <Button
                variant="outline"
                onClick={handlePrevCard}
                disabled={cardIndex === 0}
                className="gap-1.5"
              >
                <ChevronLeft className="h-4 w-4" /> Previous
              </Button>
              <Button onClick={handleNextCard} className="gap-1.5">
                {cardIndex < cards.length - 1 ? (
                  <>Next <ChevronRight className="h-4 w-4" /></>
                ) : (
                  <>Start Quiz <GraduationCap className="h-4 w-4" /></>
                )}
              </Button>
            </div>

            <div className="flex gap-1 justify-center flex-wrap pt-1">
              {cards.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCardIndex(i)}
                  className={`h-2 w-2 rounded-full transition-colors ${i === cardIndex ? "bg-primary" : i < cardIndex ? "bg-primary/40" : "bg-muted-foreground/30"}`}
                  aria-label={`Card ${i + 1}`}
                />
              ))}
            </div>
          </div>
        )}

        {phase === "quiz" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Section {section.id} — Knowledge Check
                </p>
                <h1 className="text-2xl font-bold text-primary">{section.title}</h1>
              </div>
              <div className="text-sm text-muted-foreground">
                {questionIndex + 1} / {questions.length}
              </div>
            </div>

            <div className="w-full bg-muted rounded-full h-1.5">
              <div
                className="bg-primary h-1.5 rounded-full transition-all"
                style={{ width: `${((questionIndex + (submitted ? 1 : 0)) / questions.length) * 100}%` }}
              />
            </div>

            <Card>
              <CardContent className="pt-6 pb-6">
                <p className="font-semibold text-base mb-5 leading-snug">{currentQuestion.question}</p>
                <div className="space-y-2">
                  {currentQuestion.options.map((opt, i) => {
                    let cls = "flex items-start gap-3 p-3 rounded-lg border text-sm cursor-pointer transition-colors text-left w-full ";
                    if (!submitted) {
                      cls += selectedAnswer === i
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-primary/40 hover:bg-muted/50";
                    } else {
                      if (i === currentQuestion.correctIndex) {
                        cls += "border-green-500 bg-green-500/10 text-green-700";
                      } else if (i === selectedAnswer && selectedAnswer !== currentQuestion.correctIndex) {
                        cls += "border-red-500 bg-red-500/10 text-red-700";
                      } else {
                        cls += "border-border opacity-50";
                      }
                    }

                    return (
                      <button
                        key={i}
                        type="button"
                        className={cls}
                        onClick={() => !submitted && setSelectedAnswer(i)}
                        disabled={submitted}
                      >
                        <span className={`shrink-0 w-5 h-5 rounded-full border flex items-center justify-center text-xs font-bold mt-0.5 ${
                          !submitted && selectedAnswer === i ? "border-primary bg-primary text-white" :
                          submitted && i === currentQuestion.correctIndex ? "border-green-500 bg-green-500 text-white" :
                          submitted && i === selectedAnswer ? "border-red-500 bg-red-500 text-white" :
                          "border-muted-foreground/40"
                        }`}>
                          {String.fromCharCode(65 + i)}
                        </span>
                        <span className="leading-snug">{opt}</span>
                      </button>
                    );
                  })}
                </div>

                {submitted && (
                  <div className={`mt-4 rounded-lg p-3 ${selectedAnswer === currentQuestion.correctIndex ? "bg-green-500/10 border border-green-500/30" : "bg-amber-500/10 border border-amber-500/30"}`}>
                    <div className="flex items-center gap-2 mb-1">
                      {selectedAnswer === currentQuestion.correctIndex
                        ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                        : <XCircle className="h-4 w-4 text-amber-500 shrink-0" />
                      }
                      <span className={`text-sm font-semibold ${selectedAnswer === currentQuestion.correctIndex ? "text-green-700" : "text-amber-700"}`}>
                        {selectedAnswer === currentQuestion.correctIndex ? "Correct!" : "Not quite"}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">{currentQuestion.explanation}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex justify-between gap-3">
              <Button
                variant="outline"
                onClick={() => setPhase("reading")}
                className="gap-1.5"
              >
                <ArrowLeft className="h-4 w-4" /> Re-read Material
              </Button>
              {!submitted ? (
                <Button onClick={handleSubmitAnswer} disabled={selectedAnswer === null}>
                  Submit Answer
                </Button>
              ) : (
                <Button onClick={handleNextQuestion} className="gap-1.5">
                  {questionIndex < questions.length - 1 ? (
                    <>Next Question <ChevronRight className="h-4 w-4" /></>
                  ) : (
                    <>See Results <Trophy className="h-4 w-4" /></>
                  )}
                </Button>
              )}
            </div>
          </div>
        )}

        {phase === "result" && quizResult && (
          <div className="space-y-6 text-center">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Section {section.id} — Results
              </p>
              <h1 className="text-2xl font-bold text-primary">{section.title}</h1>
            </div>

            <div className={`rounded-2xl p-8 ${quizResult.passed ? "bg-green-500/10 border border-green-500/30" : "bg-red-500/10 border border-red-500/30"}`}>
              {quizResult.passed ? (
                <CheckCircle2 className="h-14 w-14 text-green-500 mx-auto mb-4" />
              ) : (
                <XCircle className="h-14 w-14 text-red-500 mx-auto mb-4" />
              )}
              <p className={`text-2xl font-bold mb-1 ${quizResult.passed ? "text-green-700" : "text-red-700"}`}>
                {quizResult.passed ? "Section Passed!" : "Not Passed"}
              </p>
              <p className="text-4xl font-black mb-2">
                {quizResult.score}/{quizResult.total}
              </p>
              <p className="text-muted-foreground text-sm">
                {Math.round((quizResult.score / quizResult.total) * 100)}% correct · Need 80% to pass
              </p>
            </div>

            {quizResult.passed ? (
              <div className="space-y-3">
                <p className="text-muted-foreground text-sm">
                  Great work! Your progress has been saved.
                </p>
                <div className="flex flex-col sm:flex-row justify-center gap-3">
                  <Button onClick={handleRetake} variant="outline" className="gap-1.5">
                    <RotateCcw className="h-4 w-4" /> Review Again
                  </Button>
                  <Link href="/staff/training">
                    <Button className="gap-1.5 w-full sm:w-auto">
                      Back to Training Hub <ChevronRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-muted-foreground text-sm">
                  Review the material and try again — you can retake as many times as you need.
                </p>
                <div className="flex flex-col sm:flex-row justify-center gap-3">
                  <Button onClick={handleRetake} className="gap-1.5">
                    <RotateCcw className="h-4 w-4" /> Re-read & Retake
                  </Button>
                  <Link href="/staff/training">
                    <Button variant="outline" className="gap-1.5 w-full sm:w-auto">
                      Training Hub
                    </Button>
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
