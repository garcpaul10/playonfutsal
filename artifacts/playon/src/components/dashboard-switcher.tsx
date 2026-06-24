import React from "react";
import { useLocation } from "wouter";
import { Check, ChevronDown, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDashboardSwitcher } from "@/hooks/use-dashboard-switcher";

export function DashboardSwitcher() {
  const [, setLocation] = useLocation();
  const { available, active, isMultiRole } = useDashboardSwitcher();

  if (!isMultiRole) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs font-medium border-border/60 bg-background/60 hover:bg-muted/60 hidden md:flex"
        >
          <LayoutGrid className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="max-w-[110px] truncate">
            {active?.label ?? "Switch Dashboard"}
          </span>
          <ChevronDown className="h-3 w-3 text-muted-foreground ml-0.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
          Your dashboards
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {available.map((entry) => {
          const Icon = entry.icon;
          const isActive = active?.id === entry.id;
          return (
            <DropdownMenuItem
              key={entry.id}
              className="flex items-center gap-2 cursor-pointer"
              onSelect={() => setLocation(entry.webPath)}
            >
              <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="flex-1">{entry.label}</span>
              {isActive && (
                <Check className="h-3.5 w-3.5 text-primary shrink-0" />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
