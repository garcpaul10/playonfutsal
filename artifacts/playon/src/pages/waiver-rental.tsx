import { API_BASE } from "@/lib/api-base";
import React, { useState, useEffect, useRef } from "react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import { CheckCircle2, Building2, Clock, Users, Loader2, FileText, AlertCircle } from "lucide-react";

function fmt12(t: string): string {
  if (!t) return t;
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

export default function WaiverRentalPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const { toast } = useToast();

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [typedSig, setTypedSig] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/rentals/waiver/${token}`)
      .then((r) => {
        if (!r.ok) throw new Error("not found");
        return r.json();
      })
      .then(setData)
      .catch(() => setError("This waiver link is invalid or has expired."))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast({ title: "Please enter your full name", variant: "destructive" }); return; }
    if (!typedSig.trim()) { toast({ title: "Please type your signature", variant: "destructive" }); return; }
    if (!agreed) { toast({ title: "Please agree to the waiver", variant: "destructive" }); return; }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/rentals/waiver/${token}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim() || null,
          phone: phone.trim() || null,
          signatureData: typedSig.trim(),
          signatureType: "typed",
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        toast({ title: "Error", description: d.error, variant: "destructive" });
        return;
      }
      setDone(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  if (error || !data) {
    return (
      <Layout>
        <div className="max-w-lg mx-auto px-4 py-16 text-center">
          <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-foreground mb-2">Link Not Found</h1>
          <p className="text-muted-foreground">{error ?? "This waiver link is invalid or has expired."}</p>
        </div>
      </Layout>
    );
  }

  if (done) {
    return (
      <Layout>
        <div className="max-w-lg mx-auto px-4 py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-5">
            <CheckCircle2 className="h-8 w-8 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-black text-foreground mb-2">Waiver Signed!</h1>
          <p className="text-muted-foreground mb-6">
            You're good to go. See you on{" "}
            {data.rental.date ? format(parseISO(data.rental.date), "EEEE, MMMM d") : data.rental.date}.
          </p>
          <div className="bg-card border border-border rounded-xl p-5 text-left space-y-3">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Building2 className="h-4 w-4 shrink-0" />
              <span>Court {data.rental.courtNumber}</span>
            </div>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Clock className="h-4 w-4 shrink-0" />
              <span>{fmt12(data.rental.startTime)} – {fmt12(data.rental.endTime)}</span>
            </div>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Users className="h-4 w-4 shrink-0" />
              <span>{data.signedCount + 1} of {data.headcount} signed</span>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  const { rental, waiver } = data;

  return (
    <Layout>
      <div className="max-w-lg mx-auto px-4 py-10">

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 text-primary mb-1">
            <FileText className="h-5 w-5" />
            <span className="text-sm font-semibold uppercase tracking-wide">Liability Waiver</span>
          </div>
          <h1 className="text-2xl font-black text-foreground">Sign Before You Play</h1>
          <p className="text-sm text-muted-foreground mt-1">
            You've been invited to a court rental. Sign the waiver to confirm your participation.
          </p>
        </div>

        {/* Rental summary */}
        <div className="bg-card border border-border rounded-xl p-4 mb-6 space-y-2">
          <div className="flex items-center gap-3 text-sm">
            <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-foreground font-medium">Court {rental.courtNumber}</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-foreground">
              {rental.date ? format(parseISO(rental.date), "EEEE, MMMM d, yyyy") : rental.date}
              {" · "}{fmt12(rental.startTime)} – {fmt12(rental.endTime)}
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Users className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">{data.signedCount} of {data.headcount} people have signed</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">

          {/* Personal info */}
          <div className="space-y-3">
            <div>
              <Label className="text-sm font-medium">Full Name <span className="text-red-400">*</span></Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Smith"
                className="mt-1.5"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm font-medium">Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane@example.com"
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label className="text-sm font-medium">Phone</Label>
                <Input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(555) 000-0000"
                  className="mt-1.5"
                />
              </div>
            </div>
          </div>

          {/* Waiver text */}
          {waiver && (
            <div>
              <Label className="text-sm font-medium mb-2 block">Waiver — {waiver.name} (v{waiver.version})</Label>
              <div className="bg-muted/40 border border-border rounded-xl p-4 h-48 overflow-y-auto text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                {waiver.body}
              </div>
            </div>
          )}

          {/* Agreement checkbox */}
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
            />
            <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
              I have read and agree to the liability waiver above. I understand the risks involved
              and release PlayOn Futsal from any liability.
            </span>
          </label>

          {/* Typed signature */}
          <div>
            <Label className="text-sm font-medium">
              Type Your Full Name as Signature <span className="text-red-400">*</span>
            </Label>
            <Input
              value={typedSig}
              onChange={(e) => setTypedSig(e.target.value)}
              placeholder="Jane Smith"
              className="mt-1.5 font-serif italic text-lg"
              required
            />
            <p className="text-xs text-muted-foreground mt-1">
              By typing your name above you are providing a legally binding electronic signature.
            </p>
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={submitting || !agreed || !name.trim() || !typedSig.trim()}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Sign Waiver
          </Button>
        </form>
      </div>
    </Layout>
  );
}
