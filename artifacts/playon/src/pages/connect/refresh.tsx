import React from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ConnectRefresh() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="max-w-md w-full mx-auto px-6 text-center space-y-6">
        <div className="flex justify-center">
          <div className="rounded-full bg-amber-100 dark:bg-amber-900/30 p-4">
            <AlertCircle className="h-12 w-12 text-amber-600 dark:text-amber-400" />
          </div>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">Link expired</h1>
          <p className="text-muted-foreground">
            Your setup link has expired. This happens if you took too long to complete the form or navigated away.
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          Please ask your admin to re-send the invite link. Once you have a new link, click it to pick up where you left off.
        </p>
        <Button variant="outline" onClick={() => window.close()}>
          Close this window
        </Button>
      </div>
    </div>
  );
}
