import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { ref, onValue } from 'firebase/database';
import firebaseService from '../../src/services/firebase';
import { useAuth } from '../../src/context/AuthContext';
import StatusBadge from '../../src/components/StatusBadge';

interface DashboardStats {
  totalParties: number;
  upcomingTrips: number;
  activeUsers: number;
  pendingLeads: number;
}

export default function AdminDashboard() {
  const { appUser } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats>({
    totalParties: 0,
    upcomingTrips: 0,
    activeUsers: 0,
    pendingLeads: 0,
  });
  const [recentTrips, setRecentTrips] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    // Listen to active users count from Realtime DB
    const activeUsersUnsub = onValue(
      ref(firebaseService.database, 'live-locations'),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.val();
          const active = Object.values(data).filter((u: any) => u.isActive).length;
          setStats((s) => ({ ...s, activeUsers: active }));
        }
      }
    );

    // Listen to parties count
    const partiesUnsub = onSnapshot(
      collection(firebaseService.firestore, 'parties'),
      (snapshot) => {
        setStats((s) => ({ ...s, totalParties: snapshot.size }));
      }
    );

    // Listen to trips
    const tripsUnsub = onSnapshot(
      query(
        collection(firebaseService.firestore, 'trips'),
        where('status', 'in', ['planned', 'in_progress'])
      ),
      (snapshot) => {
        setStats((s) => ({ ...s, upcomingTrips: snapshot.size }));
        const items: any[] = [];
        snapshot.forEach((doc) => {
          items.push({ id: doc.id, ...doc.data() });
        });
        setRecentTrips(items.slice(0, 5));
      }
    );

    // Listen to leads
    const leadsUnsub = onSnapshot(
      query(
        collection(firebaseService.firestore, 'leads'),
        where('status', '==', 'pending')
      ),
      (snapshot) => {
        setStats((s) => ({ ...s, pendingLeads: snapshot.size }));
      }
    );

    return () => {
      activeUsersUnsub();
      partiesUnsub();
      tripsUnsub();
      leadsUnsub();
    };
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  };

  const StatCard = ({ title, value, color, onPress }: any) => (
    <TouchableOpacity style={[styles.statCard, { borderLeftColor: color }]} onPress={onPress}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statTitle}>{title}</Text>
    </TouchableOpacity>
  );

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Welcome,</Text>
          <Text style={styles.userName}>{appUser?.displayName || 'Admin'}</Text>
        </View>
      </View>

      <View style={styles.statsGrid}>
        <StatCard
          title="Parties"
          value={stats.totalParties}
          color="#007AFF"
          onPress={() => router.push('/(admin)/parties' as any)}
        />
        <StatCard
          title="Pending Trips"
          value={stats.upcomingTrips}
          color="#FF9500"
          onPress={() => router.push('/(admin)/trips' as any)}
        />
        <StatCard
          title="Active Users"
          value={stats.activeUsers}
          color="#5856D6"
        />
        <StatCard
          title="Pending Leads"
          value={stats.pendingLeads}
          color="#FF2D55"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>
<View style={styles.quickActions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => router.push('/(admin)/parties' as any)}
          >
            <Text style={styles.actionIcon}>➕</Text>
            <Text style={styles.actionText}>Add Party</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => router.push('/(admin)/trips' as any)}
          >
            <Text style={styles.actionIcon}>🚗</Text>
            <Text style={styles.actionText}>New Trip</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => router.push('/(admin)/map' as any)}
          >
            <Text style={styles.actionIcon}>🗺️</Text>
            <Text style={styles.actionText}>Live Map</Text>
          </TouchableOpacity>
        </View>
      </View>

      {recentTrips.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Upcoming Trips</Text>
          {recentTrips.map((trip: any) => (
            <View key={trip.id} style={styles.deliveryItem}>
              <View style={styles.deliveryInfo}>
                <Text style={styles.deliveryName}>Trip #{trip.id.slice(-6)}</Text>
                <Text style={styles.deliveryCustomer}>{trip.stops?.[0]?.partyName || trip.date}</Text>
              </View>
              <StatusBadge status={trip.status} />
            </View>
          ))}
        </View>
      )}
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
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 12,
    gap: 12,
  },
  statCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    width: '47%',
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '700',
    color: '#333',
  },
  statTitle: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
  },
  section: {
    padding: 16,
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
    textAlign: 'center',
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
  },
});