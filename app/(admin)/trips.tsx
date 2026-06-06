import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  FlatList,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import {
  collection,
  onSnapshot,
  addDoc,
  query,
  orderBy,
  where,
  Timestamp,
} from 'firebase/firestore';
import firebaseService from '../../src/services/firebase';
import { useAuth } from '../../src/context/AuthContext';
import { Trip, DeliveryPriority, TripStop, PolylinePoint } from '../../src/types';
import StatusBadge from '../../src/components/StatusBadge';
import { routeService } from '../../src/services/routes';

const PRIORITIES: DeliveryPriority[] = ['low', 'medium', 'high', 'urgent'];

export default function TripsScreen() {
  const { appUser } = useAuth();
  const mapRef = useRef<MapView>(null);
  const [upcomingTrips, setUpcomingTrips] = useState<Trip[]>([]);
  const [completedTrips, setCompletedTrips] = useState<Trip[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [users, setUsers] = useState<{ [key: string]: any }>({});
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showFullscreenMap, setShowFullscreenMap] = useState(false);
  const [tab, setTab] = useState<'upcoming' | 'history'>('upcoming');
  const [selectedDrivers, setSelectedDrivers] = useState<string[]>([]);
  const [selectedParties, setSelectedParties] = useState<string[]>([]);
  const [newTrip, setNewTrip] = useState({
    date: '',
    priority: 'medium' as DeliveryPriority,
    notes: '',
  });

  useEffect(() => {
    const unsubUpcoming = onSnapshot(
      query(
        collection(firebaseService.firestore, 'trips'),
        where('status', 'in', ['planned', 'in_progress']),
        orderBy('createdAt', 'desc')
      ),
      (snapshot) => {
        const items: Trip[] = [];
        snapshot.forEach((doc) => {
          items.push({ id: doc.id, ...doc.data() } as Trip);
        });
        setUpcomingTrips(items);
      }
    );

    const unsubCompleted = onSnapshot(
      query(
        collection(firebaseService.firestore, 'trips'),
        where('status', '==', 'completed'),
        orderBy('completedAt', 'desc')
      ),
      (snapshot) => {
        const items: Trip[] = [];
        snapshot.forEach((doc) => {
          items.push({ id: doc.id, ...doc.data() } as Trip);
        });
        setCompletedTrips(items);
      }
    );

    const driversUnsub = onSnapshot(
      query(collection(firebaseService.firestore, 'users'), where('role', '==', 'driver')),
      (snapshot) => {
        const items: any[] = [];
        snapshot.forEach((doc) => {
          items.push({ id: doc.id, ...doc.data() });
        });
        setDrivers(items);
      }
    );

    const partiesUnsub = onSnapshot(
      query(collection(firebaseService.firestore, 'parties'), orderBy('name', 'asc')),
      (snapshot) => {
        const items: Party[] = [];
        snapshot.forEach((doc) => {
          items.push({ id: doc.id, ...doc.data() } as Party);
        });
        setParties(items);
      }
    );

    const usersUnsub = firebaseService.onRealtimeValue(
  'live-locations',
  (snapshot) => {
    if (snapshot.exists()) {
      setUsers(snapshot.val());
    }
  }
);

    return () => {
      unsubUpcoming();
      unsubCompleted();
      driversUnsub();
      partiesUnsub();
      usersUnsub();
    };
  }, []);

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371e3;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  const getNavigationInfo = (trip: Trip) => {
    console.log(trip);
    if(!trip || !trip.userId) return null;
    const user = users[trip.userId];
    if (!user || !trip.stops || trip.stops.length === 0) return null;

    const nextStop = trip.stops.find((s) => s.status === 'pending');
    if (!nextStop) return null;

    const distanceToNext = calculateDistance(user.latitude, user.longitude, nextStop.latitude, nextStop.longitude);
    const remainingStops = trip.stops.filter((s) => s.status === 'pending');

    const totalRemainingDistance = remainingStops.reduce((sum, stop, idx) => {
      if (idx === 0) {
        return sum + calculateDistance(user.latitude, user.longitude, stop.latitude, stop.longitude);
      }
      const prevStop = remainingStops[idx - 1];
      return sum + calculateDistance(prevStop.latitude, prevStop.longitude, stop.latitude, stop.longitude);
    }, 0);

    const avgSpeed = 40; // km/h average
    const etaMinutes = Math.round((totalRemainingDistance / 1000) / avgSpeed * 60);

    return {
      nextStop,
      distanceToNext: Math.round(distanceToNext),
      totalRemainingDistance: Math.round(totalRemainingDistance / 1000),
      eta: etaMinutes,
      totalTimeLeft: etaMinutes,
    };
  };

  const handleCreateTrip = async () => {
    if (selectedParties.length === 0) {
      Alert.alert('Error', 'Select at least one party');
      return;
    }

    if (selectedDrivers.length === 0) {
      Alert.alert('Error', 'Select at least one driver');
      return;
    }

    const selectedPartyData = parties.filter((p) => selectedParties.includes(p.id));
    const driver = drivers.find((d) => d.id === selectedDrivers[0]);
    const driverLocation = driver?.latitude && driver?.longitude
      ? { latitude: driver.latitude, longitude: driver.longitude }
      : { latitude: 20.5937, longitude: 78.9629 };

    const stopCoords = selectedPartyData.map((p) => ({
      latitude: p.latitude,
      longitude: p.longitude,
      id: p.id,
    }));

    try {
      const routeResult = await routeService.calculateOptimizedRoute(driverLocation, stopCoords);

      const stops: TripStop[] = selectedPartyData.map((p, idx) => ({
        partyId: p.id,
        partyName: p.name,
        address: p.address,
        latitude: p.latitude,
        longitude: p.longitude,
        order: idx + 1,
        status: 'pending' as const,
      }));

      const driverId = selectedDrivers[0];
      await addDoc(collection(firebaseService.firestore, 'trips'), {
        userId: driverId,
        userRole: 'driver',
        date: newTrip.date || new Date().toISOString().split('T')[0],
        status: 'planned',
        stops,
        optimizedOrder: routeResult.waypoints,
        originalOrder: stops.map(s => s.partyId),
        totalDistance: routeResult.totalDistance,
        totalDuration: routeResult.totalDuration,
        distanceCovered: 0,
        distanceRemaining: routeResult.totalDistance,
        completedStops: 0,
        pendingStops: stops.length,
        completionPercentage: 0,
        priority: newTrip.priority,
        notes: newTrip.notes,
        plannedRoute: routeResult.polyline,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });

      setShowAddModal(false);
      setSelectedDrivers([]);
      setSelectedParties([]);
      setNewTrip({ date: '', priority: 'medium', notes: '' });
      Alert.alert('Success', 'Trip created successfully');
    } catch (error) {
      console.error('Error creating trip:', error);
      Alert.alert('Error', 'Failed to create trip');
    }
  };

  const getDriverName = (uid: string) => {
    const driver = drivers.find((d) => d.id === uid);
    return driver?.displayName || 'Unknown';
  };

  const renderTrip = ({ item }: { item: Trip }) => {
    const navInfo = getNavigationInfo(item);

    return (
      <TouchableOpacity style={styles.tripCard} onPress={() => { setSelectedTrip(item); setShowFullscreenMap(true); }}>
        <View style={styles.tripHeader}>
          <View>
            <Text style={styles.tripTitle}>Trip #{item.id.slice(-6)}</Text>
            <Text style={styles.tripDate}>{item.date}</Text>
          </View>
          <StatusBadge status={item.status} />
        </View>

        <View style={styles.tripMeta}>
          <Text style={styles.metaText}>🚗 {getDriverName(item.userId)}</Text>
          <Text style={styles.metaText}>📍 {item.stops?.length || 0} stops</Text>
          <Text style={styles.metaText}>📏 {Math.round(item.totalDistance || 0)} km</Text>
        </View>

        {navInfo && item.status === 'in_progress' && (
          <View style={styles.navInfo}>
            <View style={styles.navRow}>
              <Text style={styles.navLabel}>Next Stop</Text>
              <Text style={styles.navValue}>{navInfo.nextStop?.partyName}</Text>
            </View>
            <View style={styles.navRow}>
              <Text style={styles.navLabel}>Distance to Next</Text>
              <Text style={styles.navValue}>{navInfo.distanceToNext} m</Text>
            </View>
            <View style={styles.navRow}>
              <Text style={styles.navLabel}>Total Remaining</Text>
              <Text style={styles.navValue}>{navInfo.totalRemainingDistance} km</Text>
            </View>
            <View style={styles.navRow}>
              <Text style={styles.navLabel}>ETA</Text>
              <Text style={styles.navValue}>{navInfo.eta} min</Text>
            </View>
          </View>
        )}

        {item.notes && <Text style={styles.tripNotes}>📝 {item.notes}</Text>}

        <View style={styles.tripStopsPreview}>
          {item.stops?.slice(0, 3).map((stop, idx) => (
            <View key={stop.partyId} style={styles.stopItem}>
              <View style={[styles.stopDot, { backgroundColor: stop.status === 'departed' ? '#34C759' : '#FF9500' }]} />
              <Text style={styles.stopText} numberOfLines={1}>{stop.partyName}</Text>
            </View>
          ))}
          {item.stops && item.stops.length > 3 && (
            <Text style={styles.moreStops}>+{item.stops.length - 3} more</Text>
          )}
        </View>

        <View style={styles.fullscreenHint}>
          <Text style={styles.fullscreenHintText}>Tap to view full map →</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const tripsToShow = tab === 'upcoming' ? upcomingTrips : completedTrips;

  return (
    <View style={styles.container}>
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'upcoming' && styles.tabBtnActive]}
          onPress={() => setTab('upcoming')}
        >
          <Text style={[styles.tabText, tab === 'upcoming' && styles.tabTextActive]}>
            Upcoming ({upcomingTrips.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'history' && styles.tabBtnActive]}
          onPress={() => setTab('history')}
        >
          <Text style={[styles.tabText, tab === 'history' && styles.tabTextActive]}>
            History ({completedTrips.length})
          </Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={tripsToShow}
        renderItem={renderTrip}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>
              {tab === 'upcoming' ? 'No upcoming trips' : 'No trip history'}
            </Text>
          </View>
        }
      />

      {appUser?.role === 'admin' && (
        <TouchableOpacity style={styles.fab} onPress={() => setShowAddModal(true)}>
          <Text style={styles.fabText}>+ New Trip</Text>
        </TouchableOpacity>
      )}

      <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Create New Trip</Text>
            <TouchableOpacity onPress={() => setShowAddModal(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.input}
            placeholder="Date (YYYY-MM-DD)"
            value={newTrip.date}
            onChangeText={(v) => setNewTrip({ ...newTrip, date: v })}
          />

          <Text style={styles.label}>Priority</Text>
          <View style={styles.priorityRow}>
            {PRIORITIES.map((p) => (
              <TouchableOpacity
                key={p}
                style={[styles.priorityChip, newTrip.priority === p && styles.priorityChipActive]}
                onPress={() => setNewTrip({ ...newTrip, priority: p })}
              >
                <Text style={[styles.priorityText, newTrip.priority === p && styles.priorityTextActive]}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Assign Driver</Text>
          {drivers.map((driver) => (
            <TouchableOpacity
              key={driver.id}
              style={[styles.driverRow, selectedDrivers.includes(driver.id) && styles.driverRowSelected]}
              onPress={() => {
                setSelectedDrivers((prev) =>
                  prev.includes(driver.id)
                    ? prev.filter((id) => id !== driver.id)
                    : [...prev, driver.id]
                );
              }}
            >
              <Text style={styles.driverName}>{driver.displayName}</Text>
              <Text style={styles.driverCheck}>
                {selectedDrivers.includes(driver.id) ? '✓' : '○'}
              </Text>
            </TouchableOpacity>
          ))}

          <Text style={styles.label}>Select Parties</Text>
          <ScrollView style={{ maxHeight: 200 }}>
            {parties.map((party) => (
              <TouchableOpacity
                key={party.id}
                style={[styles.partyRow, selectedParties.includes(party.id) && styles.partyRowSelected]}
                onPress={() => {
                  setSelectedParties((prev) =>
                    prev.includes(party.id)
                      ? prev.filter((id) => id !== party.id)
                      : [...prev, party.id]
                  );
                }}
              >
                <Text style={styles.partyName}>{party.name}</Text>
                <Text style={styles.partyCheck}>
                  {selectedParties.includes(party.id) ? '✓' : '○'}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <TextInput
            style={[styles.input, { height: 80 }]}
            placeholder="Notes"
            value={newTrip.notes}
            onChangeText={(v) => setNewTrip({ ...newTrip, notes: v })}
            multiline
          />

          <TouchableOpacity style={styles.saveButton} onPress={handleCreateTrip}>
            <Text style={styles.saveButtonText}>Create Trip</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <Modal visible={showFullscreenMap} animationType="fade">
        <View style={styles.fullscreenContainer}>
          <MapView
            ref={mapRef}
            style={styles.fullscreenMap}
            provider={PROVIDER_GOOGLE}
            initialRegion={{
              latitude: selectedTrip?.stops?.[0]?.latitude || 20.5937,
              longitude: selectedTrip?.stops?.[0]?.longitude || 78.9629,
              latitudeDelta: 0.1,
              longitudeDelta: 0.1,
            }}
            showsUserLocation
            showsMyLocationButton
          >
            {selectedTrip?.stops?.map((stop, idx) => (
              <Marker
                key={`stop-${selectedTrip.id}-${idx}`}
                coordinate={{
                  latitude: stop.latitude,
                  longitude: stop.longitude,
                }}
                pinColor={stop.status === 'departed' ? '#34C759' : '#FF9500' }
                title={stop.partyName}
              />
            ))}

            {selectedTrip?.plannedRoute && (
              <Polyline
                coordinates={selectedTrip.plannedRoute}
                strokeColor="#007AFF"
                strokeWidth={4}
              />
            )}

            {selectedTrip && users[selectedTrip.userId] && (
              <Marker
                coordinate={{
                  latitude: users[selectedTrip.userId].latitude,
                  longitude: users[selectedTrip.userId].longitude,
                }}
                pinColor="#007AFF"
                title="Driver"
              />
            )}
          </MapView>

          <View style={styles.routeInfoOverlay}>
            {getNavigationInfo(selectedTrip!) && (
              <View style={styles.routeInfoCard}>
                <Text style={styles.routeInfoTitle}>Trip Navigation</Text>
                {(() => {
                  const info = getNavigationInfo(selectedTrip!);
                  return (
                    <>
                      <View style={styles.routeInfoRow}>
                        <Text style={styles.routeInfoLabel}>Next Stop</Text>
                        <Text style={styles.routeInfoValue}>{info?.nextStop?.partyName}</Text>
                      </View>
                      <View style={styles.routeInfoRow}>
                        <Text style={styles.routeInfoLabel}>Distance to Next</Text>
                        <Text style={styles.routeInfoValue}>{info?.distanceToNext} m</Text>
                      </View>
                      <View style={styles.routeInfoRow}>
                        <Text style={styles.routeInfoLabel}>Total Remaining</Text>
                        <Text style={styles.routeInfoValue}>{info?.totalRemainingDistance} km</Text>
                      </View>
                      <View style={styles.routeInfoRow}>
                        <Text style={styles.routeInfoLabel}>ETA</Text>
                        <Text style={styles.routeInfoValue}>{info?.eta} min</Text>
                      </View>
                    </>
                  );
                })()}
              </View>
            )}
          </View>

          <TouchableOpacity
            style={styles.closeFullscreenBtn}
            onPress={() => setShowFullscreenMap(false)}
          >
            <Text style={styles.closeFullscreenBtnText}>✕ Close</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
  },
  tabBtnActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#007AFF',
  },
  tabText: {
    fontSize: 15,
    color: '#666',
  },
  tabTextActive: {
    color: '#007AFF',
    fontWeight: '600',
  },
  list: {
    padding: 12,
    gap: 12,
  },
  tripCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  tripHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  tripTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  tripDate: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  tripMeta: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 8,
  },
  metaText: {
    fontSize: 13,
    color: '#666',
  },
  navInfo: {
    backgroundColor: '#F0F8FF',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    gap: 4,
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  navLabel: {
    fontSize: 12,
    color: '#666',
  },
  navValue: {
    fontSize: 12,
    color: '#007AFF',
    fontWeight: '500',
  },
  tripNotes: {
    fontSize: 12,
    color: '#999',
    marginBottom: 8,
  },
  tripStopsPreview: {
    marginTop: 8,
    gap: 4,
  },
  stopItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stopDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  stopText: {
    fontSize: 12,
    color: '#666',
    flex: 1,
  },
  moreStops: {
    fontSize: 12,
    color: '#007AFF',
    marginLeft: 14,
  },
  fullscreenHint: {
    marginTop: 8,
    alignItems: 'flex-end',
  },
  fullscreenHintText: {
    fontSize: 12,
    color: '#007AFF',
  },
  emptyState: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    backgroundColor: '#007AFF',
    borderRadius: 28,
    paddingVertical: 14,
    paddingHorizontal: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  fabText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  modal: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#333',
  },
  modalClose: {
    fontSize: 24,
    color: '#999',
    padding: 8,
  },
  input: {
    backgroundColor: '#FFF',
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
    marginTop: 16,
  },
  priorityRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  priorityChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  priorityChipActive: {
    backgroundColor: '#FF9500',
    borderColor: '#FF9500',
  },
  priorityText: {
    fontSize: 13,
    color: '#666',
  },
  priorityTextActive: {
    color: '#FFF',
  },
  driverRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  driverRowSelected: {
    borderColor: '#007AFF',
    backgroundColor: '#F0F8FF',
  },
  driverName: {
    fontSize: 15,
    color: '#333',
  },
  driverCheck: {
    fontSize: 18,
    color: '#007AFF',
  },
  partyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  partyRowSelected: {
    borderColor: '#007AFF',
    backgroundColor: '#F0F8FF',
  },
  partyName: {
    fontSize: 15,
    color: '#333',
  },
  partyCheck: {
    fontSize: 18,
    color: '#007AFF',
  },
  saveButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  saveButtonText: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '600',
  },
  fullscreenContainer: {
    flex: 1,
  },
  fullscreenMap: {
    flex: 1,
  },
  routeInfoOverlay: {
    position: 'absolute',
    bottom: 100,
    left: 16,
    right: 16,
  },
  routeInfoCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 6,
  },
  routeInfoTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginBottom: 4,
  },
  routeInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  routeInfoLabel: {
    fontSize: 14,
    color: '#666',
  },
  routeInfoValue: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  closeFullscreenBtn: {
    position: 'absolute',
    top: 40,
    right: 16,
    backgroundColor: '#FFF',
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  closeFullscreenBtnText: {
    fontSize: 18,
    color: '#333',
    fontWeight: '600',
  },
});