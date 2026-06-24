import { useEffect } from "react";
import { useLocation } from "wouter";

export default function Profile() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate("/account?tab=profile", { replace: true });
  }, [navigate]);
  return null;
}
