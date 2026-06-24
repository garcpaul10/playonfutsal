import React from "react";
import { CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ConnectComplete() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="max-w-md w-full mx-auto px-6 text-center space-y-6">
        <div className="flex justify-center">
          <div className="rounded-full bg-green-100 dark:bg-green-900/30 p-4">
            <CheckCircle className="h-12 w-12 text-green-600 dark:text-green-400" />
          </div>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">You're all set!</h1>
          <p className="text-muted-foreground">
            Your payout account has been connected. You'll start receiving payouts to your linked bank account automatically.
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          Any payouts that were queued while you were setting up will be released shortly.
        </p>
        <Button variant="outline" onClick={() => window.close()}>
          Close this window
        </Button>
      </div>
    </div>
  );
}
