import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import { collection, onSnapshot, query, where, doc, getDoc } from 'firebase/firestore';
import firebaseService from '../../src/services/firebase';
import { Party, DeliveryTracking } from '../../src/types';
import StatusBadge from '../../src/components/StatusBadge';

export default function CustomerHomeScreen() {
  const { appUser, logout } = useAuth();
  const router = useRouter();
  const [myParties, setMyParties] = useState<Party[]>([]);
  const [activeTracking, setActiveTracking] = useState<DeliveryTracking | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

  // Fetch parties linked to this customer
  useEffect(() => {
    if (!appUser?.uid) return;

    const partiesUnsub = onSnapshot(
      query(
        collection(firebaseService.firestore, 'parties'),
        where('customerUserId', '==', appUser.uid)
      ),
      (snapshot) => {
        const parties: Party[] = [];
        snapshot.forEach((doc) => {
          const docData = doc.data() as Party;
          parties.push({ ...docData, id: doc.id });
        });
        setMyParties(parties);
      }
    );

    return () => partiesUnsub();
  }, [appUser?.uid]);

  // Fetch active delivery tracking for this customer's parties
  useEffect(() => {
    if (!myParties.length) {
      setActiveTracking(null);
      setLoading(false);
      return;
    }

    // Find active tracking for any of the customer's parties
    const partyIds = myParties.map(p => p.id);

    const trackingUnsub = onSnapshot(
      query(
        collection(firebaseService.firestore, 'delivery-tracking'),
        where('partyId', 'in', partyIds),
        where('trackingEnabled', '==', true)
      ),
      (snapshot) => {
        if (!snapshot.empty) {
          const doc = snapshot.docs[0];
          setActiveTracking({ id: doc.id, ...doc.data() } as DeliveryTracking);
        } else {
          setActiveTracking(null);
        }
        setLoading(false);
      }
    );

    return () => trackingUnsub();
  }, [myParties]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // Refresh is handled by onSnapshot listeners
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
      router.replace('/auth/customer-login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const handleManualTrack = () => {
    router.push('/(customer)/track');
  };

  const getStatusDisplay = (status: string): { text: string; color: string } => {
    switch (status) {
      case 'waiting':
        return { text: 'Waiting For Dispatch', color: '#FF9500' };
      case 'out_for_delivery':
        return { text: 'Out For Delivery', color: '#007AFF' };
      case 'delivered':
        return { text: 'Delivered', color: '#34C759' };
      default:
        return { text: 'Unknown', color: '#666' };
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hello,</Text>
          <Text style={styles.userName}>{appUser?.displayName || 'Customer'}</Text>
        </View>
        <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Active Delivery Card */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
          </View>
        ) : activeTracking ? (
          <View style={styles.deliveryCard}>
            <Text style={styles.cardTitle}>Active Delivery</Text>
            <View style={styles.statusContainer}>
              <Text style={styles.statusLabel}>Status</Text>
              <StatusBadge status={activeTracking.status} size="large" />
            </View>
            {activeTracking.etaMinutes && (
              <View style={styles.etaContainer}>
                <Text style={styles.etaLabel}>Estimated Arrival</Text>
                <Text style={styles.etaValue}>{activeTracking.etaMinutes} mins</Text>
              </View>
            )}
            <TouchableOpacity
              style={styles.trackBtn}
              onPress={() => router.push(`/(customer)/track` as any)}
            >
              <Text style={styles.trackBtnText}>View Live Tracking</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.noDeliveryCard}>
            <Text style={styles.noDeliveryIcon}>📦</Text>
            <Text style={styles.noDeliveryText}>No Active Deliveries</Text>
            <Text style={styles.noDeliverySubtext}>
              {myParties.length > 0
                ? 'Your delivery will appear here when dispatched'
                : 'You have no linked delivery addresses'}
            </Text>
            <TouchableOpacity
              style={styles.manualTrackBtn}
              onPress={handleManualTrack}
            >
              <Text style={styles.manualTrackBtnText}>Track with ID</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* My Addresses Section */}
        {myParties.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>My Addresses</Text>
            {myParties.map((party) => (
              <View key={party.id} style={styles.partyCard}>
                <Text style={styles.partyName}>{party.name}</Text>
                <Text style={styles.partyAddress}>{party.address}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Track Another Button */}
        <TouchableOpacity
          style={styles.trackAnotherBtn}
          onPress={handleManualTrack}
        >
          <Text style={styles.trackAnotherText}>Track Another Delivery</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
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
  logoutBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
  },
  logoutText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  deliveryCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 16,
  },
  statusContainer: {
    marginBottom: 16,
  },
  statusLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  etaContainer: {
    marginBottom: 16,
  },
  etaLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  etaValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#007AFF',
  },
  trackBtn: {
    backgroundColor: '#007AFF',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  trackBtnText: {
    color: '#FFF',
    fontWeight: '600',
    fontSize: 16,
  },
  noDeliveryCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 30,
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  noDeliveryIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  noDeliveryText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  noDeliverySubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
  },
  manualTrackBtn: {
    backgroundColor: '#34C759',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  manualTrackBtnText: {
    color: '#FFF',
    fontWeight: '600',
    fontSize: 16,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  partyCard: {
    backgroundColor: '#FFF',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  partyName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  partyAddress: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  trackAnotherBtn: {
    backgroundColor: '#FFF',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  trackAnotherText: {
    color: '#007AFF',
    fontWeight: '600',
    fontSize: 16,
  },
});