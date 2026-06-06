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
import { collection, onSnapshot, query, where, orderBy, Timestamp } from 'firebase/firestore';
import firebaseService from '../../src/services/firebase';
import { useAuth } from '../../src/context/AuthContext';
import { locationService } from '../../src/services/location';
import StatusBadge from '../../src/components/StatusBadge';

export default function SalesmanHome() {
  const { appUser, logout } = useAuth();
  const router = useRouter();
  const [isTracking, setIsTracking] = useState(false);
  const [activeTrip, setActiveTrip] = useState<any>(null);
  const [todayStats, setTodayStats] = useState({
    visits: 0,
    leads: 0,
    pendingLeads: 0,
  });

  useEffect(() => {
    if (!appUser?.uid) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = Timestamp.fromDate(today);

    // Load active trip
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

    // Load today's visits
    const visitsUnsub = onSnapshot(
      query(
        collection(firebaseService.firestore, 'trips'),
        where('userId', '==', appUser.uid),
        where('date', '==', today.toISOString().split('T')[0])
      ),
      (snapshot) => {
        let visits = 0;
        snapshot.forEach((doc) => {
          const data = doc.data();
          visits += data.completedStops || 0;
        });
        setTodayStats((s) => ({ ...s, visits }));
      }
    );

    // Load leads
    const leadsUnsub = onSnapshot(
      query(
        collection(firebaseService.firestore, 'leads'),
        where('createdBy', '==', appUser.uid)
      ),
      (snapshot) => {
        let total = 0;
        let pending = 0;
        snapshot.forEach((doc) => {
          total++;
          if (doc.data().status === 'pending') pending++;
        });
        setTodayStats((s) => ({ ...s, leads: total, pendingLeads: pending }));
      }
    );

    return () => {
      tripsUnsub();
      visitsUnsub();
      leadsUnsub();
    };
  }, [appUser?.uid]);

  const handleTrackingToggle = async () => {
    try {
      if (isTracking) {
        await locationService.stopTracking();
        setIsTracking(false);
      } else {
        await locationService.startTracking('salesman');
        setIsTracking(true);
      }
    } catch (error) {
      console.error('Tracking error:', error);
      Alert.alert('Error', 'Failed to toggle location tracking');
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hello,</Text>
          <Text style={styles.userName}>{appUser?.displayName || 'Salesman'}</Text>
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

      {/* Today's Stats */}
      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{todayStats.visits}</Text>
          <Text style={styles.statLabel}>Today's Visits</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{todayStats.leads}</Text>
          <Text style={styles.statLabel}>Total Leads</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{todayStats.pendingLeads}</Text>
          <Text style={styles.statLabel}>Pending Approval</Text>
        </View>
      </View>

      {/* Active Trip */}
      {activeTrip && (
        <TouchableOpacity
          style={styles.activeTripCard}
          onPress={() => router.push('/(salesman)/visits' as any)}
        >
          <Text style={styles.activeTripTitle}>Active Trip</Text>
          <View style={styles.progressBarBg}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${activeTrip.completionPercentage || 0}%` },
              ]}
            />
          </View>
          <Text style={styles.progressText}>
            {activeTrip.completionPercentage || 0}% Complete
          </Text>
          <Text style={styles.stopsText}>
            {activeTrip.completedStops || 0}/{activeTrip.stops?.length || 0} parties visited
          </Text>
        </TouchableOpacity>
      )}

      {/* Quick Actions */}
      <View style={styles.quickActionsSection}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.quickActions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => router.push('/(salesman)/visits' as any)}
          >
            <Text style={styles.actionIcon}>📍</Text>
            <Text style={styles.actionText}>Plan Visit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => router.push('/(salesman)/leads' as any)}
          >
            <Text style={styles.actionIcon}>📋</Text>
            <Text style={styles.actionText}>New Lead</Text>
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
  statsGrid: {
    flexDirection: 'row',
    padding: 12,
    gap: 12,
  },
  statCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    flex: 1,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#007AFF',
  },
  statLabel: {
    fontSize: 11,
    color: '#666',
    marginTop: 4,
    textAlign: 'center',
  },
  activeTripCard: {
    backgroundColor: '#34C759',
    margin: 12,
    padding: 16,
    borderRadius: 12,
  },
  activeTripTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
    marginBottom: 12,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
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
    marginBottom: 4,
  },
  stopsText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
  },
  quickActionsSection: {
    padding: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
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