import { ref, set, get, onValue, off, update, remove, DataSnapshot } from 'firebase/database';
import firebaseService from './firebase';

export class TrackingService {
  private generateTrackingId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = 'TRK-';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  async createTrackingRecords(tripId: string, stops: { partyId: string; partyName: string; latitude: number; longitude: number }[], driverId: string): Promise<void> {
    for (const stop of stops) {
      const existingTracking = await this.getTrackingByParty(stop.partyId);
      if (!existingTracking) {
        const trackingId = this.generateTrackingId();
        const trackingData = {
          tripId,
          partyId: stop.partyId,
          driverId,
          trackingId,
          trackingEnabled: true,
          status: 'waiting',
          etaMinutes: 0,
          currentDriverLatitude: stop.latitude,
          currentDriverLongitude: stop.longitude,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await set(ref(firebaseService.database, `delivery-tracking/${trackingId}`), trackingData);
      }
    }
  }

  async getTrackingByParty(partyId: string): Promise<any | null> {
    const snapshot = await get(ref(firebaseService.database, 'delivery-tracking'));
    if (!snapshot.exists()) return null;
    
    const data = snapshot.val();
    for (const key of Object.keys(data)) {
      const tracking = data[key];
      if (tracking.partyId === partyId && tracking.trackingEnabled) {
        return { id: key, ...tracking };
      }
    }
    return null;
  }

  async getTrackingById(trackingId: string): Promise<any | null> {
    const snapshot = await get(ref(firebaseService.database, `delivery-tracking/${trackingId}`));
    if (!snapshot.exists()) return null;
    return { id: trackingId, ...snapshot.val() };
  }

  subscribeToTracking(trackingId: string, callback: (data: any) => void) {
    const dbRef = ref(firebaseService.database, `delivery-tracking/${trackingId}`);
    const unsubscribe = onValue(dbRef, (snapshot: DataSnapshot) => {
      if (snapshot.exists()) {
        callback({ id: trackingId, ...snapshot.val() });
      } else {
        callback(null);
      }
    });
    return () => off(dbRef);
  }

  subscribeToTrackingByParty(partyId: string, callback: (data: any) => void) {
    const dbRef = ref(firebaseService.database, 'delivery-tracking');
    onValue(dbRef, (snapshot: DataSnapshot) => {
      if (!snapshot.exists()) {
        callback(null);
        return;
      }
      const data = snapshot.val();
      for (const key of Object.keys(data)) {
        const tracking = data[key];
        if (tracking.partyId === partyId && tracking.trackingEnabled) {
          callback({ id: key, ...tracking });
          return;
        }
      }
      callback(null);
    });
    return () => off(dbRef);
  }

  async updateTrackingOnTripStart(trackingId: string, driverLat: number, driverLon: number): Promise<void> {
    const dbRef = ref(firebaseService.database, `delivery-tracking/${trackingId}`);
    await update(dbRef, {
      status: 'out_for_delivery',
      currentDriverLatitude: driverLat,
      currentDriverLongitude: driverLon,
      updatedAt: Date.now(),
    });
  }

  async updateTrackingOnStopDelivered(partyId: string): Promise<void> {
    const tracking = await this.getTrackingByParty(partyId);
    if (tracking?.id) {
      await remove(ref(firebaseService.database, `delivery-tracking/${tracking.id}`));
    }
  }

  async updateDriverLocation(tripId: string, driverLat: number, driverLon: number): Promise<void> {
    const snapshot = await get(ref(firebaseService.database, 'delivery-tracking'));
    if (!snapshot.exists()) return;
    
    const data = snapshot.val();
    for (const key of Object.keys(data)) {
      const tracking = data[key];
      if (tracking.tripId === tripId && tracking.trackingEnabled) {
        await update(ref(firebaseService.database, `delivery-tracking/${key}`), {
          currentDriverLatitude: driverLat,
          currentDriverLongitude: driverLon,
          updatedAt: Date.now(),
        });
        return;
      }
    }
  }
}

export const trackingService = new TrackingService();
