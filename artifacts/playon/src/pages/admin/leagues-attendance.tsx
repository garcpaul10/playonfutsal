import React from "react";
import { useRoute } from "wouter";
import { AttendanceHistoryPage } from "./attendance-history";

export default function LeagueFixtureAttendance() {
  const [, params] = useRoute("/admin/leagues/fixtures/:fixtureId/attendance");
  const fixtureId = Number(params?.fixtureId);
  return (
    <AttendanceHistoryPage
      fetchUrl={`/leagues/fixtures/${fixtureId}/attendance`}
      queryKey={["league-fixture-attendance", fixtureId]}
      backHref="/admin/leagues"
      backLabel="Leagues"
    />
  );
}
