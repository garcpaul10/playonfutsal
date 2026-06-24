import React, { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@clerk/react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Clock, Loader2, Calendar, Home } from "lucide-react";

type PageStatus = "loading" | "success" | "processing" | "failed" | "error";

export default function CheckoutComplete() {
  const [, setLocation] = useLocation();
  const { getToken } = useAuth();
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get("session_id");

  const [status, setStatus] = useState<PageStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setStatus("error");
      setErrorMessage("No session ID found. Your payment may have completed — check your dashboard.");
      return;
    }
    let cancelled = false;
    async function checkStatus() {
      try {
        const token = await getToken();
        const res = await fetch(`/api/checkout/session-status?session_id=${encodeURIComponent(sessionId!)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (cancelled) return;
        if (!res.ok) {
          setStatus("error");
          setErrorMessage("Could not verify your payment. Please check your dashboard.");
          return;
        }
        const data = await res.json();
        let resolved: PageStatus;
        if (data.status === "complete") {
          resolved = "success";
        } else if (data.status === "open" && data.paymentStatus === "unpaid") {
          resolved = "processing";
        } else if (data.status === "expired") {
          resolved = "failed";
        } else {
          resolved = "success";
        }
        const isMobile = localStorage.getItem("playon_mobile_return") === "1";
        if (isMobile && (resolved === "success" || resolved === "processing")) {
          localStorage.removeItem("playon_mobile_return");
          window.location.href = `playon-mobile://checkout-complete?status=${resolved}`;
          return;
        }
        setStatus(resolved);
      } catch {
        if (!cancelled) {
          setStatus("error");
          setErrorMessage("Could not connect to the server. Please check your dashboard.");
        }
      }
    }
    checkStatus();
    return () => { cancelled = true; };
  }, [sessionId]);

  if (status === "loading") {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-24 max-w-md text-center">
          <Loader2 className="h-12 w-12 animate-spin text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Verifying your payment…</p>
        </div>
      </Layout>
    );
  }

  if (status === "processing") {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-24 max-w-md text-center">
          <div className="flex justify-center mb-6">
            <Clock className="h-16 w-16 text-yellow-500" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Payment processing</h1>
          <p className="text-muted-foreground mb-6">
            Your bank transfer is being processed. We'll send you a confirmation email once it clears — usually 1–3 business days.
          </p>
          <div className="flex flex-col gap-3 items-center">
            <Button onClick={() => setLocation("/dashboard")} className="w-full max-w-xs">
              <Calendar className="mr-2 h-4 w-4" /> View my dashboard
            </Button>
            <button onClick={() => setLocation("/")} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              <Home className="inline mr-1 h-3.5 w-3.5" /> Back to home
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  if (status === "failed") {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-24 max-w-md text-center">
          <div className="flex justify-center mb-6">
            <XCircle className="h-16 w-16 text-red-500" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Payment not completed</h1>
          <p className="text-muted-foreground mb-6">
            Your checkout session expired or was cancelled. No charge was made — please try registering again.
          </p>
          <div className="flex flex-col gap-3 items-center">
            <Button onClick={() => setLocation("/dashboard")} className="w-full max-w-xs">
              <Calendar className="mr-2 h-4 w-4" /> Go to dashboard
            </Button>
            <button onClick={() => setLocation("/")} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Back to home
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  if (status === "error") {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-24 max-w-md text-center">
          <div className="flex justify-center mb-6">
            <XCircle className="h-16 w-16 text-red-500" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
          <p className="text-muted-foreground mb-6">
            {errorMessage ?? "We couldn't confirm your payment status. Please check your dashboard or contact support."}
          </p>
          <div className="flex flex-col gap-3 items-center">
            <Button onClick={() => setLocation("/dashboard")} className="w-full max-w-xs">
              <Calendar className="mr-2 h-4 w-4" /> Go to dashboard
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
      <div className="container mx-auto px-4 py-24 max-w-md text-center">
        <div className="flex justify-center mb-6">
          <CheckCircle2 className="h-16 w-16 text-green-500" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Payment complete!</h1>
        <p className="text-muted-foreground mb-6">
          Your payment was received. Your registration is confirmed.
        </p>
        <div className="flex flex-col gap-3 items-center">
          <Button onClick={() => setLocation("/dashboard")} className="w-full max-w-xs">
            <Calendar className="mr-2 h-4 w-4" /> View my schedule
          </Button>
          <button onClick={() => setLocation("/")} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            <Home className="inline mr-1 h-3.5 w-3.5" /> Back to home
          </button>
        </div>
      </div>
    </Layout>
  );
}
