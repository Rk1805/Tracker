import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import firebaseService from './firebase';
import { LocationRecord, UserLocation } from '../types';

const LOCATION_TASK_NAME = 'BACKGROUND_LOCATION_TASK';
const LOCATION_UPDATE_INTERVAL = 5000; // 5 seconds while moving
const LOCATION_UPDATE_DISTANCE = 10; // 10 meters

// Define the background task
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
    role: 'driver', // Will be updated from context on auth
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    timestamp: Date.now(),
    speed: location.coords.speed || 0,
    heading: location.coords.heading || 0,
    isActive: true,
  };

  // Update current location in Realtime DB
  await firebaseService.setRealtime(`live-locations/${user.uid}`, locationData);

  // Store location history in Firestore (sampled every 30 seconds to avoid excessive writes)
  const shouldStoreHistory = Math.floor(Date.now() / 30000) !== Math.floor((Date.now() - 5000) / 30000);
  if (shouldStoreHistory) {
    const historyRecord: LocationRecord = {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      timestamp: Date.now(),
      speed: location.coords.speed || 0,
      heading: location.coords.heading || 0,
    };
    await firebaseService.addDocument(`location-history/${user.uid}/locations`, historyRecord);
  }
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

    // Start foreground location updates
    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
      accuracy: Location.Accuracy.High,
      timeInterval: LOCATION_UPDATE_INTERVAL,
      distanceInterval: LOCATION_UPDATE_DISTANCE,
      foregroundService: {
        notificationTitle: 'Tracker',
        notificationBody: 'Location tracking is active',
        notificationColor: '#007AFF',
      },
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
    });

    // Set user as online with role
    const user = firebaseService.auth.currentUser;
    if (user) {
      await firebaseService.setRealtime(`live-locations/${user.uid}/role`, userRole);
    }
  }

  async stopTracking() {
    this.isTracking = false;

    const user = firebaseService.auth.currentUser;
    if (user) {
      // Mark as inactive but keep last location
      await firebaseService.updateRealtime(`live-locations/${user.uid}`, {
        isActive: false,
        timestamp: Date.now(),
      });

      // Remove after 5 minutes
      setTimeout(async () => {
        try {
          await firebaseService.setRealtime(`live-locations/${user.uid}`, null);
        } catch (e) {
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

  async watchPosition(
    callback: (location: Location.LocationObject) => void
  ): Promise<() => void> {
    const subscriber = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 5000,
        distanceInterval: 10,
      },
      callback
    );
    return () => subscriber.remove();
  }

  getDistanceBetweenPoints(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }
}

export const locationService = new LocationService();
export { LOCATION_TASK_NAME };