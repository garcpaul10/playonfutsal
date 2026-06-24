import React, { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@clerk/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Loader2, Check, AlertCircle, Camera, Upload } from "lucide-react";
import playonLogo from "@assets/PlayOn_RBG_Trans_1780083327599.png";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

const ROLE_OPTIONS = [
  {
    value: "player",
    label: "I play",
    emoji: "⚽",
    description: "Register for leagues, drop-ins & camps",
  },
  {
    value: "parent",
    label: "My child plays",
    emoji: "👨‍👧",
    description: "Manage your child's registrations",
  },
  {
    value: "coach_manager",
    label: "I coach or manage a team",
    emoji: "📋",
    description: "Register & manage a team roster",
  },
];

const COACH_TYPES = [
  {
    value: "team_coach" as const,
    label: "Team Coach",
    emoji: "🏃",
    description: "On the bench or field. Appears on the official team roster.",
  },
  {
    value: "team_manager" as const,
    label: "Team Manager",
    emoji: "📁",
    description: "Handles admin, registrations, and roster management.",
  },
];

const GENDER_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

function useMyProfile(enabled: boolean) {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const token = await getToken();
      const r = await fetch(`${API_BASE}/me`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
      });
      if (!r.ok) return null;
      return r.json();
    },
    enabled,
    staleTime: 60_000,
  });
}

