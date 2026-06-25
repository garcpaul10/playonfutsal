import React, { useState, useEffect } from "react";
import { Link, Redirect } from "wouter";
import { useGetMyProfile } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { format } from "date-fns";
import QRCode from "qrcode";
import {
  QrCode, Sun, ChevronLeft, CheckCircle2, Clock, Tent,
  ArrowRight, AlertCircle, Users,
} from "lucide-react";

import { API_BASE as API } from "@/lib/api-base";

function useAuthHeaders() {
  const { getToken } = useAuth();
  return async () => {
    const token = await getToken();
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  };
}

interface TodayEvent {
  type: string;
  id: number;
  name: string;
  dayId?: number | null;
  date?: string;
  startTime?: string | null;
  endTime?: string | null;
  checkedIn: boolean;
}

interface ChildQrData {
  youthUserId: number;
  firstName: string | null;
  lastName: string | null;
  relationship: string;
  isPrimary: boolean;
  qrCode: string | null;
  playonId: string | null;
  todayEvents: TodayEvent[];
  hasEventsToday: boolean;
}

/** Detect overlapping events: events within 2 hours of each other */
function hasOverlappingEvents(events: TodayEvent[]): boolean {
  if (events.length <= 1) return false;
  const times = events
    .map(e => e.startTime)
    .filter((t): t is string => t != null)
    .map(t => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    });
  for (let i = 0; i < times.length; i++) {
    for (let j = i + 1; j < times.length; j++) {
      if (Math.abs(times[i] - times[j]) < 120) return true;
    }
  }
  return false;
}

