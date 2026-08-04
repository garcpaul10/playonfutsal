import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Code, List } from "lucide-react";

export interface LifePack {
  name: string;
  lives: number;
  priceCents: number;
}

interface LifePacksEditorProps {
  /** Life packs serialized as a JSON string — matches the shape stored on kotc_seasons.life_packs. */
  value: string;
  onChange: (json: string) => void;
}

function safeParse(json: string): LifePack[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((p) => ({
      name: typeof p?.name === "string" ? p.name : "",
      lives: Number.isFinite(p?.lives) ? p.lives : 0,
      priceCents: Number.isFinite(p?.priceCents) ? p.priceCents : 0,
    }));
  } catch {
    return [];
  }
}

/**
 * Structured editor for a season's life pack pricing tiers. Edits a JSON string
 * (matching kotc_seasons.life_packs) via a row-based UI instead of raw JSON,
 * with an "Edit as JSON" escape hatch for power users.
 */
export function LifePacksEditor({ value, onChange }: LifePacksEditorProps) {
  const [mode, setMode] = useState<"simple" | "json">("simple");
  const [packs, setPacks] = useState<LifePack[]>(() => safeParse(value));
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Re-sync rows if the incoming value changes from outside (e.g. loading an existing season)
  useEffect(() => {
    setPacks(safeParse(value));
  }, [value]);

  function commit(next: LifePack[]) {
    setPacks(next);
    onChange(JSON.stringify(next, null, 2));
  }

  function updatePack(i: number, field: keyof LifePack, raw: string) {
    const next = [...packs];
    if (field === "name") {
      next[i] = { ...next[i], name: raw };
    } else if (field === "lives") {
      next[i] = { ...next[i], lives: Math.max(0, parseInt(raw, 10) || 0) };
    } else {
      // priceCents — input is dollars, stored as cents
      const dollars = parseFloat(raw) || 0;
      next[i] = { ...next[i], priceCents: Math.max(0, Math.round(dollars * 100)) };
    }
    commit(next);
  }

  function addPack() {
    commit([...packs, { name: "", lives: 1, priceCents: 0 }]);
  }

  function removePack(i: number) {
    commit(packs.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Life Packs</Label>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs gap-1"
          onClick={() => {
            if (mode === "simple") {
              setJsonError(null);
              setMode("json");
            } else {
              try {
                const parsed = JSON.parse(value);
                if (!Array.isArray(parsed)) throw new Error();
                setJsonError(null);
                setMode("simple");
              } catch {
                setJsonError("Fix the JSON before switching back to the simple editor.");
              }
            }
          }}
        >
          {mode === "simple" ? <><Code className="h-3 w-3" />Edit as JSON</> : <><List className="h-3 w-3" />Edit as list</>}
        </Button>
      </div>

      {mode === "json" ? (
        <div>
          <Textarea
            className="font-mono text-xs"
            rows={8}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          {jsonError && <p className="text-xs text-red-500 mt-1">{jsonError}</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {packs.length === 0 && (
            <p className="text-xs text-muted-foreground">No life packs yet — add one below.</p>
          )}
          {packs.map((pack, i) => (
            <div key={i} className="flex items-end gap-2 rounded-lg border border-border p-2.5">
              <div className="flex-1 min-w-0">
                <Label className="text-[11px] text-muted-foreground">Name</Label>
                <Input
                  className="mt-1 h-8 text-sm"
                  placeholder="Starter Pack"
                  value={pack.name}
                  onChange={(e) => updatePack(i, "name", e.target.value)}
                />
              </div>
              <div className="w-20 flex-shrink-0">
                <Label className="text-[11px] text-muted-foreground">Lives</Label>
                <Input
                  className="mt-1 h-8 text-sm"
                  type="number"
                  min={1}
                  value={pack.lives}
                  onChange={(e) => updatePack(i, "lives", e.target.value)}
                />
              </div>
              <div className="w-24 flex-shrink-0">
                <Label className="text-[11px] text-muted-foreground">Price ($)</Label>
                <Input
                  className="mt-1 h-8 text-sm"
                  type="number"
                  min={0}
                  step="0.01"
                  value={(pack.priceCents / 100).toFixed(2)}
                  onChange={(e) => updatePack(i, "priceCents", e.target.value)}
                />
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8 flex-shrink-0 text-red-500 hover:text-red-400 hover:bg-red-500/10"
                onClick={() => removePack(i)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" className="gap-1.5 w-full" onClick={addPack}>
            <Plus className="h-3.5 w-3.5" />Add Life Pack
          </Button>
        </div>
      )}
    </div>
  );
}
