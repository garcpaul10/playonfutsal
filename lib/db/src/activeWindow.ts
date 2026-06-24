export interface EventWithWindow {
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
  durationMinutes?: number | null;
  scheduledAt?: Date | string | null;
  activeOverride?: string | null;
}

const BUFFER_MS = 30 * 60 * 1000;

export function getEventWindow(event: EventWithWindow): { windowStart: Date; windowEnd: Date } | null {
  let start: Date | null = null;
  let end: Date | null = null;

  if (event.startsAt) {
    start = new Date(event.startsAt as any);
    if (event.endsAt) {
      end = new Date(event.endsAt as any);
    } else if (event.durationMinutes) {
      end = new Date(start.getTime() + event.durationMinutes * 60 * 1000);
    }
  } else if (event.scheduledAt) {
    start = new Date(event.scheduledAt as any);
    if (event.durationMinutes) {
      end = new Date(start.getTime() + event.durationMinutes * 60 * 1000);
    }
  }

  if (!start || !end) return null;

  return {
    windowStart: new Date(start.getTime() - BUFFER_MS),
    windowEnd: new Date(end.getTime() + BUFFER_MS),
  };
}

export function isEventActive(event: EventWithWindow): boolean {
  if (event.activeOverride === "active") return true;
  if (event.activeOverride === "closed") return false;

  const window = getEventWindow(event);
  if (!window) return false;

  const now = new Date();
  return now >= window.windowStart && now <= window.windowEnd;
}
