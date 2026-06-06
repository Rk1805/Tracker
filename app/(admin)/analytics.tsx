import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  Timestamp,
} from 'firebase/firestore';
import firebaseService from '../../src/services/firebase';
import { Delivery, Trip } from '../../src/types';

export default function AnalyticsScreen() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedTab, setSelectedTab] = useState<'drivers' | 'salesmen'>('drivers');

  useEffect(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = Timestamp.fromDate(today);

    // Load today's deliveries
    const deliveriesUnsub = onSnapshot(
      query(
        collection(firebaseService.firestore, 'deliveries'),
        where('createdAt', '>=', todayTimestamp)
      ),
      (snapshot) => {
        const items: Delivery[] = [];
        snapshot.forEach((doc) => {
          items.push({ id: doc.id, ...doc.data() } as Delivery);
        });
        setDeliveries(items);
      }
    );

    // Load today's trips
    const tripsUnsub = onSnapshot(
      query(
        collection(firebaseService.firestore, 'trips'),
        where('createdAt', '>=', todayTimestamp)
      ),
      (snapshot) => {
        const items: Trip[] = [];
        snapshot.forEach((doc) => {
          items.push({ id: doc.id, ...doc.data() } as Trip);
        });
        setTrips(items);
      }
    );

    return () => {
      deliveriesUnsub();
      tripsUnsub();
    };
  }, []);

  // Driver Analytics
  const driverStats = {
    deliveriesCompleted: deliveries.filter((d) => d.status === 'delivered').length,
    totalDeliveries: deliveries.length,
    totalTrips: trips.length,
    completedTrips: trips.filter((t) => t.status === 'completed').length,
    activeTrips: trips.filter((t) => t.status === 'in_progress').length,
    totalDistance: trips.reduce((sum, t) => sum + (t.totalDistance || 0), 0),
    avgDeliveryTime: deliveries
      .filter((d) => d.createdAt && d.deliveredAt)
      .reduce((sum, d) => {
        const diff = d.deliveredAt!.toMillis() - d.createdAt!.toMillis();
        return sum + diff / (1000 * 60);
      }, 0),
  };

  // Salesman Analytics
  const salesmanStats = {
    partiesVisited: trips.reduce(
      (sum, t) => sum + t.completedStops,
      0
    ),
    totalStops: trips.reduce((sum, t) => sum + t.stops.length, 0),
    totalTrips: trips.length,
    totalDistance: trips.reduce((sum, t) => sum + (t.totalDistance || 0), 0),
    avgTimePerParty: trips
      .filter((t) => t.stops.length > 0 && t.completedStops > 0)
      .reduce((sum, t) => {
        const spent = t.stops.reduce(
          (s, stop) => s + (stop.durationSpent || 0),
          0
        );
        return sum + spent / t.completedStops;
      }, 0),
  };

  const MetricCard = ({ title, value, subtitle }: { title: string; value: string | number; subtitle?: string }) => (
    <View style={styles.metricCard}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricTitle}>{title}</Text>
      {subtitle && <Text style={styles.metricSubtitle}>{subtitle}</Text>}
    </View>
  );

  return (
    <ScrollView style={styles.container}>
      {/* Tab Selector */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, selectedTab === 'drivers' && styles.tabActive]}
          onPress={() => setSelectedTab('drivers')}
        >
          <Text style={[styles.tabText, selectedTab === 'drivers' && styles.tabTextActive]}>
            Drivers
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, selectedTab === 'salesmen' && styles.tabActive]}
          onPress={() => setSelectedTab('salesmen')}
        >
          <Text style={[styles.tabText, selectedTab === 'salesmen' && styles.tabTextActive]}>
            Salesmen
          </Text>
        </TouchableOpacity>
      </View>

      {selectedTab === 'drivers' ? (
        <View style={styles.content}>
          <Text style={styles.sectionTitle}>Today's Overview</Text>
          <View style={styles.metricsGrid}>
            <MetricCard
              title="Deliveries Completed"
              value={`${driverStats.deliveriesCompleted}/${driverStats.totalDeliveries}`}
              subtitle="Today"
            />
            <MetricCard
              title="Active Trips"
              value={driverStats.activeTrips}
            />
            <MetricCard
              title="Distance Travelled"
              value={`${Math.round(driverStats.totalDistance)} km`}
            />
            <MetricCard
              title="Avg Delivery Time"
              value={`${Math.round(driverStats.avgDeliveryTime)} min`}
            />
            <MetricCard
              title="Completed Trips"
              value={`${driverStats.completedTrips}/${driverStats.totalTrips}`}
            />
            <MetricCard
              title="Success Rate"
              value={
                driverStats.totalDeliveries > 0
                  ? `${Math.round(
                      (driverStats.deliveriesCompleted / driverStats.totalDeliveries) * 100
                    )}%`
                  : '0%'
              }
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Delivery Status Breakdown</Text>
            {['pending', 'accepted', 'in_transit', 'delivered', 'failed'].map((status) => {
              const count = deliveries.filter((d) => d.status === status).length;
              const total = deliveries.length;
              const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <View key={status} style={styles.statusRow}>
                  <Text style={styles.statusLabel}>
                    {status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </Text>
                  <View style={styles.progressBarBg}>
                    <View style={[styles.progressBarFill, { width: `${percentage}%` }]} />
                  </View>
                  <Text style={styles.statusCount}>{count}</Text>
                </View>
              );
            })}
          </View>
        </View>
      ) : (
        <View style={styles.content}>
          <Text style={styles.sectionTitle}>Today's Overview</Text>
          <View style={styles.metricsGrid}>
            <MetricCard
              title="Parties Visited"
              value={salesmanStats.partiesVisited}
              subtitle={`of ${salesmanStats.totalStops} total`}
            />
            <MetricCard
              title="Trips Completed"
              value={salesmanStats.totalTrips}
            />
            <MetricCard
              title="Distance Travelled"
              value={`${Math.round(salesmanStats.totalDistance)} km`}
            />
            <MetricCard
              title="Avg Time Per Party"
              value={`${Math.round(salesmanStats.avgTimePerParty)} min`}
            />
            <MetricCard
              title="Visit Rate"
              value={
                salesmanStats.totalStops > 0
                  ? `${Math.round(
                      (salesmanStats.partiesVisited / salesmanStats.totalStops) * 100
                    )}%`
                  : '0%'
              }
            />
            <MetricCard
              title="Productivity Score"
              value={
                salesmanStats.totalDistance > 0
                  ? Math.round(
                    (salesmanStats.partiesVisited / salesmanStats.totalDistance) * 100
                  )
                  : 'N/A'
              }
            />
          </View>
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
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    padding: 4,
    margin: 12,
    borderRadius: 12,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
  },
  tabActive: {
    backgroundColor: '#007AFF',
  },
  tabText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#666',
  },
  tabTextActive: {
    color: '#FFF',
  },
  content: {
    padding: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  metricCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    width: '47%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  metricValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#007AFF',
  },
  metricTitle: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
  },
  metricSubtitle: {
    fontSize: 11,
    color: '#999',
    marginTop: 2,
  },
  section: {
    marginBottom: 24,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusLabel: {
    fontSize: 13,
    color: '#666',
    width: 100,
  },
  progressBarBg: {
    flex: 1,
    height: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    marginHorizontal: 8,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#007AFF',
    borderRadius: 4,
  },
  statusCount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    width: 30,
    textAlign: 'right',
  },
});