function ChildQrCard({ child, isOpen, onToggle }: {
  child: ChildQrData;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [selectedEventIdx, setSelectedEventIdx] = useState<number>(0);

  const name = `${child.firstName ?? ""} ${child.lastName ?? ""}`.trim() || `Child #${child.youthUserId}`;
  const initials = (child.firstName?.[0] ?? "?").toUpperCase();
  const checkedIn = child.todayEvents.some(e => e.checkedIn);

  useEffect(() => {
    if (isOpen && child.qrCode) {
      QRCode.toDataURL(child.qrCode, {
        width: 220,
        margin: 2,
        color: { dark: "#1E2829", light: "#FFFFFF" },
      })
        .then(setQrDataUrl)
        .catch(() => {});
    }
  }, [isOpen, child.qrCode]);

  return (
    <Card className={`overflow-hidden transition-all ${isOpen ? "ring-2 ring-primary" : ""}`}>
      <button className="w-full text-left" onClick={onToggle}>
        <div className="flex items-center gap-4 p-4">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0 ${
            checkedIn
              ? "bg-green-100 text-green-700"
              : "bg-primary/10 text-primary"
          }`}>
            {checkedIn ? <CheckCircle2 className="h-6 w-6" /> : initials}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold">{name}</span>
              {child.isPrimary && (
                <Badge variant="secondary" className="text-xs">Primary</Badge>
              )}
              {checkedIn && (
                <Badge className="text-xs bg-green-500 text-white">Checked in</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground capitalize mt-0.5">{child.relationship}</p>

            {child.hasEventsToday ? (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {child.todayEvents.map((ev, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
                      ev.checkedIn
                        ? "bg-green-100 text-green-700"
                        : "bg-blue-100 text-blue-700"
                    }`}
                  >
                    <Tent className="h-2.5 w-2.5" />
                    {ev.name}
                    {ev.startTime && ` · ${ev.startTime}`}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <Clock className="h-3 w-3" /> No events today
              </p>
            )}
          </div>

          <div className="flex-shrink-0">
            <QrCode className={`h-5 w-5 ${isOpen ? "text-primary" : "text-muted-foreground"}`} />
          </div>
        </div>
      </button>

      {isOpen && (
        <div className="border-t bg-muted/20 px-4 py-5 flex flex-col items-center gap-4">
          {child.qrCode ? (
            <>
              <div className="bg-white p-4 rounded-2xl shadow-sm">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt={`QR code for ${name}`}
                    className="w-[220px] h-[220px]"
                    style={{ imageRendering: "pixelated" }}
                  />
                ) : (
                  <div className="w-[220px] h-[220px] flex items-center justify-center">
                    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
              </div>

              <div className="text-center">
                <p className="font-semibold">{name}</p>
                {child.playonId && (
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">{child.playonId}</p>
                )}
                <p className="text-xs text-muted-foreground font-mono mt-0.5 break-all">{child.qrCode}</p>
              </div>

              {child.todayEvents.length > 0 && (
                <div className="w-full space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Today's Events</p>

                  {/* Event chooser: shown when multiple events overlap in time */}
                  {hasOverlappingEvents(child.todayEvents) && !child.todayEvents.every(e => e.checkedIn) && (
                    <div className="rounded-lg border bg-amber-500/10 border-amber-500/20 p-3 space-y-2">
                      <p className="text-xs font-medium text-amber-700">
                        Multiple events overlap — which one is {child.firstName ?? "this child"} heading to?
                      </p>
                      <div className="space-y-1">
                        {child.todayEvents.map((ev, i) => (
                          <button
                            key={i}
                            className={`w-full text-left rounded-md px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                              selectedEventIdx === i
                                ? "bg-primary text-primary-foreground"
                                : "bg-background border hover:bg-muted"
                            }`}
                            onClick={() => setSelectedEventIdx(i)}
                          >
                            <span className="flex-1 font-medium">{ev.name}</span>
                            {ev.startTime && <span className="text-xs opacity-70">{ev.startTime}</span>}
                            {ev.checkedIn && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />}
                          </button>
                        ))}
                      </div>
                      {child.todayEvents[selectedEventIdx] && (
                        <p className="text-xs text-muted-foreground">
                          Show the QR below to the coach or staff for <strong>{child.todayEvents[selectedEventIdx].name}</strong>
                        </p>
                      )}
                    </div>
                  )}

                  {child.todayEvents.map((ev, i) => (
                    <div
                      key={i}
                      className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                        ev.checkedIn
                          ? "bg-green-500/10 border border-green-500/20"
                          : "bg-background border"
                      }`}
                    >
                      <div>
                        <span className="font-medium">{ev.name}</span>
                        {ev.startTime && (
                          <span className="text-muted-foreground ml-2">{ev.startTime}</span>
                        )}
                      </div>
                      {ev.checkedIn ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <span className="text-xs text-muted-foreground">Pending</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <p className="text-xs text-muted-foreground text-center">
                Show this QR code to the coach or staff member at check-in
              </p>
            </>
          ) : (
            <div className="text-center py-4">
              <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No QR code found for this player.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Ask the player to log in and complete their player profile.
              </p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export default function GuardianChildrenQR() {
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();
  const getHeaders = useAuthHeaders();
  const [openChildId, setOpenChildId] = useState<number | null>(null);

  const { data, isLoading } = useQuery<{ children: ChildQrData[] }>({
    queryKey: ["children-qr-today"],
    enabled: !profileLoading && !!profile,
    queryFn: async () => {
      const headers = await getHeaders();
      const r = await fetch(`${API}/me/children-qr-today`, { headers });
      if (!r.ok) throw new Error("Failed to load children QR data");
      return r.json();
    },
    refetchInterval: 60000,
  });

  if (profileLoading) {
    return (
      <Layout>
        <div className="container max-w-lg mx-auto px-4 py-8">
          <Skeleton className="h-64" />
        </div>
      </Layout>
    );
  }

  if (!profile) return <Redirect to="/sign-in" />;

  const children = data?.children ?? [];
  const withEventsToday = children.filter(c => c.hasEventsToday);

  return (
    <Layout>
      <div className="container max-w-lg mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center gap-3">
          <Link href="/guardian/children">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold font-sans uppercase tracking-tight text-primary">
              Check-in QR Codes
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {format(new Date(), "EEEE, MMMM d")} · Tap a child to reveal their QR
            </p>
          </div>
        </div>

        {withEventsToday.length > 0 && (
          <div className="flex items-center gap-2 rounded-xl bg-blue-500/10 border border-blue-500/20 px-4 py-2.5 text-sm">
            <Sun className="h-4 w-4 text-blue-500 flex-shrink-0" />
            <span className="text-blue-700">
              {withEventsToday.length} child{withEventsToday.length !== 1 ? "ren have" : " has"} events today
            </span>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}
          </div>
        ) : children.length === 0 ? (
          <Card className="p-12 text-center border-dashed">
            <Users className="h-8 w-8 mx-auto mb-3 text-muted-foreground opacity-40" />
            <p className="text-muted-foreground mb-4">No approved youth accounts linked yet.</p>
            <Link href="/guardian/children">
              <Button variant="outline">
                <ArrowRight className="h-4 w-4 mr-2" /> Manage Children
              </Button>
            </Link>
          </Card>
        ) : (
          <div className="space-y-3">
            {children.map(child => (
              <ChildQrCard
                key={child.youthUserId}
                child={child}
                isOpen={openChildId === child.youthUserId}
                onToggle={() =>
                  setOpenChildId(prev =>
                    prev === child.youthUserId ? null : child.youthUserId
                  )
                }
              />
            ))}
          </div>
        )}

        <div className="text-center">
          <Link href="/guardian/children">
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              Manage Youth Accounts
            </Button>
          </Link>
        </div>
      </div>
    </Layout>
  );
}