export default function OnboardingPage() {
  const [, setLocation] = useLocation();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const qc = useQueryClient();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set(["player"]));
  const [coachType, setCoachType] = useState<"team_coach" | "team_manager" | null>(null);
  const [phone, setPhone] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [idPhotoFile, setIdPhotoFile] = useState<File | null>(null);
  const [idPhotoPreview, setIdPhotoPreview] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const photoInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const { data: myProfile, isLoading: profileLoading } = useMyProfile(!!isSignedIn && isLoaded);

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      setLocation("/sign-in");
    }
  }, [isLoaded, isSignedIn, setLocation]);

  // Pre-fill form for returning users who have roles but haven't completed ID verification
  useEffect(() => {
    if (!myProfile) return;

    const hasRoles = Array.isArray(myProfile.roles) && myProfile.roles.length > 0;
    const idVerified = !!myProfile.idVerified;

    // Fully completed — send to dashboard
    if (hasRoles && idVerified) {
      setLocation("/dashboard");
      return;
    }

    // Returning user with roles but no ID verification — pre-fill what we have
    if (hasRoles && !idVerified) {
      if (myProfile.firstName) setFirstName(myProfile.firstName);
      if (myProfile.lastName) setLastName(myProfile.lastName);
      if (myProfile.phone) setPhone(myProfile.phone);
      if (myProfile.dateOfBirth) {
        const dob = myProfile.dateOfBirth;
        if (typeof dob === "string") {
          setDateOfBirth(dob.split("T")[0]);
        } else if (dob instanceof Date) {
          setDateOfBirth(dob.toISOString().split("T")[0]);
        }
      }
      if (myProfile.gender) setGender(myProfile.gender);
      if (myProfile.addressLine1) setAddressLine1(myProfile.addressLine1);
      if (myProfile.city) setCity(myProfile.city);
      if (myProfile.state) setState(myProfile.state);
      if (myProfile.zip) setZip(myProfile.zip);
      const existingRoles: string[] = Array.isArray(myProfile.roles) ? myProfile.roles : [];
      if (existingRoles.length > 0) {
        const mapped = existingRoles.map((r) =>
          r === "team_coach" || r === "team_manager" ? "coach_manager" : r
        );
        setSelectedRoles(new Set(mapped));
        if (existingRoles.includes("team_coach")) setCoachType("team_coach");
        else if (existingRoles.includes("team_manager")) setCoachType("team_manager");
      }
    }
  }, [myProfile, setLocation]);

  if (!isLoaded || !isSignedIn || profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[hsl(195,14%,14%)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  function toggleRole(value: string) {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  }

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setIdPhotoFile(file);
    const url = URL.createObjectURL(file);
    setIdPhotoPreview(url);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!firstName.trim()) { setError("Please enter your first name."); return; }
    if (!lastName.trim()) { setError("Please enter your last name."); return; }
    if (phone.replace(/\D/g, "").length < 7) { setError("Please enter a valid phone number."); return; }
    if (!dateOfBirth) { setError("Please enter your date of birth."); return; }
    if (!gender) { setError("Please select your gender."); return; }
    if (selectedRoles.size === 0) { setError("Please select at least one role."); return; }
    if (selectedRoles.has("coach_manager") && !coachType) {
      setError("Please select whether you are a coach or manager.");
      return;
    }
    if (!addressLine1.trim()) { setError("Please enter your street address."); return; }
    if (!city.trim()) { setError("Please enter your city."); return; }
    if (!state.trim()) { setError("Please enter your state (2-letter code)."); return; }
    if (!/^\d{5}$/.test(zip.trim())) { setError("Please enter a valid 5-digit ZIP code."); return; }
    if (!idPhotoFile) { setError("Please upload a photo of your government-issued ID."); return; }
    if (!confirmed) { setError("Please confirm that your information is accurate."); return; }

    let finalRoles: string[];
    if (selectedRoles.has("coach_manager")) {
      const otherRoles = Array.from(selectedRoles).filter((r) => r !== "coach_manager");
      finalRoles = [...otherRoles, coachType!];
    } else {
      finalRoles = Array.from(selectedRoles);
    }

    setSaving(true);
    try {
      const token = await getToken();
      if (!token) {
        throw new Error("Session expired. Please refresh the page and try again.");
      }

      const TIMEOUT_MS = 30_000;

      function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        return fetch(url, { ...init, signal: controller.signal }).finally(() =>
          clearTimeout(timer),
        );
      }

      // Step 1: upload ID photo
      const photoFormData = new FormData();
      photoFormData.append("photo", idPhotoFile);
      const photoRes = await fetchWithTimeout(`${API_BASE}/me/id-photo`, {
        method: "POST",
        credentials: "include",
        headers: { Authorization: `Bearer ${token}` },
        body: photoFormData,
      });
      if (!photoRes.ok) {
        const bd = await photoRes.json().catch(() => ({}));
        throw new Error(bd?.error ?? `Photo upload failed (${photoRes.status})`);
      }

      // Step 2: PATCH /me — profile fields
      const patchRes = await fetchWithTimeout(`${API_BASE}/me`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          roles: finalRoles,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone,
          dateOfBirth,
          gender,
        }),
      });
      if (!patchRes.ok) {
        const bd = await patchRes.json().catch(() => ({}));
        throw new Error(bd?.error ?? `Server error ${patchRes.status}`);
      }

      // Step 3: POST /me/verify-id — identity verification fields
      const signupInviteToken = sessionStorage.getItem("signupInviteToken");
      const verifyBody: Record<string, string> = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        dob: dateOfBirth,
        addressLine1: addressLine1.trim(),
        city: city.trim(),
        state: state.trim().toUpperCase().slice(0, 2),
        zip: zip.trim(),
      };
      if (signupInviteToken) {
        verifyBody.inviteToken = signupInviteToken;
      }
      const verifyRes = await fetchWithTimeout(`${API_BASE}/me/verify-id`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(verifyBody),
      });
      if (!verifyRes.ok) {
        const bd = await verifyRes.json().catch(() => ({}));
        let errMsg: string = bd?.error ?? `Verification failed (${verifyRes.status})`;
        // Rewrite the generic age error to the correct minimum age for this path
        if (verifyRes.status === 403 && errMsg.includes("must be") && errMsg.includes("or older")) {
          const minAge = signupInviteToken ? 13 : 18;
          errMsg = `Identity verification failed: must be ${minAge} or older to create an account.`;
        }
        throw new Error(errMsg);
      }

      qc.invalidateQueries({ queryKey: ["me"] });
      setLocation("/dashboard");
    } catch (err: any) {
      const msg =
        err?.name === "AbortError"
          ? "The request timed out. Please check your connection and try again."
          : (err?.message ?? "Could not save your profile. Please try again.");
      setError(msg);
      setSaving(false);
    }
  }

  const showsCoachManager = selectedRoles.has("coach_manager");
  const isReturningUser = !!(myProfile && Array.isArray(myProfile.roles) && myProfile.roles.length > 0 && !myProfile.idVerified);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(195,14%,14%)] px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="bg-[#222E2E] rounded-2xl border border-[#2b353a] shadow-2xl overflow-hidden">
          <div className="p-8">
            <div className="flex justify-center mb-8">
              <img src={playonLogo} alt="PlayOn Futsal" className="h-16 object-contain opacity-90" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-white mb-1">
                  {isReturningUser ? "Complete your account" : "Almost done!"}
                </h2>
                <p className="text-[#99a1a3] text-sm">
                  {isReturningUser
                    ? "Please add your address and upload a government-issued ID to finish verification."
                    : "Set up your profile and verify your identity to get started."}
                </p>
              </div>

              {/* First & Last Name */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="onboardingFirstName" className="text-white text-sm font-medium">
                    First name
                  </Label>
                  <Input
                    id="onboardingFirstName"
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Jane"
                    autoComplete="given-name"
                    className="h-11 bg-[#1a2a2a] border-[#2b4040] text-white placeholder:text-[#99a1a3] focus:border-primary focus:ring-primary"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="onboardingLastName" className="text-white text-sm font-medium">
                    Last name
                  </Label>
                  <Input
                    id="onboardingLastName"
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Smith"
                    autoComplete="family-name"
                    className="h-11 bg-[#1a2a2a] border-[#2b4040] text-white placeholder:text-[#99a1a3] focus:border-primary focus:ring-primary"
                  />
                </div>
              </div>

              {/* Date of birth */}
              <div className="space-y-1.5">
                <Label htmlFor="onboardingDob" className="text-white text-sm font-medium">
                  Date of birth
                </Label>
                <input
                  id="onboardingDob"
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  max={new Date().toISOString().split("T")[0]}
                  className="flex h-11 w-full rounded-md border border-[#2b4040] bg-[#1a2a2a] px-3 py-2 text-sm text-white placeholder:text-[#99a1a3] focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>

              {/* Gender */}
              <div className="space-y-1.5">
                <Label className="text-white text-sm font-medium">Gender</Label>
                <div className="grid grid-cols-2 gap-2">
                  {GENDER_OPTIONS.map((opt) => {
                    const selected = gender === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setGender(opt.value)}
                        className={`relative flex items-center justify-center py-2.5 px-3 rounded-xl border-2 text-sm font-medium transition-all ${
                          selected
                            ? "border-primary bg-primary/15 text-primary"
                            : "border-[#2b4040] bg-[#1a2a2a] text-white hover:bg-[#1e3030]"
                        }`}
                      >
                        {selected && (
                          <span className="absolute top-1 right-1 flex items-center justify-center w-4 h-4 rounded-full bg-primary">
                            <Check className="h-2.5 w-2.5 text-white" />
                          </span>
                        )}
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Phone */}
              <div className="space-y-1.5">
                <Label htmlFor="onboardingPhone" className="text-white text-sm font-medium">
                  Phone number
                </Label>
                <PhoneInput
                  id="onboardingPhone"
                  value={phone}
                  onChange={(formatted) => setPhone(formatted)}
                  className="bg-[#1a2a2a] border-[#2b4040] text-white placeholder:text-[#99a1a3] h-11 focus:border-primary"
                  autoComplete="tel"
                />
                <p className="text-[#99a1a3] text-xs">We'll text you about open slots, game reminders, and registration updates.</p>
              </div>

              {/* Role selection */}
              <div className="space-y-2">
                <Label className="text-white text-sm font-medium">What best describes you?</Label>
                <p className="text-[#99a1a3] text-xs -mt-1">You can hold multiple roles.</p>
                <div className="space-y-2 mt-2">
                  {ROLE_OPTIONS.map((opt) => {
                    const selected = selectedRoles.has(opt.value);
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => toggleRole(opt.value)}
                        className={`relative w-full flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all ${
                          selected
                            ? "border-primary bg-primary/15"
                            : "border-[#2b4040] bg-[#1a2a2a] hover:bg-[#1e3030]"
                        }`}
                      >
                        {selected && (
                          <span className="absolute top-2 right-2 flex items-center justify-center w-5 h-5 rounded-full bg-primary">
                            <Check className="h-3 w-3 text-white" />
                          </span>
                        )}
                        <span className="text-2xl shrink-0">{opt.emoji}</span>
                        <div>
                          <span className={`font-semibold text-sm block ${selected ? "text-primary" : "text-white"}`}>
                            {opt.label}
                          </span>
                          <span className="text-[#99a1a3] text-xs">{opt.description}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Inline coach/manager toggle */}
              {showsCoachManager && (
                <div className="space-y-2 pl-4 border-l-2 border-primary/40">
                  <p className="text-white text-sm font-medium">What's your role on the team?</p>
                  <p className="text-[#99a1a3] text-xs">This determines whether you appear on the official roster.</p>
                  <div className="flex gap-2 mt-2">
                    {COACH_TYPES.map((opt) => {
                      const selected = coachType === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setCoachType(opt.value)}
                          className={`flex-1 flex flex-col items-start gap-1 p-3 rounded-xl border-2 text-left transition-all ${
                            selected
                              ? "border-primary bg-primary/15"
                              : "border-[#2b4040] bg-[#1a2a2a] hover:bg-[#1e3030]"
                          }`}
                        >
                          <span className="text-xl">{opt.emoji}</span>
                          <span className={`font-semibold text-xs block ${selected ? "text-primary" : "text-white"}`}>
                            {opt.label}
                          </span>
                          <span className="text-[#99a1a3] text-[11px] leading-tight">{opt.description}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Address */}
              <div className="space-y-3">
                <div>
                  <Label className="text-white text-sm font-medium block mb-1">Home address</Label>
                  <p className="text-[#99a1a3] text-xs mb-2">Must match your government-issued ID.</p>
                </div>
                <Input
                  type="text"
                  value={addressLine1}
                  onChange={(e) => setAddressLine1(e.target.value)}
                  placeholder="123 Main St"
                  autoComplete="street-address"
                  className="h-11 bg-[#1a2a2a] border-[#2b4040] text-white placeholder:text-[#99a1a3] focus:border-primary focus:ring-primary"
                />
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <Input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="City"
                      autoComplete="address-level2"
                      className="h-11 bg-[#1a2a2a] border-[#2b4040] text-white placeholder:text-[#99a1a3] focus:border-primary focus:ring-primary"
                    />
                  </div>
                  <Input
                    type="text"
                    value={state}
                    onChange={(e) => setState(e.target.value.toUpperCase().slice(0, 2))}
                    placeholder="ST"
                    autoComplete="address-level1"
                    maxLength={2}
                    className="h-11 bg-[#1a2a2a] border-[#2b4040] text-white placeholder:text-[#99a1a3] focus:border-primary focus:ring-primary text-center font-mono"
                  />
                </div>
                <Input
                  type="text"
                  value={zip}
                  onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
                  placeholder="ZIP Code"
                  autoComplete="postal-code"
                  inputMode="numeric"
                  maxLength={5}
                  className="h-11 bg-[#1a2a2a] border-[#2b4040] text-white placeholder:text-[#99a1a3] focus:border-primary focus:ring-primary"
                />
              </div>

              {/* ID photo upload */}
              <div className="space-y-2">
                <Label className="text-white text-sm font-medium block">Government-issued ID photo</Label>
                <p className="text-[#99a1a3] text-xs">Upload a clear photo of your driver's license or passport. JPEG or PNG, max 10 MB.</p>
                {idPhotoPreview ? (
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-3">
                    <img
                      src={idPhotoPreview}
                      alt="ID preview"
                      className="max-h-40 w-full object-contain rounded-lg"
                    />
                    <p className="text-primary text-xs text-center font-medium">
                      <Check className="h-3 w-3 inline mr-1" />
                      Photo selected
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-[#2b4040] bg-[#1a2a2a] hover:bg-[#1e3030] transition-colors py-2 text-xs text-white font-medium"
                      >
                        <Camera className="h-4 w-4 text-[#99a1a3]" />
                        Retake photo
                      </button>
                      <button
                        type="button"
                        onClick={() => photoInputRef.current?.click()}
                        className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-[#2b4040] bg-[#1a2a2a] hover:bg-[#1e3030] transition-colors py-2 text-xs text-white font-medium"
                      >
                        <Upload className="h-4 w-4 text-[#99a1a3]" />
                        Choose file
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => cameraInputRef.current?.click()}
                      className="flex-1 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#2b4040] bg-[#1a2a2a] hover:bg-[#1e3030] hover:border-[#3a5050] transition-colors py-6"
                    >
                      <div className="w-10 h-10 rounded-full bg-[#1e3030] flex items-center justify-center">
                        <Camera className="h-5 w-5 text-[#99a1a3]" />
                      </div>
                      <p className="text-white text-sm font-medium">Take a photo</p>
                      <p className="text-[#99a1a3] text-xs">Use camera</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => photoInputRef.current?.click()}
                      className="flex-1 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#2b4040] bg-[#1a2a2a] hover:bg-[#1e3030] hover:border-[#3a5050] transition-colors py-6"
                    >
                      <div className="w-10 h-10 rounded-full bg-[#1e3030] flex items-center justify-center">
                        <Upload className="h-5 w-5 text-[#99a1a3]" />
                      </div>
                      <p className="text-white text-sm font-medium">Upload from files</p>
                      <p className="text-[#99a1a3] text-xs">JPEG or PNG</p>
                    </button>
                  </div>
                )}
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoChange}
                  className="hidden"
                />
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={handlePhotoChange}
                  className="hidden"
                />
              </div>

              {/* Confirmation checkbox */}
              <label className="flex items-start gap-3 cursor-pointer group">
                <div
                  onClick={() => setConfirmed((v) => !v)}
                  className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                    confirmed
                      ? "bg-primary border-primary"
                      : "border-[#2b4040] bg-[#1a2a2a] group-hover:border-primary/50"
                  }`}
                >
                  {confirmed && <Check className="h-3 w-3 text-white" />}
                </div>
                <span className="text-[#99a1a3] text-sm leading-snug">
                  I confirm this information is accurate and matches my government-issued ID.
                </span>
              </label>

              {error && (
                <div className="rounded-lg bg-red-900/30 border border-red-800/50 px-4 py-3 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}

              <Button
                type="submit"
                disabled={saving || selectedRoles.size === 0 || !confirmed}
                className="w-full h-11 bg-primary hover:bg-primary/85 text-primary-foreground font-semibold text-sm disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Complete setup →"}
              </Button>

              <p className="text-[#99a1a3] text-xs text-center">
                Your ID photo is stored securely and only accessible to PlayOn administrators.
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
