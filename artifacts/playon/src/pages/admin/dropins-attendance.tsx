import React from "react";
import { useRoute } from "wouter";
import { AttendanceHistoryPage } from "./attendance-history";

export default function DropinAttendance() {
  const [, params] = useRoute("/admin/dropins/:id/attendance");
  const id = Number(params?.id);
  return (
    <AttendanceHistoryPage
      fetchUrl={`/dropins/${id}/attendance`}
      queryKey={["dropin-attendance", id]}
      backHref="/admin/dropins"
      backLabel="Drop-ins"
    />
  );
}
