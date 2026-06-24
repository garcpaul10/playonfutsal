import React, { useEffect, useRef, useState } from "react";
import { X, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";

interface QrScannerModalProps {
  open: boolean;
  onClose: () => void;
  onScan: (value: string) => void;
}

export function QrScannerModal({ open, onClose, onScan }: QrScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ active: false, fired: false, stream: null as MediaStream | null, raf: 0 });
  const [permissionDenied, setPermissionDenied] = useState(false);

  function cleanup() {
    const s = stateRef.current;
    s.active = false;
    if (s.raf) { cancelAnimationFrame(s.raf); s.raf = 0; }
    if (s.stream) { s.stream.getTracks().forEach(t => t.stop()); s.stream = null; }
  }

  useEffect(() => {
    if (!open) {
      cleanup();
      setPermissionDenied(false);
      return;
    }

    const s = stateRef.current;
    s.active = true;
    s.fired = false;

    const onScanRef = onScan;
    const onCloseRef = onClose;

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setPermissionDenied(true);
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!s.active) { stream.getTracks().forEach(t => t.stop()); return; }
        s.stream = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const fire = (raw: string) => {
          if (s.fired || !s.active) return;
          s.fired = true;
          cleanup();
          onScanRef(raw);
          onCloseRef();
        };

        const hasBarcodeDetector = typeof (window as any).BarcodeDetector !== "undefined";

        if (hasBarcodeDetector) {
          const detector = new (window as any).BarcodeDetector({ formats: ["qr_code"] });
          const tick = async () => {
            if (!s.active) return;
            if (video.readyState >= 2) {
              try {
                const codes = await detector.detect(video);
                if (codes.length > 0) { fire(codes[0].rawValue); return; }
              } catch {}
            }
            s.raf = requestAnimationFrame(tick);
          };
          s.raf = requestAnimationFrame(tick);
        } else {
          const jsQRModule = await import("jsqr");
          const jsQR = jsQRModule.default;
          const canvas = canvasRef.current;
          if (!canvas) return;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;

          const tick = () => {
            if (!s.active) return;
            if (video.readyState >= 2 && video.videoWidth > 0) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              ctx.drawImage(video, 0, 0);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(img.data, img.width, img.height);
              if (code) { fire(code.data); return; }
            }
            s.raf = requestAnimationFrame(tick);
          };
          s.raf = requestAnimationFrame(tick);
        }
      } catch (err: any) {
        const name = err?.name ?? "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
          setPermissionDenied(true);
        }
      }
    }

    start();
    return cleanup;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
      <div
        className="relative w-full max-w-sm mx-4 rounded-2xl overflow-hidden bg-black"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 bg-black/90">
          <span className="text-white font-semibold text-sm flex items-center gap-2">
            <Camera className="h-4 w-4" /> Scan Player QR
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-white hover:bg-white/20"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {permissionDenied ? (
          <div className="flex flex-col items-center justify-center h-64 p-6 text-center gap-3">
            <Camera className="h-12 w-12 text-gray-500" />
            <p className="text-white font-medium">Camera access denied</p>
            <p className="text-sm text-gray-400 leading-relaxed">
              Allow camera access for this site in your browser settings, then reload the page and try again.
            </p>
          </div>
        ) : (
          <div className="relative">
            <video ref={videoRef} className="w-full aspect-square object-cover" playsInline muted />
            <canvas ref={canvasRef} className="hidden" />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="relative w-52 h-52">
                <div className="absolute top-0 left-0 w-8 h-8 border-t-[3px] border-l-[3px] border-white rounded-tl-sm" />
                <div className="absolute top-0 right-0 w-8 h-8 border-t-[3px] border-r-[3px] border-white rounded-tr-sm" />
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-[3px] border-l-[3px] border-white rounded-bl-sm" />
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-[3px] border-r-[3px] border-white rounded-br-sm" />
              </div>
            </div>
            <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-4 py-3 text-center">
              <p className="text-white/80 text-sm">Point camera at player's QR code</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
