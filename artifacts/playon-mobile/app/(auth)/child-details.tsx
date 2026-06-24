import { useRouter, Href } from "expo-router";
import { useEffect } from "react";

export default function ChildDetailsScreen() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/(tabs)" as Href);
  }, []);

  return null;
}
