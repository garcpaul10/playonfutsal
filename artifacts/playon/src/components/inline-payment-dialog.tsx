import React, { useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { CheckoutElementsProvider, PaymentElement, useCheckout } from "@stripe/react-stripe-js/checkout";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

interface InnerFormProps {
  amount: number;
  basePrice?: number;
  serviceFeeAmount?: number;
  label?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

function InnerPaymentForm({ amount, basePrice, serviceFeeAmount, label, onSuccess, onCancel }: InnerFormProps) {
  const checkoutResult = useCheckout();
  const [processing, setProcessing] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
  const showBreakdown = basePrice !== undefined && serviceFeeAmount !== undefined;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {showBreakdown && (
        <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span>Base price</span>
            <span>{fmt(basePrice!)}</span>
          </div>
          {serviceFeeAmount! > 0 && (
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Service fee</span>
              <span>{fmt(serviceFeeAmount!)}</span>
            </div>
          )}
          <div className="border-t border-border pt-2 flex justify-between font-bold text-base">
            <span>Total</span>
            <span>{fmt(amount)}</span>
          </div>
        </div>
      )}
      <PaymentElement options={{ layout: "tabs" }} />

      {paymentError && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3">
          <p className="text-sm text-red-600">{paymentError}</p>
        </div>
      )}

      <Button type="submit" className="w-full text-base py-6" disabled={processing || !ready}>
        {processing ? "Processing…" : label ?? `Pay ${fmt(amount)}`}
      </Button>

      <button
        type="button"
        onClick={onCancel}
        className="w-full text-sm text-muted-foreground hover:text-foreground text-center"
        disabled={processing}
      >
        ← Cancel
      </button>

      <p className="text-xs text-muted-foreground text-center">
        Powered by Stripe. PlayOn never stores your card details.
      </p>
    </form>
  );
}

export interface InlinePaymentDialogProps {
  open: boolean;
  clientSecret: string;
  publishableKey: string;
  amount: number;
  basePrice?: number;
  serviceFeeAmount?: number;
  title?: string;
  label?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

const stripePromiseCache: Record<string, Promise<Stripe | null>> = {};

function getStripePromise(publishableKey: string): Promise<Stripe | null> {
  if (!stripePromiseCache[publishableKey]) {
    stripePromiseCache[publishableKey] = loadStripe(publishableKey);
  }
  return stripePromiseCache[publishableKey];
}

export function InlinePaymentDialog({
  open,
  clientSecret,
  publishableKey,
  amount,
  basePrice,
  serviceFeeAmount,
  title = "Complete Payment",
  label,
  onSuccess,
  onCancel,
}: InlinePaymentDialogProps) {
  const stripePromise = getStripePromise(publishableKey);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {clientSecret && (
          <CheckoutElementsProvider
            stripe={stripePromise}
            options={{
              clientSecret,
              elementsOptions: {
                appearance: {
                  theme: "stripe",
                  variables: { colorPrimary: "#16a34a" },
                },
              },
            }}
          >
            <InnerPaymentForm
              amount={amount}
              basePrice={basePrice}
              serviceFeeAmount={serviceFeeAmount}
              label={label}
              onSuccess={onSuccess}
              onCancel={onCancel}
            />
          </CheckoutElementsProvider>
        )}
      </DialogContent>
    </Dialog>
  );
}
