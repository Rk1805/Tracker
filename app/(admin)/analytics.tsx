import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  Timestamp,
  QuerySnapshot,
} from 'firebase/firestore';
import { ref, onValue, set } from 'firebase/database';
import firebaseService from '../../src/services/firebase';
import { useAuth } from '../../src/context/AuthContext';
import { Delivery, Trip, DailyRideSummary } from '../../src/types';
import { getActualDistanceKm } from '../../src/utils/tripDistance';

export default function AnalyticsScreen() {
  const { appUser } = useAuth();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [dailySummaries, setDailySummaries] = useState<DailyRideSummary[]>([]);
  const [archivedSummaries, setArchivedSummaries] = useState<DailyRideSummary[]>([]);
  const [pricePerKm, setPricePerKm] = useState(0);
  const [selectedTab, setSelectedTab] = useState<'drivers' | 'salesmen' | 'payments' | 'settings'>('drivers');

  useEffect(() => {
    const priceRef = ref(firebaseService.database, 'settings/pricePerKm');
    const priceUnsub = onValue(priceRef, (snapshot) => {
      if (snapshot.exists()) {
        setPricePerKm(snapshot.val());
      }
    });

    return () => priceUnsub();
  }, []);

  useEffect(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = Timestamp.fromDate(today);

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

    const todayStr = today.toISOString().split('T')[0];
    const todayRef = ref(firebaseService.database, `daily-ride-summaries/${appUser?.uid}/dates/${todayStr}`);
    const todayUnsub = onValue(todayRef, (snapshot) => {
      if (snapshot.exists()) {
        setDailySummaries([{ id: `${appUser?.uid}_${todayStr}`, ...snapshot.val() }]);
      } else {
        setDailySummaries([]);
      }
    });

    const summariesUnsub = onSnapshot(
      query(collection(firebaseService.firestore, 'daily-ride-summaries')),
      (snapshot: QuerySnapshot) => {
        const items: DailyRideSummary[] = [];
        snapshot.forEach((doc) => {
          items.push({ id: doc.id, ...doc.data() } as DailyRideSummary);
        });
        setArchivedSummaries(items.sort((a, b) => ((b.createdAt || 0) - (a.createdAt || 0))));
      }
    );

    return () => {
      deliveriesUnsub();
      tripsUnsub();
      todayUnsub();
      summariesUnsub();
    };
  }, [appUser?.uid]);

  const driverStats = {
    deliveriesCompleted: deliveries.filter((d) => d.status === 'delivered').length,
    totalDeliveries: deliveries.length,
    totalTrips: trips.length,
    completedTrips: trips.filter((t) => t.status === 'completed').length,
    activeTrips: trips.filter((t) => t.status === 'in_progress').length,
    totalDistance: trips.reduce((sum, t) => sum + getActualDistanceKm(t), 0),
    todayLaminatesDelivered: trips.reduce(
      (sum, t) =>
        sum +
        (t.stops || [])
          .filter((s: any) => s.status === 'delivered')
          .reduce((s: number, stop: any) => s + (stop.laminateQuantity || 0), 0),
      0
    ),
    todayLaminatesDispatched: trips.reduce(
      (sum, t) => sum + (t.totalLaminateQuantity || 0),
      0
    ),
    avgDeliveryTime: deliveries
      .filter((d) => d.createdAt && d.deliveredAt)
      .reduce((sum, d) => {
        const diff = d.deliveredAt!.toMillis() - d.createdAt!.toMillis();
        return sum + diff / (1000 * 60);
      }, 0),
  };

  const salesmanStats = {
    partiesVisited: trips.reduce(
      (sum, t) => sum + t.completedStops,
      0
    ),
    totalStops: trips.reduce((sum, t) => sum + t.stops.length, 0),
    totalTrips: trips.length,
    totalDistance: trips.reduce((sum, t) => sum + getActualDistanceKm(t), 0),
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
        <TouchableOpacity
          style={[styles.tab, selectedTab === 'payments' && styles.tabActive]}
          onPress={() => setSelectedTab('payments')}
        >
          <Text style={[styles.tabText, selectedTab === 'payments' && styles.tabTextActive]}>
            Payments
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, selectedTab === 'settings' && styles.tabActive]}
          onPress={() => setSelectedTab('settings')}
        >
          <Text style={[styles.tabText, selectedTab === 'settings' && styles.tabTextActive]}>
            Settings
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
            <MetricCard
              title="Laminates Delivered"
              value={driverStats.todayLaminatesDelivered}
              subtitle={`of ${driverStats.todayLaminatesDispatched} dispatched`}
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
      ) : selectedTab === 'salesmen' ? (
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
      ) : selectedTab === 'payments' ? (
        <View style={styles.content}>
          <Text style={styles.sectionTitle}>Payment Management</Text>
          <View style={styles.metricsGrid}>
            <MetricCard
              title="Today - Pending"
              value={dailySummaries.filter(s => s.status === 'pending').length}
            />
            <MetricCard
              title="Today - Paid"
              value={dailySummaries.filter(s => s.status === 'paid').length}
            />
            <MetricCard
              title="Archived - Paid"
              value={archivedSummaries.filter(s => s.status === 'paid').length}
            />
            <MetricCard
              title="Archived - Confirmed"
              value={archivedSummaries.filter(s => s.status === 'confirmed').length}
            />
            <MetricCard
              title="Total Rides (Today)"
              value={`${dailySummaries.reduce((sum, s) => sum + s.totalTrips, 0)} trips`}
            />
            <MetricCard
              title="Total Rides (Archived)"
              value={`${archivedSummaries.reduce((sum, s) => sum + s.totalTrips, 0)} trips`}
            />
          </View>

          <Text style={styles.sectionTitle}>Archived Records</Text>

          {archivedSummaries.length === 0 ? (
            <Text style={styles.emptyText}>No archived records found</Text>
          ) : (
            archivedSummaries.map((item) => (
              <View key={item.id} style={styles.summaryCard}>
                <View style={styles.summaryHeader}>
                  <Text style={styles.driverName}>{item.driverName}</Text>

                  <Text
                    style={[
                      styles.statusBadge,
                      {
                        color:
                          item.status === 'confirmed'
                            ? '#34C759'
                            : item.status === 'paid'
                            ? '#007AFF'
                            : '#FF9500',
                      },
                    ]}
                  >
                    {item.status.toUpperCase()}
                  </Text>
                </View>

                <Text style={styles.dateText}>
                  {new Date(item.date).toLocaleDateString('en-IN')}
                </Text>

                <View style={styles.statsRow}>
                  <Text style={styles.statText}>
                    {Math.round(item.totalDistanceKm)} km • {item.totalTrips} trips •{' '}
                    {item.totalStops} stops
                    {(item.totalLaminatesDelivered ?? 0) > 0 ? ` • 📦 ${item.totalLaminatesDelivered} laminates` : ''}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>
      ) : selectedTab === 'settings' ? (
        <View style={styles.content}>
          <Text style={styles.sectionTitle}>Payment Settings</Text>
          <View style={styles.settingsCard}>
            <Text style={styles.settingsLabel}>Price Per Kilometer (₹)</Text>
            <TextInput
              style={styles.settingsInput}
              value={pricePerKm.toString()}
              onChangeText={(v) => setPricePerKm(parseFloat(v) || 0)}
              placeholder="Enter price per km"
              keyboardType="numeric"
            />
            <TouchableOpacity
              style={styles.saveSettingsBtn}
              onPress={async () => {
                try {
                  await set(ref(firebaseService.database, 'settings/pricePerKm'), pricePerKm);
                  Alert.alert('Success', 'Price per km updated');
                } catch (e) {
                  Alert.alert('Error', 'Failed to update settings');
                }
              }}
            >
              <Text style={styles.saveSettingsBtnText}>Save Settings</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
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
  summaryCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  driverName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  statusBadge: {
    fontSize: 12,
    fontWeight: '600',
  },
  dateText: {
    fontSize: 13,
    color: '#666',
    marginBottom: 8,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statText: {
    fontSize: 13,
    color: '#666',
  },
  emptyText: {
    textAlign: 'center',
    color: '#999',
    marginTop: 20,
    fontSize: 15,
  },
  settingsCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    marginBottom: 16,
  },
  settingsLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  settingsInput: {
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    marginBottom: 16,
  },
  saveSettingsBtn: {
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveSettingsBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
});