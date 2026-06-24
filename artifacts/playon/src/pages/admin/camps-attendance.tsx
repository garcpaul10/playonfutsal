import React from "react";
import { useRoute } from "wouter";
import { AttendanceHistoryPage } from "./attendance-history";

export default function CampDayAttendance() {
  const [, params] = useRoute("/admin/camps/:campId/attendance/:dayId");
  const campId = Number(params?.campId);
  const dayId = Number(params?.dayId);
  return (
    <AttendanceHistoryPage
      fetchUrl={`/camps/${campId}/days/${dayId}/attendance`}
      queryKey={["camp-day-attendance", campId, dayId]}
      backHref="/admin/camps"
      backLabel="Camps"
    />
  );
}
