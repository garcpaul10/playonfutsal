import React, { useRef, useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pen, Type, RotateCcw, ChevronDown } from "lucide-react";

export type SignatureMode = "drawn" | "typed";

export interface SignatureResult {
  data: string;
  mode: SignatureMode;
}

interface WaiverSignatureProps {
  waiverText: string;
  waiverName: string;
  isForChild?: boolean;
  onSignatureChange: (result: SignatureResult | null) => void;
  onAgreedChange: (agreed: boolean) => void;
  agreed: boolean;
  disabled?: boolean;
}

export function WaiverSignature({
  waiverText,
  waiverName,
  isForChild = false,
  onSignatureChange,
  onAgreedChange,
  agreed,
  disabled,
}: WaiverSignatureProps) {
  const [mode, setMode] = useState<SignatureMode>("typed");
  const [typedName, setTypedName] = useState("");
  const [hasDrawn, setHasDrawn] = useState(false);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isDrawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  // Notify parent when typed signature changes
  useEffect(() => {
    if (mode === "typed") {
      if (typedName.trim()) {
        onSignatureChange({ data: typedName.trim(), mode: "typed" });
      } else {
        onSignatureChange(null);
      }
    }
  }, [typedName, mode]);

  // Notify parent when drawn signature is cleared
  useEffect(() => {
    if (mode === "drawn" && !hasDrawn) {
      onSignatureChange(null);
    }
  }, [mode, hasDrawn]);

  const getPos = (e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const touch = "touches" in e ? e.touches[0] : (e as MouseEvent);
    return {
      x: (touch.clientX - rect.left) * scaleX,
      y: (touch.clientY - rect.top) * scaleY,
    };
  };

  const startDraw = useCallback((e: MouseEvent | TouchEvent) => {
    if (disabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    isDrawing.current = true;
    lastPos.current = getPos(e, canvas);
    e.preventDefault();
  }, [disabled]);

  const draw = useCallback((e: MouseEvent | TouchEvent) => {
    if (!isDrawing.current || disabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const pos = getPos(e, canvas);
    if (lastPos.current) {
      ctx.beginPath();
      ctx.moveTo(lastPos.current.x, lastPos.current.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }
    lastPos.current = pos;
    setHasDrawn(true);

    const dataUrl = canvas.toDataURL("image/png");
    onSignatureChange({ data: dataUrl, mode: "drawn" });
    e.preventDefault();
  }, [disabled, onSignatureChange]);

  const stopDraw = useCallback(() => {
    isDrawing.current = false;
    lastPos.current = null;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || mode !== "drawn") return;

    canvas.addEventListener("mousedown", startDraw);
    canvas.addEventListener("mousemove", draw);
    canvas.addEventListener("mouseup", stopDraw);
    canvas.addEventListener("mouseleave", stopDraw);
    canvas.addEventListener("touchstart", startDraw, { passive: false });
    canvas.addEventListener("touchmove", draw, { passive: false });
    canvas.addEventListener("touchend", stopDraw);

    return () => {
      canvas.removeEventListener("mousedown", startDraw);
      canvas.removeEventListener("mousemove", draw);
      canvas.removeEventListener("mouseup", stopDraw);
      canvas.removeEventListener("mouseleave", stopDraw);
      canvas.removeEventListener("touchstart", startDraw);
      canvas.removeEventListener("touchmove", draw);
      canvas.removeEventListener("touchend", stopDraw);
    };
  }, [mode, startDraw, draw, stopDraw]);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
    onSignatureChange(null);
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom) setScrolledToBottom(true);
  };

  const scrollToBottom = () => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  };

  const switchMode = (newMode: SignatureMode) => {
    setMode(newMode);
    if (newMode === "typed") {
      onSignatureChange(typedName.trim() ? { data: typedName.trim(), mode: "typed" } : null);
    } else {
      onSignatureChange(hasDrawn ? null : null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-[#1a2626] border border-[#3b474c] overflow-hidden">
        <div className="px-4 pt-4 pb-2 flex items-center justify-between">
          <p className="text-white text-sm font-semibold">{waiverName}</p>
          {!scrolledToBottom && (
            <button
              type="button"
              onClick={scrollToBottom}
              className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
            >
              <ChevronDown className="h-3.5 w-3.5" />
              Scroll to read
            </button>
          )}
        </div>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="px-4 pb-4 max-h-48 overflow-y-auto text-[#99a1a3] text-xs leading-relaxed whitespace-pre-wrap"
        >
          {waiverText}
        </div>
      </div>

      <label className="flex items-start gap-3 cursor-pointer group">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => onAgreedChange(e.target.checked)}
          disabled={disabled}
          className="mt-0.5 accent-primary w-4 h-4 shrink-0"
        />
        <span className="text-[#99a1a3] text-xs leading-relaxed group-hover:text-white transition-colors">
          I have read and agree to the liability waiver above
          {isForChild ? " on behalf of my child" : ""}.
        </span>
      </label>

      <div className="rounded-xl bg-[#1a2626] border border-[#3b474c] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-white text-sm font-semibold">Your signature</p>
          <div className="flex rounded-lg overflow-hidden border border-[#3b474c]">
            <button
              type="button"
              onClick={() => switchMode("typed")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === "typed"
                  ? "bg-primary text-primary-foreground"
                  : "text-[#99a1a3] hover:text-white hover:bg-[#2b353a]"
              }`}
            >
              <Type className="h-3 w-3" />
              Type
            </button>
            <button
              type="button"
              onClick={() => switchMode("drawn")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === "drawn"
                  ? "bg-primary text-primary-foreground"
                  : "text-[#99a1a3] hover:text-white hover:bg-[#2b353a]"
              }`}
            >
              <Pen className="h-3 w-3" />
              Draw
            </button>
          </div>
        </div>

        {mode === "typed" ? (
          <div className="space-y-1.5">
            <Label htmlFor="waiverSignature" className="text-[#99a1a3] text-xs">
              Type your full legal name
            </Label>
            <Input
              id="waiverSignature"
              placeholder="Your legal name"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              disabled={disabled}
              className="bg-[var(--brand-teal-700)] border-[var(--brand-teal-600)] text-white placeholder:text-[var(--brand-neutral-500)] focus:border-primary focus:ring-primary h-11 font-serif text-base italic"
            />
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-[#99a1a3] text-xs">Draw your signature in the box below</p>
            <div className="relative rounded-lg overflow-hidden border border-[#3b474c] bg-[#0f1a1a]">
              <canvas
                ref={canvasRef}
                width={560}
                height={120}
                className="w-full touch-none cursor-crosshair"
                style={{ display: "block" }}
              />
              {!hasDrawn && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <p className="text-[#3b474c] text-sm select-none">Sign here</p>
                </div>
              )}
              <div className="absolute bottom-0 left-0 right-0 border-t border-dashed border-[#2b353a] mx-3" />
            </div>
            {hasDrawn && (
              <button
                type="button"
                onClick={clearCanvas}
                disabled={disabled}
                className="flex items-center gap-1.5 text-xs text-[#99a1a3] hover:text-white transition-colors"
              >
                <RotateCcw className="h-3 w-3" />
                Clear & redraw
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
