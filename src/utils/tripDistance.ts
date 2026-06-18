import { Timestamp } from 'firebase/firestore';
import { Trip } from '../types';

/** Planned route distance from depot via Google Directions (km). */
export function getPlannedDistanceKm(trip: Trip): number {
  return trip.totalDistance || 0;
}

/** Planned route duration from depot via Google Directions (minutes). */
export function getPlannedDurationMinutes(trip: Trip): number {
  return trip.totalDuration || 0;
}

/** Actual GPS odometer distance; falls back to live distanceCovered during active trips. */
export function getActualDistanceKm(trip: Trip): number {
  if (trip.actualDistanceKm != null) return trip.actualDistanceKm;
  return trip.distanceCovered || 0;
}

function timestampToMillis(
  value?: Timestamp | null | { seconds?: number; toMillis?: () => number }
): number | null {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  return null;
}

/** Actual elapsed trip time from start to completion (or now if in progress). */
export function getActualDurationMinutes(trip: Trip, nowMs = Date.now()): number {
  if (trip.actualDurationMinutes != null) return trip.actualDurationMinutes;

  const startedMs = timestampToMillis(trip.startedAt);
  if (startedMs == null) return 0;

  const endedMs = timestampToMillis(trip.completedAt) ?? (trip.status === 'in_progress' ? nowMs : null);
  if (endedMs == null) return 0;

  return Math.max(0, Math.round((endedMs - startedMs) / 60000));
}

export function formatDurationMinutes(minutes: number): string {
  if (minutes <= 0) return '0 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function getTwoYearsAgoTimestamp(): Date {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 2);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function computeActualDurationMinutes(
  startedAt?: Timestamp | null,
  completedAt?: Timestamp | null
): number | undefined {
  const startedMs = timestampToMillis(startedAt);
  const completedMs = timestampToMillis(completedAt);
  if (startedMs == null || completedMs == null) return undefined;
  return Math.max(0, Math.round((completedMs - startedMs) / 60000));
}
