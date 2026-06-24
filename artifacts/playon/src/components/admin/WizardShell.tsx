import React from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Save, ChevronLeft, Rocket, Clock } from "lucide-react";

interface WizardShellProps {
  title: string;
  backHref: string;
  steps: string[];
  step: number;
  setStep: (s: number | ((prev: number) => number)) => void;
  children: React.ReactNode;
  canProceed?: boolean;
  isLastStep?: boolean;
  onSaveDraft?: () => void;
  isSaving?: boolean;
  restoredFromDraft?: boolean;
  onDiscardDraft?: () => void;
  /** When provided on the last step, renders a standardized Publish Now button. */
  onPublish?: () => void;
  /** Custom label for the publish button (default: "Publish Now"). */
  publishLabel?: string;
  /** When provided on the last step, renders a Schedule Registration button. */
  onSchedulePublish?: () => void;
  /** Disables both publish actions (e.g. while saving or when required fields are missing). */
  publishDisabled?: boolean;
}

export function WizardShell({
  title,
  backHref,
  steps,
  step,
  setStep,
  children,
  canProceed = true,
  isLastStep = false,
  onSaveDraft,
  isSaving = false,
  restoredFromDraft = false,
  onDiscardDraft,
  onPublish,
  publishLabel,
  onSchedulePublish,
  publishDisabled = false,
}: WizardShellProps) {
  const isFirstStep = step === 0;
  const showPublishFooter = isLastStep && (onPublish || onSchedulePublish);

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card px-6 py-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <Link href={backHref}>
              <button type="button" className="text-muted-foreground hover:text-foreground transition-colors">
                <ChevronLeft className="h-5 w-5" />
              </button>
            </Link>
            <h1 className="font-bold text-lg">{title}</h1>
            <span className="ml-auto text-xs text-muted-foreground font-medium">
              Step {step + 1} of {steps.length}
            </span>
          </div>
          <div className="flex gap-1">
            {steps.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => (i < step ? setStep(i) : undefined)}
                className={[
                  "flex-1 h-1.5 rounded-full transition-colors",
                  i < step ? "bg-primary cursor-pointer" : i === step ? "bg-primary" : "bg-muted",
                ].join(" ")}
              />
            ))}
          </div>
          <div className="flex justify-between mt-1.5">
            {steps.map((label, i) => (
              <span
                key={i}
                className={`text-[10px] font-medium ${i === step ? "text-primary" : "text-muted-foreground"}`}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8">
        {restoredFromDraft && (
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 flex items-center justify-between text-sm text-amber-300">
            <span>✏️ Draft restored from your last session.</span>
            {onDiscardDraft && (
              <button
                type="button"
                className="text-amber-400 hover:text-amber-200 text-xs underline"
                onClick={onDiscardDraft}
              >
                Discard draft
              </button>
            )}
          </div>
        )}

        {children}

        <div className="flex justify-between mt-8 pt-4 border-t">
          <div className="flex gap-2">
            {!isFirstStep && (
              <Button variant="outline" onClick={() => setStep(s => s - 1)} disabled={isSaving}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Back
              </Button>
            )}
            {onSaveDraft && (
              <Button
                variant="ghost"
                className="text-muted-foreground text-sm"
                onClick={onSaveDraft}
                disabled={isSaving}
              >
                <Save className="h-3.5 w-3.5 mr-1.5" /> Exit & save draft
              </Button>
            )}
          </div>

          {!showPublishFooter && !isLastStep && (
            <Button onClick={() => setStep(s => s + 1)} disabled={!canProceed}>
              Next <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          )}

          {showPublishFooter && (
            <div className="flex gap-2">
              {onSchedulePublish && (
                <Button
                  variant="outline"
                  onClick={onSchedulePublish}
                  disabled={isSaving || publishDisabled}
                >
                  <Clock className="h-4 w-4 mr-2" /> Set Registration Date
                </Button>
              )}
              {onPublish && (
                <Button
                  onClick={onPublish}
                  disabled={isSaving || publishDisabled}
                >
                  <Rocket className="h-4 w-4 mr-2" />
                  {isSaving ? "Saving…" : (publishLabel ?? "Publish Now")}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
