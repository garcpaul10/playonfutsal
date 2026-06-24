import React, { useState, useEffect, useRef } from "react";
import { Redirect, useLocation } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { CheckoutElementsProvider, PaymentElement, useCheckout } from "@stripe/react-stripe-js/checkout";
import { ChevronDown, ChevronUp, CheckCircle2, Calendar, ArrowLeft, Loader2, Clock, AlertTriangle } from "lucide-react";

function fmt(n: number) { return n.toLocaleString("en-US", { style: "currency", currency: "USD" }); }

// ── Countdown hook ────────────────────────────────────────────────────────────
function useCountdown(expiresAt: Date | null) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!expiresAt) { setSecondsLeft(null); return; }
    const tick = () => {
      const diff = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
      setSecondsLeft(diff);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return secondsLeft;
}

function CountdownBanner({ secondsLeft }: { secondsLeft: number }) {
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const isUrgent = secondsLeft <= 60;
  const label = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

  return (
    <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 ${
      isUrgent
        ? "border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900/40"
        : "border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/40"
    }`}>
      <Clock className={`h-4 w-4 shrink-0 ${isUrgent ? "text-red-500" : "text-amber-500"}`} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${isUrgent ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
          {isUrgent ? "Hurry — spot expiring soon!" : "Complete payment to secure your spot"}
        </p>
        <p className={`text-xs ${isUrgent ? "text-red-600 dark:text-red-500" : "text-amber-600 dark:text-amber-500"}`}>
          Your spot is reserved for <span className="font-mono font-bold">{label}</span>
        </p>
      </div>
    </div>
  );
}

function ExpiredBanner({ onGoBack }: { onGoBack: () => void }) {
  return (
    <div className="rounded-xl border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900/40 px-4 py-4 flex flex-col items-center gap-3 text-center">
      <AlertTriangle className="h-8 w-8 text-red-500" />
      <div>
        <p className="text-sm font-semibold text-red-700 dark:text-red-400">Your registration has expired</p>
        <p className="text-xs text-red-600 dark:text-red-500 mt-1">
          The 10-minute payment window has passed and your spot was released.
          Please register again to secure a new spot.
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onGoBack} className="border-red-300 text-red-700 hover:bg-red-100">
        Back to programs
      </Button>
    </div>
  );
}

interface PaymentFormProps {
  totalAmount: number;
  offeringName: string;
  programType: string;
  basePrice: number;
  discountAmount: number;
  creditApplied: number;
  serviceFee: number;
  isUpdating: boolean;
  onSuccess: () => void;
  discountCode: string;
  setDiscountCode: (v: string) => void;
  discountResult: { valid: boolean; discountAmount: number; finalPrice: number; error?: string } | null;
  setDiscountResult: (v: any) => void;
  validateDiscount: () => void;
  validatingCode: boolean;
  promoOpen: boolean;
  setPromoOpen: (v: boolean) => void;
  availableCredit: number;
  creditsLoading: boolean;
  useCredits: boolean;
  setUseCredits: (v: boolean) => void;
  effectiveBase: number;
  isExpired: boolean;
  onGoBack: () => void;
}

function PaymentForm({
  totalAmount, offeringName, programType, basePrice,
  discountAmount, creditApplied, serviceFee, isUpdating, onSuccess,
  discountCode, setDiscountCode, discountResult, setDiscountResult,
  validateDiscount, validatingCode, promoOpen, setPromoOpen,
  availableCredit, creditsLoading, useCredits, setUseCredits, effectiveBase,
  isExpired, onGoBack,
}: PaymentFormProps) {
  const checkoutResult = useCheckout();
  const [processing, setProcessing] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isExpired) return;
    if (checkoutResult.type !== "success") return;
    setProcessing(true);
    setPaymentError(null);
    try {
      const result = await checkoutResult.checkout.confirm({ redirect: "if_required" });
      if (result.type === "error") {
        setPaymentError(result.error.message ?? "Payment failed. Please try again.");
      } else if (result.type === "success") {
        onSuccess();
      } else {
        setPaymentError("Unexpected payment status. Please contact support.");
      }
    } catch (err: any) {
      setPaymentError(err.message ?? "An unexpected error occurred.");
    } finally {
      setProcessing(false);
    }
  }

  const ready = checkoutResult.type === "success";

  if (isExpired) {
    return <ExpiredBanner onGoBack={onGoBack} />;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Order summary inline */}
      <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-foreground font-medium">
            {offeringName}
            <Badge variant="outline" className="ml-2 text-xs capitalize">{programType.replace("_", " ")}</Badge>
          </span>
          <span className="font-medium">{fmt(basePrice)}</span>
        </div>
        {discountAmount > 0 && (
          <div className="flex justify-between text-sm text-green-600">
            <span>Discount</span>
            <span>− {fmt(discountAmount)}</span>
          </div>
        )}
        {creditApplied > 0 && (
          <div className="flex justify-between text-sm text-blue-600">
            <span>Account credit</span>
            <span>− {fmt(creditApplied)}</span>
          </div>
        )}
        {serviceFee > 0 && (
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Service fee</span>
            <span>{fmt(serviceFee)}</span>
          </div>
        )}
        <div className="border-t border-border pt-2 flex justify-between font-bold text-base">
          <span>Total</span>
          <span>{isUpdating ? <Loader2 className="h-4 w-4 animate-spin inline" /> : fmt(totalAmount)}</span>
        </div>
      </div>

      {/* Account credit toggle */}
      {!creditsLoading && availableCredit > 0 && (
        <div className="rounded-xl border border-blue-200/60 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-900/40 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Apply account credit</p>
              <p className="text-xs text-muted-foreground">{fmt(availableCredit)} available</p>
            </div>
            <Switch id="use-credits" checked={useCredits} onCheckedChange={setUseCredits} disabled={isUpdating} />
          </div>
          {useCredits && creditApplied > 0 && (
            <p className="text-xs text-blue-600 mt-2">
              {fmt(creditApplied)} applied
              {creditApplied >= effectiveBase ? " — no card payment needed!" : ` — ${fmt(totalAmount)} remaining`}
            </p>
          )}
        </div>
      )}

      {/* Promo code — collapsible */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <button
          type="button"
          onClick={() => setPromoOpen(!promoOpen)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <span>{discountResult?.valid ? `Code applied: ${discountCode.toUpperCase()} (−${fmt(discountResult.discountAmount)})` : "Have a promo code?"}</span>
          {promoOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {promoOpen && (
          <div className="px-4 pb-4 pt-0 border-t border-border">
            <div className="flex gap-2 mt-3">
              <Input
                value={discountCode}
                onChange={e => { setDiscountCode(e.target.value.toUpperCase()); setDiscountResult(null); }}
                placeholder="Enter code"
                className="uppercase font-mono"
                onKeyDown={e => e.key === "Enter" && validateDiscount()}
                disabled={isUpdating}
              />
              <Button
                type="button"
                variant="outline"
                onClick={validateDiscount}
                disabled={!discountCode.trim() || validatingCode || isUpdating}
              >
                {validatingCode ? "…" : "Apply"}
              </Button>
            </div>
            {discountResult && (
              <p className={`text-sm mt-2 ${discountResult.valid ? "text-green-600" : "text-red-500"}`}>
                {discountResult.valid
                  ? `✓ ${fmt(discountResult.discountAmount)} off applied`
                  : discountResult.error ?? "Invalid code"}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Stripe PaymentElement */}
      <div className="rounded-xl border border-border bg-card p-4">
        <PaymentElement options={{ layout: "tabs" }} />
      </div>

      {paymentError && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3">
          <p className="text-sm text-red-600">{paymentError}</p>
        </div>
      )}

      <Button
        type="submit"
        className="w-full text-base py-6 font-semibold"
        disabled={processing || !ready || isUpdating}
      >
        {processing ? (
          <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing…</>
        ) : isUpdating ? (
          <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating…</>
        ) : (
          `Pay & Register — ${fmt(totalAmount)}`
        )}
      </Button>

      <p className="text-xs text-muted-foreground text-center">
        Powered by Stripe · PlayOn never stores your card details
      </p>
    </form>
  );
}

export default function Checkout() {
  const [, setLocation] = useLocation();
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const { getToken } = useAuth();
  const { toast } = useToast();

  const params = new URLSearchParams(window.location.search);
  const programType = params.get("programType") ?? "";
  const programId = Number(params.get("programId") ?? "0");
  const registrationId = params.get("registrationId") ? Number(params.get("registrationId")) : undefined;
  const offeringName = params.get("name") ?? "Registration";
  const basePrice = Number(params.get("price") ?? "0");
  const mobileReturn = params.get("mobile_return") === "1";

  useEffect(() => {
    if (mobileReturn) localStorage.setItem("playon_mobile_return", "1");
  }, [mobileReturn]);

  const [discountCode, setDiscountCode] = useState("");
  const [discountResult, setDiscountResult] = useState<{ valid: boolean; discountAmount: number; finalPrice: number; error?: string } | null>(null);
  const [validatingCode, setValidatingCode] = useState(false);
  const [promoOpen, setPromoOpen] = useState(false);

  const [serviceFee, setServiceFee] = useState(0);
  const [availableCredit, setAvailableCredit] = useState(0);
  const [useCredits, setUseCredits] = useState(false);
  const [creditsLoading, setCreditsLoading] = useState(false);

  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [checkoutSessionId, setCheckoutSessionId] = useState<string | null>(null);
  const [confirmedAmount, setConfirmedAmount] = useState(0);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  const [initLoading, setInitLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);

  // Expiry tracking — fetched from the registration record on mount
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const secondsLeft = useCountdown(expiresAt);
  const isExpired = secondsLeft !== null && secondsLeft <= 0;

  const stripePromiseRef = useRef<Promise<Stripe | null> | null>(null);
  const checkoutSessionIdRef = useRef<string | null>(null);

  const effectiveBase = discountResult?.valid ? discountResult.finalPrice : basePrice;
  const creditApplied = useCredits ? Math.min(availableCredit, effectiveBase) : 0;
  const priceAfterCredits = Math.max(0, effectiveBase - creditApplied);
  const totalAmount = priceAfterCredits + serviceFee;
  const discountAmount = discountResult?.valid ? discountResult.discountAmount : 0;

  // Fetch registration's expiresAt when registrationId is available
  useEffect(() => {
    if (!registrationId) return;
    async function fetchReg() {
      try {
        const token = await getToken();
        const res = await fetch(`/api/registrations/${registrationId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.expiresAt) setExpiresAt(new Date(data.expiresAt));
          // If already expired at load time, stop loading and show expired banner
          if (data.status === "expired") {
            setExpiresAt(new Date(Date.now() - 1)); // force expired display
          }
        }
      } catch (_) {}
    }
    fetchReg();
  }, [registrationId]);

  // Load credits in parallel with session
  useEffect(() => {
    async function fetchCredits() {
      setCreditsLoading(true);
      try {
        const token = await getToken();
        const res = await fetch("/api/account-credits", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const credits = await res.json() as Array<{ remainingAmount: string }>;
          setAvailableCredit(credits.reduce((sum, c) => sum + Number(c.remainingAmount), 0));
        }
      } catch (_) {}
      finally { setCreditsLoading(false); }
    }
    fetchCredits();
  }, []);

  // Create checkout session eagerly on mount
  useEffect(() => {
    if (!programType || !programId) return;
    createOrUpdateSession(false);
  }, [programType, programId]);

  // Update service fee when price changes due to credits/discounts (post initial load).
  useEffect(() => {
    if (initLoading) return;
    if (!priceAfterCredits) { setServiceFee(0); return; }
    async function fetchFee() {
      try {
        const token = await getToken();
        const res = await fetch(`/api/checkout/fee-preview`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ grossAmount: priceAfterCredits, programType, programId }),
        });
        if (res.ok) {
          const data = await res.json();
          setServiceFee(Number(data.serviceFeeAmount ?? 0));
        }
      } catch (_) {}
    }
    fetchFee();
  }, [priceAfterCredits, programType, programId]);

  interface SessionOpts {
    appliedDiscountCode?: string;
    applyCredits?: boolean;
  }

  async function createOrUpdateSession(isUpdate: boolean, opts: SessionOpts = {}) {
    if (!programType || !programId) return;
    const intentDiscountCode = opts.appliedDiscountCode;
    const intentUseCredits = opts.applyCredits ?? false;

    isUpdate ? setIsUpdating(true) : setInitLoading(true);
    try {
      // Expire old session if updating
      if (isUpdate && checkoutSessionIdRef.current) {
        await cancelCheckoutSession(checkoutSessionIdRef.current);
        checkoutSessionIdRef.current = null;
        setCheckoutSessionId(null);
        setClientSecret(null);
        setStripePromise(null);
      }

      const token = await getToken();
      const res = await fetch("/api/checkout/session", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          programType,
          programId,
          registrationId,
          discountCode: intentDiscountCode,
          useCredits: intentUseCredits,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Handle expired registration
        if (res.status === 410 || data.expired) {
          setExpiresAt(new Date(Date.now() - 1));
          setInitLoading(false);
          setIsUpdating(false);
          return;
        }
        toast({ title: "Checkout error", description: data.error ?? "Failed to start checkout", variant: "destructive" });
        return;
      }

      if (data.creditOnly) {
        toast({ title: "Payment complete", description: "Account credit applied — registration confirmed!" });
        const isMobile = localStorage.getItem("playon_mobile_return") === "1";
        if (isMobile) {
          localStorage.removeItem("playon_mobile_return");
          window.location.href = "playon-mobile://checkout-complete?status=success";
        } else {
          setLocation("/dashboard");
        }
        return;
      }

      if (!data.clientSecret || !data.publishableKey) {
        toast({ title: "Error", description: "Failed to initialize payment form", variant: "destructive" });
        return;
      }

      if (!stripePromiseRef.current) {
        stripePromiseRef.current = loadStripe(data.publishableKey);
      }
      setStripePromise(stripePromiseRef.current);
      setClientSecret(data.clientSecret);
      setCheckoutSessionId(data.checkoutSessionId ?? null);
      checkoutSessionIdRef.current = data.checkoutSessionId ?? null;
      setConfirmedAmount(data.amount ?? basePrice);
      if (data.serviceFeeAmount !== undefined) {
        setServiceFee(Number(data.serviceFeeAmount));
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      isUpdate ? setIsUpdating(false) : setInitLoading(false);
    }
  }

  async function validateDiscount() {
    if (!discountCode.trim()) return;
    setValidatingCode(true);
    setDiscountResult(null);
    const code = discountCode.trim();
    try {
      const token = await getToken();
      const res = await fetch("/api/checkout/validate-discount", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ code, programType, programId, basePrice }),
      });
      const data = await res.json();
      setDiscountResult(data);
      if (data.valid) {
        await createOrUpdateSession(true, {
          appliedDiscountCode: code,
          applyCredits: useCredits,
        });
      }
    } catch (_) {
      setDiscountResult({ valid: false, discountAmount: 0, finalPrice: basePrice, error: "Failed to validate code" });
    } finally {
      setValidatingCode(false);
    }
  }

  async function cancelCheckoutSession(sessionId: string) {
    try {
      const token = await getToken();
      await fetch("/api/checkout/cancel-intent", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ checkoutSessionId: sessionId }),
      });
    } catch (_) {}
  }

  // Re-create session when a previously applied discount is cleared
  const prevDiscountValid = useRef(false);
  useEffect(() => {
    const isValid = discountResult?.valid === true;
    const wasValid = prevDiscountValid.current;
    prevDiscountValid.current = isValid;
    if (wasValid && !isValid && !initLoading && clientSecret) {
      createOrUpdateSession(true, {
        appliedDiscountCode: undefined,
        applyCredits: useCredits,
      });
    }
  }, [discountResult]);

  // Refresh session when credit toggle changes (after initial load)
  const prevUseCredits = useRef(useCredits);
  useEffect(() => {
    if (prevUseCredits.current === useCredits) return;
    prevUseCredits.current = useCredits;
    if (!initLoading && clientSecret) {
      createOrUpdateSession(true, {
        appliedDiscountCode: discountResult?.valid ? discountCode.trim() : undefined,
        applyCredits: useCredits,
      });
    }
  }, [useCredits]);

  useEffect(() => {
    function handleBeforeUnload() {
      if (checkoutSessionIdRef.current) cancelCheckoutSession(checkoutSessionIdRef.current);
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  function handlePaymentSuccess() {
    checkoutSessionIdRef.current = null;
    setPaymentSuccess(true);
    const isMobile = localStorage.getItem("playon_mobile_return") === "1";
    if (isMobile) {
      localStorage.removeItem("playon_mobile_return");
      setTimeout(() => { window.location.href = "playon-mobile://checkout-complete?status=success"; }, 1200);
    } else {
      setTimeout(() => setLocation("/dashboard?payment=success"), 2200);
    }
  }

  function handleGoBack() {
    const sessionId = checkoutSessionId;
    if (sessionId) cancelCheckoutSession(sessionId);
    setLocation("/dashboard");
  }

  if (profileLoading) return <Layout><div className="p-12"><div className="h-96 rounded-xl bg-muted animate-pulse" /></div></Layout>;
  if (!profile) return <Redirect to="/sign-in" />;
  if (!programType || !programId) return <Redirect to="/dashboard" />;

  if (paymentSuccess) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-24 max-w-md text-center">
          <div className="flex justify-center mb-6">
            <CheckCircle2 className="h-16 w-16 text-green-500" />
          </div>
          <h1 className="text-2xl font-bold mb-2">You're registered!</h1>
          <p className="text-muted-foreground mb-6">Your payment was successful. See you on the court.</p>
          <div className="flex flex-col gap-3 items-center">
            <Button onClick={() => setLocation("/dashboard")} className="w-full max-w-xs">
              <Calendar className="mr-2 h-4 w-4" /> View my schedule
            </Button>
            <button onClick={() => setLocation("/")} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Back to home
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-10 max-w-lg">
        <button
          onClick={handleGoBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>

        <h1 className="text-2xl font-bold font-sans uppercase tracking-tight text-primary mb-6">Checkout</h1>

        {initLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-[140px] rounded-xl" />
            <Skeleton className="h-12 rounded-xl" />
            <Skeleton className="h-12 rounded-xl" />
            <Skeleton className="h-[200px] rounded-xl" />
            <Skeleton className="h-14 rounded-xl" />
          </div>
        ) : isExpired ? (
          <ExpiredBanner onGoBack={handleGoBack} />
        ) : stripePromise && clientSecret ? (
          <CheckoutElementsProvider
            stripe={stripePromise}
            options={{
              clientSecret,
              elementsOptions: {
                appearance: {
                  theme: "stripe",
                  variables: { colorPrimary: "#740D2A" },
                },
              },
            }}
          >
            <div className="space-y-4">
              {secondsLeft !== null && secondsLeft > 0 && (
                <CountdownBanner secondsLeft={secondsLeft} />
              )}
              <PaymentForm
                totalAmount={confirmedAmount}
                offeringName={offeringName}
                programType={programType}
                basePrice={basePrice}
                discountAmount={discountAmount}
                creditApplied={creditApplied}
                serviceFee={serviceFee}
                isUpdating={isUpdating}
                onSuccess={handlePaymentSuccess}
                discountCode={discountCode}
                setDiscountCode={setDiscountCode}
                discountResult={discountResult}
                setDiscountResult={setDiscountResult}
                validateDiscount={validateDiscount}
                validatingCode={validatingCode}
                promoOpen={promoOpen}
                setPromoOpen={setPromoOpen}
                availableCredit={availableCredit}
                creditsLoading={creditsLoading}
                useCredits={useCredits}
                setUseCredits={setUseCredits}
                effectiveBase={effectiveBase}
                isExpired={isExpired}
                onGoBack={handleGoBack}
              />
            </div>
          </CheckoutElementsProvider>
        ) : (
          <div className="rounded-xl border border-border p-8 text-center space-y-3">
            <p className="text-muted-foreground">Failed to load payment form.</p>
            <Button variant="outline" onClick={() => createOrUpdateSession(false)}>Try again</Button>
          </div>
        )}
      </div>
    </Layout>
  );
}
