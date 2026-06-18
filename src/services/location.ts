import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import firebaseService from './firebase';
import { UserLocation } from '../types';

const LOCATION_TASK_NAME = 'BACKGROUND_LOCATION_TASK';
const LOCATION_UPDATE_INTERVAL = 5000;
const LOCATION_UPDATE_DISTANCE = 10;
const MIN_SEGMENT_KM = 0.02;

let currentTripId: string | null = null;
let tripTotalDistance = 0;
let baseDistanceCovered = 0;
let lastTrackedPoint: { lat: number; lon: number } | null = null;
let accumulatedKm = 0;

export interface TripTrackingOptions {
  distanceCovered?: number;
  totalDistance?: number;
}

export const setCurrentTripId = (tripId: string | null, options?: TripTrackingOptions) => {
  currentTripId = tripId;
  if (tripId) {
    baseDistanceCovered = options?.distanceCovered ?? 0;
    tripTotalDistance = options?.totalDistance ?? 0;
    lastTrackedPoint = null;
    accumulatedKm = 0;
  } else {
    lastTrackedPoint = null;
    accumulatedKm = 0;
    tripTotalDistance = 0;
    baseDistanceCovered = 0;
  }
};

export const getTripDistanceKm = (): number => {
  return Math.round((baseDistanceCovered + accumulatedKm) * 10) / 10;
};

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }: any) => {
  if (error) {
    console.error('Background location task error:', error);
    return;
  }
  if (data) {
    const { locations } = data;
    if (locations && locations.length > 0) {
      const location = locations[locations.length - 1];
      await updateUserLocationInRealtimeDB(location);
    }
  }
});

async function updateUserLocationInRealtimeDB(location: Location.LocationObject) {
  const auth = firebaseService.auth;
  const user = auth.currentUser;
  if (!user) return;

  const locationData: UserLocation = {
    uid: user.uid,
    displayName: user.displayName || 'Unknown',
    role: 'driver',
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    timestamp: Date.now(),
    speed: location.coords.speed || 0,
    heading: location.coords.heading || 0,
    isActive: true,
    // Omit currentTrip entirely when null — Firebase RTDB rejects undefined values
    ...(currentTripId ? { currentTrip: currentTripId } : {}),
  };

  await firebaseService.setRealtime(`live-locations/${user.uid}`, locationData);

  if (currentTripId) {
    await updateTripOdometer(location);
  }
}

async function updateTripOdometer(location: Location.LocationObject) {
  if (!currentTripId) return;

  const lat = location.coords.latitude;
  const lon = location.coords.longitude;

  if (lastTrackedPoint) {
    const segmentKm = haversineKm(lastTrackedPoint.lat, lastTrackedPoint.lon, lat, lon);
    if (segmentKm >= MIN_SEGMENT_KM) {
      accumulatedKm += segmentKm;
    }
  }
  lastTrackedPoint = { lat, lon };
}

class LocationService {
  private isTracking = false;

  async requestPermissions(): Promise<boolean> {
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (!foreground.granted) return false;

    const background = await Location.requestBackgroundPermissionsAsync();
    return background.granted;
  }

  async startTracking(userRole: string) {
    if (this.isTracking) return;
    this.isTracking = true;

    const hasPermission = await this.requestPermissions();
    if (!hasPermission) {
      console.error('Location permissions not granted');
      return;
    }

    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
      accuracy: Location.Accuracy.High,
      timeInterval: LOCATION_UPDATE_INTERVAL,
      distanceInterval: LOCATION_UPDATE_DISTANCE,
      foregroundService: {
        notificationTitle: 'Navigation Active',
        notificationBody: 'Tracking location for your trip...',
        notificationColor: '#007AFF',
      },
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
    });

    const user = firebaseService.auth.currentUser;
    if (user) {
      await firebaseService.setRealtime(`live-locations/${user.uid}/role`, userRole);
    }
  }

  async stopTracking() {
    this.isTracking = false;

    const user = firebaseService.auth.currentUser;
    if (user) {
      await firebaseService.updateRealtime(`live-locations/${user.uid}`, {
        isActive: false,
        timestamp: Date.now(),
      });

      setTimeout(async () => {
        try {
          await firebaseService.setRealtime(`live-locations/${user.uid}`, null);
        } catch {
          // Ignore if already removed
        }
      }, 5 * 60 * 1000);
    }

    const hasTask = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
    if (hasTask) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    }
  }

  async getCurrentPosition(): Promise<Location.LocationObject | null> {
    try {
      return await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
    } catch {
      return null;
    }
  }

  async watchPosition(callback: (location: Location.LocationObject) => void): Promise<() => void> {
    const subscriber = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 3000,
        distanceInterval: 5,
      },
      callback
    );
    return () => subscriber.remove();
  }

  getDistanceBetweenPoints(lat1: number, lon1: number, lat2: number, lon2: number): number {
    return haversineKm(lat1, lon1, lat2, lon2);
  }
}

export const locationService = new LocationService();
