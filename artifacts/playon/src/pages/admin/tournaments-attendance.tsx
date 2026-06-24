import React from "react";
import { useRoute } from "wouter";
import { AttendanceHistoryPage } from "./attendance-history";

export default function TournamentFixtureAttendance() {
  const [, params] = useRoute("/admin/tournaments/:id/fixtures/:fixtureId/attendance");
  const id = Number(params?.id);
  const fixtureId = Number(params?.fixtureId);
  return (
    <AttendanceHistoryPage
      fetchUrl={`/tournaments/${id}/fixtures/${fixtureId}/attendance`}
      queryKey={["tournament-fixture-attendance", id, fixtureId]}
      backHref="/admin/tournaments"
      backLabel="Tournaments"
    />
  );
}
