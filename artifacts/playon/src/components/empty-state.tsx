import React from "react";
import { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-16 px-6 text-center gap-4", className)}>
      <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-muted/60">
        <Icon className="w-8 h-8 text-muted-foreground" />
      </div>
      <div className="space-y-1.5 max-w-xs">
        <p className="font-semibold text-foreground">{title}</p>
        {description && (
          <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
        )}
      </div>
      {action && (
        <Button onClick={action.onClick} size="sm" className="mt-1">
          {action.label}
        </Button>
      )}
    </div>
  );
}
