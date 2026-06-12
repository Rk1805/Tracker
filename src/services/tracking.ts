import {
  collection,
  onSnapshot,
  query,
  where,
  addDoc,
  updateDoc,
  doc,
  Timestamp,
  getDocs,
} from 'firebase/firestore';
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
        await addDoc(collection(firebaseService.firestore, 'delivery-tracking'), {
          tripId,
          partyId: stop.partyId,
          driverId,
          trackingId: this.generateTrackingId(),
          trackingEnabled: true,
          status: 'waiting',
          etaMinutes: 0,
          currentDriverLatitude: stop.latitude,
          currentDriverLongitude: stop.longitude,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
      }
    }
  }

  async getTrackingByParty(partyId: string): Promise<any | null> {
    const q = query(
      collection(firebaseService.firestore, 'delivery-tracking'),
      where('partyId', '==', partyId),
      where('trackingEnabled', '==', true)
    );
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      return { id: doc.id, ...doc.data() };
    }
    return null;
  }

  async getTrackingById(trackingId: string): Promise<any | null> {
    const q = query(
      collection(firebaseService.firestore, 'delivery-tracking'),
      where('trackingId', '==', trackingId),
      where('trackingEnabled', '==', true)
    );
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      return { id: doc.id, ...doc.data() };
    }
    return null;
  }

  subscribeToTracking(trackingId: string, callback: (data: any) => void) {
    const q = query(
      collection(firebaseService.firestore, 'delivery-tracking'),
      where('trackingId', '==', trackingId)
    );
    return onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        callback({ id: doc.id, ...doc.data() });
      } else {
        callback(null);
      }
    });
  }

  async updateTrackingOnTripStart(trackingId: string, driverLat: number, driverLon: number): Promise<void> {
    const q = query(
      collection(firebaseService.firestore, 'delivery-tracking'),
      where('trackingId', '==', trackingId)
    );
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      const docRef = snapshot.docs[0].ref;
      await updateDoc(docRef, {
        status: 'out_for_delivery',
        currentDriverLatitude: driverLat,
        currentDriverLongitude: driverLon,
        updatedAt: Timestamp.now(),
      });
    }
  }

  async updateTrackingOnStopDelivered(partyId: string): Promise<void> {
    const tracking = await this.getTrackingByParty(partyId);
    if (tracking?.id) {
      await updateDoc(doc(firebaseService.firestore, 'delivery-tracking', tracking.id), {
        status: 'delivered',
        trackingEnabled: false,
        updatedAt: Timestamp.now(),
      });
    }
  }

  async updateDriverLocation(tripId: string, driverLat: number, driverLon: number): Promise<void> {
    const q = query(
      collection(firebaseService.firestore, 'delivery-tracking'),
      where('tripId', '==', tripId),
      where('trackingEnabled', '==', true)
    );
    const snapshot = await getDocs(q);
    const batch: Promise<void>[] = [];
    snapshot.forEach((d) => {
      batch.push(
        updateDoc(d.ref, {
          currentDriverLatitude: driverLat,
          currentDriverLongitude: driverLon,
          updatedAt: Timestamp.now(),
        })
      );
    });
    await Promise.all(batch);
  }
}

export const trackingService = new TrackingService();