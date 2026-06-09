import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Switch,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { collection, onSnapshot, query, where, orderBy, Timestamp, updateDoc, doc } from 'firebase/firestore';
import firebaseService from '../../src/services/firebase';
import { useAuth } from '../../src/context/AuthContext';
import { locationService } from '../../src/services/location';
import StatusBadge from '../../src/components/StatusBadge';

export default function DriverHome() {
  const { appUser, logout } = useAuth();
  const router = useRouter();
  const [isTracking, setIsTracking] = useState(false);
  const [activeTrip, setActiveTrip] = useState<any>(null);
  const [pendingDeliveries, setPendingDeliveries] = useState<any[]>([]);
  const [todayTrips, setTodayTrips] = useState<any[]>([]);

  useEffect(() => {
    if (!appUser?.uid) return;

    // Listen to active trip
    const tripsUnsub = onSnapshot(
      query(
        collection(firebaseService.firestore, 'trips'),
        where('userId', '==', appUser.uid),
        where('status', '==', 'in_progress'),
        orderBy('createdAt', 'desc')
      ),
      (snapshot) => {
        if (!snapshot.empty) {
          setActiveTrip({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() });
        } else {
          setActiveTrip(null);
        }
      }
    );

    // Listen to pending deliveries
    const deliveriesUnsub = onSnapshot(
      query(
        collection(firebaseService.firestore, 'deliveries'),
        where('assignedDrivers', 'array-contains', appUser.uid),
        where('status', 'in', ['pending', 'accepted', 'in_transit'])
      ),
      (snapshot) => {
        const items: any[] = [];
        snapshot.forEach((doc) => {
          items.push({ id: doc.id, ...doc.data() });
        });
        setPendingDeliveries(items);
      }
    );

    // Listen to today's trips
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];
    const todayUnsub = onSnapshot(
      query(
        collection(firebaseService.firestore, 'trips'),
        where('userId', '==', appUser.uid),
        where('date', '==', todayStr)
      ),
      (snapshot) => {
        const items: any[] = [];
        snapshot.forEach((doc) => {
          items.push({ id: doc.id, ...doc.data() });
        });
        setTodayTrips(items);
      }
    );

    return () => {
      tripsUnsub();
      deliveriesUnsub();
      todayUnsub();
    };
  }, [appUser?.uid]);

  const handleTrackingToggle = async () => {
    try {
      if (isTracking) {
        await locationService.stopTracking();
        setIsTracking(false);
      } else {
        await locationService.startTracking('driver');
        setIsTracking(true);
      }
    } catch (error) {
      console.error('Tracking error:', error);
      Alert.alert('Error', 'Failed to toggle location tracking');
    }
  };

  const handleAcceptDelivery = async (deliveryId: string) => {
    try {
      await updateDoc(doc(firebaseService.firestore, 'deliveries', deliveryId), {
        status: 'accepted',
        acceptedBy: appUser?.uid,
        updatedAt: Timestamp.now(),
      });
      Alert.alert('Success', 'Delivery accepted');
    } catch (error) {
      console.error('Error accepting delivery:', error);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hello,</Text>
          <Text style={styles.userName}>{appUser?.displayName || 'Driver'}</Text>
        </View>
      </View>

      {/* Location Tracking Toggle */}
      <View style={styles.trackingCard}>
        <View style={styles.trackingInfo}>
          <Text style={styles.trackingTitle}>Location Tracking</Text>
          <Text style={styles.trackingDesc}>
            {isTracking ? 'Active - sharing location' : 'Inactive'}
          </Text>
        </View>
        <Switch
          value={isTracking}
          onValueChange={handleTrackingToggle}
          trackColor={{ false: '#E0E0E0', true: '#34C759' }}
        />
      </View>

      {/* Active Trip */}
      {activeTrip && (
        <TouchableOpacity
          style={styles.activeTripCard}
          onPress={() => router.push('/(driver)/trips' as any)}
        >
          <Text style={styles.sectionTitle}>Active Trip</Text>
          <View style={styles.tripProgress}>
            <View style={styles.progressBarBg}>
              <View
                style={[
                  styles.progressBarFill,
                  { width: `${activeTrip.completionPercentage || 0}%` },
                ]}
              />
            </View>
            <Text style={styles.progressText}>
              {activeTrip.completionPercentage || 0}%
            </Text>
          </View>
          <View style={styles.tripStats}>
            <View style={styles.tripStat}>
              <Text style={styles.tripStatValue}>
                {activeTrip.completedStops}/{activeTrip.stops?.length || 0}
              </Text>
              <Text style={styles.tripStatLabel}>Stops</Text>
            </View>
            <View style={styles.tripStat}>
              <Text style={styles.tripStatValue}>
                {Math.round(activeTrip.distanceCovered || 0)} km
              </Text>
              <Text style={styles.tripStatLabel}>Covered</Text>
            </View>
            <View style={styles.tripStat}>
              <Text style={styles.tripStatValue}>
                {Math.round(activeTrip.distanceRemaining || 0)} km
              </Text>
              <Text style={styles.tripStatLabel}>Remaining</Text>
            </View>
          </View>
        </TouchableOpacity>
      )}

      {/* Pending Deliveries */}
      {pendingDeliveries.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Pending Deliveries ({pendingDeliveries.length})
          </Text>
          {pendingDeliveries.map((delivery: any) => (
            <View key={delivery.id} style={styles.deliveryItem}>
              <View style={styles.deliveryInfo}>
                <Text style={styles.deliveryName}>{delivery.deliveryNumber}</Text>
                <Text style={styles.deliveryCustomer}>{delivery.customer}</Text>
                <StatusBadge status={delivery.status} size="small" />
              </View>
              {delivery.status === 'pending' && !delivery.acceptedBy && (
                <TouchableOpacity
                  style={styles.acceptBtn}
                  onPress={() => handleAcceptDelivery(delivery.id)}
                >
                  <Text style={styles.acceptBtnText}>Accept</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Quick Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.quickActions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => router.push('/(driver)/trips' as any)}
          >
            <Text style={styles.actionIcon}>🗺️</Text>
            <Text style={styles.actionText}>View Trips</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#007AFF',
  },
  greeting: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
  },
  userName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFF',
  },
  trackingCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFF',
    margin: 12,
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  trackingInfo: {
    flex: 1,
  },
  trackingTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  trackingDesc: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  activeTripCard: {
    backgroundColor: '#007AFF',
    margin: 12,
    padding: 16,
    borderRadius: 12,
  },
  tripProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  progressBarBg: {
    flex: 1,
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 4,
    overflow: 'hidden',
    marginRight: 12,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#FFF',
    borderRadius: 4,
  },
  progressText: {
    color: '#FFF',
    fontWeight: '600',
    fontSize: 14,
  },
  tripStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tripStat: {
    alignItems: 'center',
  },
  tripStatValue: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
  },
  tripStatLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11,
    marginTop: 2,
  },
  section: {
    padding: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  deliveryItem: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  deliveryInfo: {
    flex: 1,
  },
  deliveryName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  deliveryCustomer: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
    marginBottom: 4,
  },
  acceptBtn: {
    backgroundColor: '#34C759',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
  },
  acceptBtnText: {
    color: '#FFF',
    fontWeight: '600',
  },
  quickActions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionBtn: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    flex: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  actionIcon: {
    fontSize: 24,
    marginBottom: 8,
  },
  actionText: {
    fontSize: 12,
    color: '#666',
  },
});