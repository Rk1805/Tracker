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
  Platform,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import DateTimePicker from '@react-native-community/datetimepicker';
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
import { Trip, DeliveryPriority, TripStop } from '../../src/types';
import StatusBadge from '../../src/components/StatusBadge';
import { routeService } from '../../src/services/routes';

const PRIORITIES: DeliveryPriority[] = ['low', 'medium', 'high', 'urgent'];

// --- Reusable Searchable Dropdown Component ---
const SearchablePicker = ({ visible, onClose, data, onSelect, title, placeholder }: any) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredData = data.filter((item: any) =>
    item.label.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.dropdownOverlay}>
        <View style={styles.dropdownContent}>
          <View style={styles.dropdownHeader}>
            <Text style={styles.dropdownTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.dropdownClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.searchInput}
            placeholder={placeholder}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
          />
          <FlatList
            data={filteredData}
            keyExtractor={(item) => item.value}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.dropdownItem}
                onPress={() => {
                  onSelect(item.value);
                  setSearchQuery('');
                  onClose();
                }}
              >
                <Text style={styles.dropdownItemText}>{item.label}</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={styles.emptySearchText}>No results found</Text>
            }
          />
        </View>
      </View>
    </Modal>
  );
};

export default function TripsScreen() {
  const { appUser } = useAuth();
  const mapRef = useRef<MapView>(null);
  const [upcomingTrips, setUpcomingTrips] = useState<Trip[]>([]);
  const [completedTrips, setCompletedTrips] = useState<Trip[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [parties, setParties] = useState<any[]>([]); 
  const [users, setUsers] = useState<{ [key: string]: any }>({});
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showFullscreenMap, setShowFullscreenMap] = useState(false);
  const [tab, setTab] = useState<'upcoming' | 'history'>('upcoming');
  const [selectedDrivers, setSelectedDrivers] = useState<string[]>([]);
  const [selectedParties, setSelectedParties] = useState<string[]>([]);
  const [newTrip, setNewTrip] = useState({
    priority: 'medium' as DeliveryPriority,
    notes: '',
  });

  // Expand/Collapse State
  const [expandedTripIds, setExpandedTripIds] = useState<string[]>([]);

  // Filter States
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [filterDate, setFilterDate] = useState<string | null>(null);
  const [filterDriver, setFilterDriver] = useState<string | null>(null);
  const [filterParty, setFilterParty] = useState<string | null>(null);

  // Dropdown / Picker Visibility States
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showDriverPicker, setShowDriverPicker] = useState(false);
  const [showPartyPicker, setShowPartyPicker] = useState(false);

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
        const items: any[] = [];
        snapshot.forEach((doc) => {
          items.push({ id: doc.id, ...doc.data() });
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

    const avgSpeed = 40; 
    const etaMinutes = Math.round((totalRemainingDistance / 1000) / avgSpeed * 60);

    return {
      nextStop,
      distanceToNext: Math.round(distanceToNext),
      totalRemainingDistance: Math.round(totalRemainingDistance / 1000),
      eta: etaMinutes,
      totalTimeLeft: etaMinutes,
    };
  };

  const toggleExpandTrip = (tripId: string) => {
    setExpandedTripIds(prev => 
      prev.includes(tripId) 
        ? prev.filter(id => id !== tripId) 
        : [...prev, tripId]
    );
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
        partyName: p.name || 'Unknown',
        address: p.address || '',
        latitude: p.latitude,
        longitude: p.longitude,
        order: idx + 1,
        status: 'pending' as const,
      }));
      const today = new Date();
      const formattedDate =
      String(today.getDate()).padStart(2, '0') +
      '-' +
      String(today.getMonth() + 1).padStart(2, '0') +
      '-' +
      today.getFullYear();

      const driverId = selectedDrivers[0];
      await addDoc(collection(firebaseService.firestore, 'trips'), {
        userId: driverId,
        userRole: 'driver',
        date: formattedDate,
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
      setNewTrip({ priority: 'medium', notes: '' });
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

  const clearFilters = () => {
    setFilterDate(null);
    setFilterDriver(null);
    setFilterParty(null);
  };

  const handleDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') setShowDatePicker(false);
    
    if (event.type === 'set' && selectedDate) {
      const formatted =
        String(selectedDate.getDate()).padStart(2, '0') +
        '-' +
        String(selectedDate.getMonth() + 1).padStart(2, '0') +
        '-' +
        selectedDate.getFullYear();
      setFilterDate(formatted);
    } else if (event.type === 'dismissed') {
      setShowDatePicker(false);
    }
  };

  const getDateObj = (dateStr: string) => {
    const [d, m, y] = dateStr.split('-');
    return new Date(Number(y), Number(m) - 1, Number(d));
  };

  const renderTrip = ({ item }: { item: Trip }) => {
    const navInfo = getNavigationInfo(item);
    const isActive = item.status === 'in_progress';
    const isHistory = item.status === 'completed';
    const isExpanded = expandedTripIds.includes(item.id) || isActive; // Always expand active trips
    const driverName = getDriverName(item.userId) || 'Unknown Driver';

    const partiesPreview = item.stops?.map((s) => s.partyName).join(', ') || 'No parties';

    return (
      <TouchableOpacity 
        style={[styles.tripCard, isActive && styles.activeTripCard]} 
        onPress={() => toggleExpandTrip(item.id)}
        activeOpacity={0.8}
      >
        <View style={styles.tripHeader}>
          <View style={{ flex: 1 }}>
            <View style={styles.titleRow}>
              <Text style={styles.tripTitle}>Trip #{item.id.slice(-6)}</Text>
              <StatusBadge status={item.status} />
            </View>
            <Text style={styles.tripDate}>{item.date || 'No date'}</Text>
            
            {!isExpanded && (
              <Text style={styles.previewText} numberOfLines={2}>
                <Text style={{ fontWeight: '600' }}>🚗 {driverName}{'\n'}</Text>
                <Text style={{ fontWeight: '600' }}>Parties: </Text>
                {partiesPreview}
              </Text>
            )}
          </View>
          <Text style={styles.expandIcon}>{isExpanded ? '▲' : '▼'}</Text>
        </View>

        {isExpanded && (
          <View style={styles.expandedContent}>
            <View style={styles.tripMeta}>
              <Text style={styles.metaText}>🚗 {driverName}</Text>
              <Text style={styles.metaText}>📍 {item.stops?.length || 0} stops</Text>
              <Text style={styles.metaText}>📏 {Math.round(item.totalDistance || 0)} km</Text>
            </View>

            {navInfo && isActive && (
              <View style={styles.navInfo}>
                <View style={styles.navRow}>
                  <Text style={styles.navLabel}>Next Stop</Text>
                  <Text style={styles.navValue}>{navInfo.nextStop?.partyName || 'N/A'}</Text>
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

            <View style={styles.stopsList}>
              {item.stops?.map((stop: any, index: number) => {
                const arrivalDate = stop.arrivalTime
                  ? stop.arrivalTime?.toDate
                    ? stop.arrivalTime.toDate()
                    : stop.arrivalTime?.seconds
                      ? new Date(stop.arrivalTime.seconds * 1000)
                      : null
                  : null;

                return (
                  <View key={index} style={styles.stopItem}>
                    <View style={styles.stopNumber}>
                      <Text style={styles.stopNumberText}>{index + 1}</Text>
                    </View>

                    <View style={styles.stopInfo}>
                      <Text style={styles.stopName}>{String(stop.partyName || "Unknown")}</Text>
                      <Text style={styles.stopAddress}>{String(stop.address || "No address")}</Text>
                      <StatusBadge status={String(stop.status || "unknown")} size="small" />

                      {arrivalDate && (
                        <Text style={styles.stopTime}>
                          Arrived: {arrivalDate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                        </Text>
                      )}
                      {stop.durationSpent !== undefined && (
                        <Text style={styles.stopTime}>Spent: {String(stop.durationSpent)} min</Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>

            {/* ONLY SHOW MINI MAP IF UPCOMING */}
            {!isHistory && item.plannedRoute && item.plannedRoute.length > 0 && (
              <View style={styles.routeMap}>
                <MapView
                  style={styles.miniMap}
                  provider={PROVIDER_GOOGLE}
                  scrollEnabled={false}
                  zoomEnabled={false}
                  initialRegion={{
                    latitude: item.plannedRoute[0]?.latitude || 20.5937,
                    longitude: item.plannedRoute[0]?.longitude || 78.9629,
                    latitudeDelta: 0.5,
                    longitudeDelta: 0.5,
                  }}
                >
                  <Polyline
                    coordinates={item.plannedRoute}
                    strokeColor="#007AFF"
                    strokeWidth={3}
                  />
                  {item.stops?.map((stop: any, idx: number) => (
                    <Marker
                      key={idx}
                      coordinate={{
                        latitude: stop.latitude,
                        longitude: stop.longitude,
                      }}
                      pinColor={stop.status === 'departed' ? '#34C759' : '#FF9500'}
                    />
                  )) || []}
                </MapView>
              </View>
            )}

            <TouchableOpacity 
              style={styles.openMapBtn} 
              onPress={(e) => { e.stopPropagation(); setSelectedTrip(item); setShowFullscreenMap(true); }}
            >
              <Text style={styles.openMapBtnText}>🗺️ View Full Map</Text>
            </TouchableOpacity>

          </View>
        )}
      </TouchableOpacity>
    );
  };

  // Filter Logic for History
  const filteredHistoryTrips = completedTrips.filter((trip) => {
    let matches = true;
    if (filterDate && trip.date !== filterDate) matches = false;
    if (filterDriver && trip.userId !== filterDriver) matches = false;
    if (filterParty) {
      const hasParty = trip.stops?.some((stop) => stop.partyId === filterParty);
      if (!hasParty) matches = false;
    }
    return matches;
  });

  const tripsToShow = tab === 'upcoming' ? upcomingTrips : filteredHistoryTrips;

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

      {tab === 'history' && (
        <View style={styles.filterBar}>
          <TouchableOpacity style={styles.filterBtn} onPress={() => setShowFilterModal(true)}>
            <Text style={styles.filterBtnText}>
              ⚙️ Filters {(filterDate || filterDriver || filterParty) ? '(Active)' : ''}
            </Text>
          </TouchableOpacity>
          {(filterDate || filterDriver || filterParty) ? (
            <TouchableOpacity style={styles.clearBtn} onPress={clearFilters}>
              <Text style={styles.clearBtnText}>Clear</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      <FlatList
        data={tripsToShow}
        renderItem={renderTrip}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>
              {tab === 'upcoming' ? 'No upcoming trips' : 'No trip history found'}
            </Text>
          </View>
        }
      />

      {appUser?.role === 'admin' && (
        <TouchableOpacity style={styles.fab} onPress={() => setShowAddModal(true)}>
          <Text style={styles.fabText}>+ New Trip</Text>
        </TouchableOpacity>
      )}

      {/* FILTER MODAL */}
      <Modal visible={showFilterModal} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Filter History</Text>
            <TouchableOpacity onPress={() => setShowFilterModal(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Filter by Date */}
            <Text style={styles.label}>Select Date</Text>
            <View style={styles.filterRow}>
              <TouchableOpacity style={styles.dropdownSelector} onPress={() => setShowDatePicker(true)}>
                <Text style={[styles.dropdownSelectorText, !filterDate && { color: '#999' }]}>
                  {filterDate || 'Select a date'}
                </Text>
              </TouchableOpacity>
              {filterDate && (
                <TouchableOpacity style={styles.inlineClearBtn} onPress={() => setFilterDate(null)}>
                  <Text style={styles.clearIcon}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Filter by Driver */}
            <Text style={styles.label}>Select Driver</Text>
            <View style={styles.filterRow}>
              <TouchableOpacity style={styles.dropdownSelector} onPress={() => setShowDriverPicker(true)}>
                <Text style={[styles.dropdownSelectorText, !filterDriver && { color: '#999' }]}>
                  {filterDriver ? drivers.find(d => d.id === filterDriver)?.displayName || 'Unknown' : 'Select a driver'}
                </Text>
              </TouchableOpacity>
              {filterDriver && (
                <TouchableOpacity style={styles.inlineClearBtn} onPress={() => setFilterDriver(null)}>
                  <Text style={styles.clearIcon}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Filter by Party */}
            <Text style={styles.label}>Select Party</Text>
            <View style={styles.filterRow}>
              <TouchableOpacity style={styles.dropdownSelector} onPress={() => setShowPartyPicker(true)}>
                <Text style={[styles.dropdownSelectorText, !filterParty && { color: '#999' }]}>
                  {filterParty ? parties.find(p => p.id === filterParty)?.name || 'Unknown' : 'Select a party'}
                </Text>
              </TouchableOpacity>
              {filterParty && (
                <TouchableOpacity style={styles.inlineClearBtn} onPress={() => setFilterParty(null)}>
                  <Text style={styles.clearIcon}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity style={styles.saveButton} onPress={() => setShowFilterModal(false)}>
              <Text style={styles.saveButtonText}>Apply Filters</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={[styles.saveButton, { backgroundColor: '#F44336', marginTop: 12 }]} onPress={clearFilters}>
              <Text style={styles.saveButtonText}>Clear All Filters</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* DATE PICKER (NATIVE) */}
      {showDatePicker && (
        <DateTimePicker
          value={filterDate ? getDateObj(filterDate) : new Date()}
          mode="date"
          display="default"
          onChange={handleDateChange}
        />
      )}

      {/* SEARCHABLE DRIVER PICKER */}
      <SearchablePicker
        visible={showDriverPicker}
        onClose={() => setShowDriverPicker(false)}
        data={drivers.map(d => ({ label: d.displayName || 'Unknown', value: d.id }))}
        onSelect={setFilterDriver}
        title="Search Drivers"
        placeholder="Type driver name..."
      />

      {/* SEARCHABLE PARTY PICKER */}
      <SearchablePicker
        visible={showPartyPicker}
        onClose={() => setShowPartyPicker(false)}
        data={parties.map(p => ({ label: p.name || 'Unknown', value: p.id }))}
        onSelect={setFilterParty}
        title="Search Parties"
        placeholder="Type party name..."
      />

      {/* CREATE NEW TRIP MODAL */}
      <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Create New Trip</Text>
            <TouchableOpacity onPress={() => setShowAddModal(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>

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
              <Text style={styles.driverName}>{driver.displayName || 'Unknown'}</Text>
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
                <Text style={styles.partyName}>{party.name || 'Unknown'}</Text>
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

      {/* FULLSCREEN MAP MODAL */}
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
                pinColor={stop.status === 'departed' ? '#34C759' : '#FF9500'}
                title={stop.partyName || 'Unknown'}
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
                        <Text style={styles.routeInfoValue}>{info?.nextStop?.partyName || 'N/A'}</Text>
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
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  tabContainer: { flexDirection: 'row', backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#E0E0E0' },
  tabBtn: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: '#007AFF' },
  tabText: { fontSize: 15, color: '#666' },
  tabTextActive: { color: '#007AFF', fontWeight: '600' },
  filterBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#E0E0E0' },
  filterBtn: { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#F0F8FF', borderRadius: 16, borderWidth: 1, borderColor: '#007AFF' },
  filterBtnText: { color: '#007AFF', fontSize: 13, fontWeight: '600' },
  clearBtn: { paddingVertical: 6, paddingHorizontal: 12 },
  clearBtnText: { color: '#F44336', fontSize: 13, fontWeight: '600' },
  list: { padding: 12, gap: 12 },
  tripCard: { backgroundColor: '#FFF', borderRadius: 12, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
  activeTripCard: { borderWidth: 2, borderColor: '#007AFF' },
  tripHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  tripTitle: { fontSize: 16, fontWeight: '600', color: '#333' },
  tripDate: { fontSize: 13, color: '#666', marginTop: 2 },
  previewText: { fontSize: 13, color: '#666', marginTop: 8, paddingRight: 8 },
  expandIcon: { fontSize: 12, color: '#999', paddingLeft: 8, marginTop: 4 },
  expandedContent: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F0F0F0' },
  tripMeta: { flexDirection: 'row', gap: 16, marginBottom: 12 },
  metaText: { fontSize: 13, color: '#666', fontWeight: '500' },
  navInfo: { backgroundColor: '#F0F8FF', borderRadius: 8, padding: 10, marginBottom: 12, gap: 4 },
  navRow: { flexDirection: 'row', justifyContent: 'space-between' },
  navLabel: { fontSize: 12, color: '#666' },
  navValue: { fontSize: 12, color: '#007AFF', fontWeight: '500' },
  tripNotes: { fontSize: 12, color: '#999', marginBottom: 12 },
  
  stopsList: { gap: 8, marginBottom: 12 },
  stopItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stopNumber: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#007AFF', justifyContent: 'center', alignItems: 'center' },
  stopNumberText: { color: '#FFF', fontSize: 12, fontWeight: '600' },
  stopInfo: { flex: 1 },
  stopName: { fontSize: 14, fontWeight: '500', color: '#333' },
  stopAddress: { fontSize: 11, color: '#999', marginBottom: 4 },
  stopTime: { fontSize: 11, color: '#666', marginTop: 2 },
  
  routeMap: { height: 150, borderRadius: 8, overflow: 'hidden', marginBottom: 12 },
  miniMap: { flex: 1 },
  openMapBtn: { backgroundColor: '#F0F8FF', paddingVertical: 10, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#007AFF' },
  openMapBtnText: { color: '#007AFF', fontSize: 14, fontWeight: '600' },
  
  emptyState: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: 16, color: '#999' },
  fab: { position: 'absolute', bottom: 24, right: 24, backgroundColor: '#007AFF', borderRadius: 28, paddingVertical: 14, paddingHorizontal: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6 },
  fabText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  modal: { flex: 1, backgroundColor: '#F5F5F5', padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  modalTitle: { fontSize: 22, fontWeight: '700', color: '#333' },
  modalClose: { fontSize: 24, color: '#999', padding: 8 },
  input: { backgroundColor: '#FFF', borderRadius: 10, padding: 14, fontSize: 15, borderWidth: 1, borderColor: '#E0E0E0', marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '600', color: '#666', marginBottom: 8, marginTop: 16 },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  dropdownSelector: { flex: 1, backgroundColor: '#FFF', padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#E0E0E0', justifyContent: 'center' },
  dropdownSelectorText: { fontSize: 15, color: '#333' },
  inlineClearBtn: { backgroundColor: '#FFEBEB', padding: 12, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  clearIcon: { fontSize: 16, color: '#F44336', fontWeight: 'bold' },
  priorityRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  priorityChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E0E0E0' },
  priorityChipActive: { backgroundColor: '#FF9500', borderColor: '#FF9500' },
  priorityText: { fontSize: 13, color: '#666' },
  priorityTextActive: { color: '#FFF' },
  driverRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#E0E0E0' },
  driverRowSelected: { borderColor: '#007AFF', backgroundColor: '#F0F8FF' },
  driverName: { fontSize: 15, color: '#333' },
  driverCheck: { fontSize: 18, color: '#007AFF' },
  partyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#E0E0E0' },
  partyRowSelected: { borderColor: '#007AFF', backgroundColor: '#F0F8FF' },
  partyName: { fontSize: 15, color: '#333' },
  partyCheck: { fontSize: 18, color: '#007AFF' },
  saveButton: { backgroundColor: '#007AFF', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24 },
  saveButtonText: { color: '#FFF', fontSize: 17, fontWeight: '600' },
  fullscreenContainer: { flex: 1 },
  fullscreenMap: { flex: 1 },
  routeInfoOverlay: { position: 'absolute', bottom: 100, left: 16, right: 16 },
  routeInfoCard: { backgroundColor: '#FFF', borderRadius: 12, padding: 16, gap: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 6 },
  routeInfoTitle: { fontSize: 16, fontWeight: '700', color: '#333', marginBottom: 4 },
  routeInfoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  routeInfoLabel: { fontSize: 14, color: '#666' },
  routeInfoValue: { fontSize: 14, color: '#333', fontWeight: '500' },
  closeFullscreenBtn: { position: 'absolute', top: 40, right: 16, backgroundColor: '#FFF', borderRadius: 20, width: 40, height: 40, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4, elevation: 4 },
  closeFullscreenBtnText: { fontSize: 18, color: '#333', fontWeight: '600' },
  
  // Searchable Picker Styles
  dropdownOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  dropdownContent: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%', padding: 20 },
  dropdownHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  dropdownTitle: { fontSize: 18, fontWeight: '700', color: '#333' },
  dropdownClose: { fontSize: 22, color: '#999', padding: 4 },
  searchInput: { backgroundColor: '#F5F5F5', borderRadius: 10, padding: 12, fontSize: 15, marginBottom: 16 },
  dropdownItem: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#E0E0E0' },
  dropdownItemText: { fontSize: 16, color: '#333' },
  emptySearchText: { textAlign: 'center', color: '#999', marginTop: 20, fontSize: 15 }
});