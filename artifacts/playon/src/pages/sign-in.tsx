import React, { useEffect } from "react";
import { SignIn } from "@clerk/react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function SignInPage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inviteToken = params.get("invite");
    if (inviteToken) {
      sessionStorage.setItem("signupInviteToken", inviteToken);
    }
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(195,14%,14%)] px-4 py-12">
      <div className="w-full max-w-md">
        <SignIn
          routing="path"
          path={`${basePath}/sign-in`}
          afterSignInUrl={`${basePath}/sso-callback`}
        />
      </div>
    </div>
  );
}
