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
import MapViewDirections from 'react-native-maps-directions';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  collection,
  onSnapshot,
  addDoc,
  query,
  orderBy,
  where,
  Timestamp,
  updateDoc,
  doc
} from 'firebase/firestore';
import firebaseService from '../../src/services/firebase';
import { useAuth } from '../../src/context/AuthContext';
import { Trip, DeliveryPriority, TripStop } from '../../src/types';
import StatusBadge from '../../src/components/StatusBadge';
import { routeService } from '../../src/services/routes';
import { locationService } from '../../src/services/location';
import * as Location from 'expo-location';

const PRIORITIES: DeliveryPriority[] = ['low', 'medium', 'high', 'urgent'];
const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';

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

  // Live Tracking States
  const [currentLocation, setCurrentLocation] = useState<Location.LocationObject | null>(null);
  const [currentSpeed, setCurrentSpeed] = useState<number>(0);

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
        if (selectedTrip) {
          const updatedSelected = items.find(i => i.id === selectedTrip.id);
          if (updatedSelected) setSelectedTrip(updatedSelected);
        }
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
  }, [selectedTrip]);

  // Real-time location watcher for Navigation map
  useEffect(() => {
    let unsubWatcher: (() => void) | undefined;

    if (showFullscreenMap && selectedTrip?.status === 'in_progress') {
      const startWatching = async () => {
        unsubWatcher = await locationService.watchPosition((loc) => {
          setCurrentLocation(loc);
          setCurrentSpeed(loc.coords.speed ? Math.round(loc.coords.speed * 3.6) : 0);
        });
      };
      startWatching();
    }
    return () => { if (unsubWatcher) unsubWatcher(); };
  }, [showFullscreenMap, selectedTrip]);

  const toggleExpandTrip = (tripId: string) => {
    setExpandedTripIds(prev => 
      prev.includes(tripId) 
        ? prev.filter(id => id !== tripId) 
        : [...prev, tripId]
    );
  };

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371e3; // meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  const calculateBearing = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
              Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
    const bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360;
  };

  const getHeadingDirection = (heading: number) => {
    if (!heading) return 'North';
    const directions = ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'];
    const index = Math.round(heading / 45) % 8;
    return directions[index];
  };

  const getDynamicNavigationInfo = (trip: Trip) => {
    if (!trip?.stops?.length || !trip.userId) return null;
    const driverLoc = users[trip.userId];
    if (!driverLoc) return null;

    const pendingStops = trip.stops.filter((s) => s.status === 'pending');
    if (!pendingStops.length) return null;

    const nextStop = pendingStops[0];
    const startLat = driverLoc.latitude;
    const startLon = driverLoc.longitude;

    const distanceToNext = calculateDistance(startLat, startLon, nextStop.latitude, nextStop.longitude) / 1000;
    const bearingToNext = calculateBearing(startLat, startLon, nextStop.latitude, nextStop.longitude);

    const totalRemaining = pendingStops.slice(1).reduce((sum, stop, idx) => {
      const prev = pendingStops[idx];
      return sum + (calculateDistance(prev.latitude, prev.longitude, stop.latitude, stop.longitude) / 1000);
    }, distanceToNext);

    const currentSpeedKmH = driverLoc.speed ? Math.round(driverLoc.speed * 3.6) : 0;
    const effectiveSpeed = currentSpeedKmH > 5 ? currentSpeedKmH : 30; 
    const etaNextMinutes = Math.round((distanceToNext / effectiveSpeed) * 60);
    const etaTotalMinutes = Math.round((totalRemaining / effectiveSpeed) * 60);

    return {
      nextStop,
      distanceToNext: Math.round(distanceToNext * 100) / 100,
      totalRemainingDistance: Math.round(totalRemaining * 10) / 10,
      etaNext: etaNextMinutes,
      etaTotal: etaTotalMinutes,
      currentSpeed: currentSpeedKmH,
      bearingDirection: getHeadingDirection(bearingToNext),
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
    
    // Default fallback set to Bengaluru
    const driverLocation = driver?.latitude && driver?.longitude
      ? { latitude: driver.latitude, longitude: driver.longitude }
      : { latitude: 12.9716, longitude: 77.5946 };

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
    const navInfo = getDynamicNavigationInfo(item);
    const isActive = item.status === 'in_progress';
    const isHistory = item.status === 'completed';
    const isExpanded = expandedTripIds.includes(item.id) || isActive; 
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

            {isActive && (
              <View style={styles.progressSection}>
                <View style={styles.progressBarBg}>
                  <View style={[styles.progressBarFill, { width: `${item.completionPercentage || 0}%` }]} />
                </View>
                <Text style={styles.progressPercent}>{item.completionPercentage || 0}%</Text>
              </View>
            )}

            {navInfo && isActive && (
              <View style={styles.navInfo}>
                <View style={styles.navRow}>
                  <Text style={styles.navLabel}>Driver Heading To</Text>
                  <Text style={styles.navValue}>{navInfo.nextStop?.partyName || 'N/A'}</Text>
                </View>
                <View style={styles.navRow}>
                  <Text style={styles.navLabel}>Distance to Next</Text>
                  <Text style={styles.navValue}>{navInfo.distanceToNext} km</Text>
                </View>
                <View style={styles.navRow}>
                  <Text style={styles.navLabel}>Total Remaining</Text>
                  <Text style={styles.navValue}>{navInfo.totalRemainingDistance} km</Text>
                </View>
                <View style={styles.navRow}>
                  <Text style={styles.navLabel}>ETA Overall</Text>
                  <Text style={styles.navValue}>{navInfo.etaTotal} min</Text>
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
                    <View style={[styles.stopNumber, stop.status === 'delivered' && {backgroundColor: '#34C759'}]}>
                      <Text style={styles.stopNumberText}>{stop.status === 'delivered' ? '✓' : index + 1}</Text>
                    </View>

                    <View style={styles.stopInfo}>
                      <Text style={[styles.stopName, stop.status === 'delivered' && {textDecorationLine: 'line-through', color: '#999'}]}>
                        {String(stop.partyName || "Unknown")}
                      </Text>
                      <Text style={styles.stopAddress}>{String(stop.address || "No address")}</Text>
                      
                      {arrivalDate && (
                        <Text style={styles.stopTime}>
                          Delivered: {arrivalDate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                        </Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>

            {/* STATIC MINIMAP ONLY FOR UPCOMING TRIPS (Fallback if not active) */}
            {!isHistory && !isActive && item.plannedRoute && item.plannedRoute.length > 0 && (
              <View style={styles.routeMap}>
                <MapView
                  style={styles.miniMap}
                  provider={PROVIDER_GOOGLE}
                  scrollEnabled={false}
                  zoomEnabled={false}
                  initialRegion={{
                    latitude: item.plannedRoute[0]?.latitude || 12.9716, // Bengaluru fallback
                    longitude: item.plannedRoute[0]?.longitude || 77.5946,
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
                      pinColor={stop.status === 'delivered' ? '#34C759' : '#FF9500'}
                    />
                  )) || []}
                </MapView>
              </View>
            )}

            <TouchableOpacity 
              style={styles.openMapBtn} 
              onPress={(e) => { e.stopPropagation(); setSelectedTrip(item); setShowFullscreenMap(true); }}
            >
              <Text style={styles.openMapBtnText}>
                {isActive ? '🗺️ View Live Navigation' : '🗺️ View Full Map'}
              </Text>
            </TouchableOpacity>

          </View>
        )}
      </TouchableOpacity>
    );
  };

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
  
  // Logic for the Fullscreen Modal
  const pendingStopsForMap = selectedTrip?.stops?.filter((s: any) => s.status === 'pending') || [];
  const destinationStop = pendingStopsForMap.length > 0 ? pendingStopsForMap[pendingStopsForMap.length - 1] : null;
  const currentDriverLoc = selectedTrip ? users[selectedTrip.userId] : null;
  const modalNavInfo = selectedTrip ? getDynamicNavigationInfo(selectedTrip) : null;

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

      {/* --- FILTER MODAL (RESTORED COMPLETELY) --- */}
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

      {/* DATE PICKER */}
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

      {/* FULLSCREEN MAP MODAL FOR ADMIN */}
      <Modal visible={showFullscreenMap} animationType="fade">
        <View style={styles.fullscreenContainer}>
          <MapView
            ref={mapRef}
            style={styles.fullscreenMap}
            provider={PROVIDER_GOOGLE}
            initialRegion={{
              latitude: currentDriverLoc?.latitude || selectedTrip?.stops?.[0]?.latitude || 12.9716,
              longitude: currentDriverLoc?.longitude || selectedTrip?.stops?.[0]?.longitude || 77.5946,
              latitudeDelta: 0.05,
              longitudeDelta: 0.05,
            }}
          >
            {/* Draw driver's marker if live */}
            {selectedTrip?.status === 'in_progress' && currentDriverLoc && (
              <Marker
                coordinate={{ latitude: currentDriverLoc.latitude, longitude: currentDriverLoc.longitude }}
                title={getDriverName(selectedTrip.userId)}
                description="Live Driver Location"
                pinColor="#0000FF"
              />
            )}

            {/* Render Stops */}
            {selectedTrip?.stops?.map((stop: any, idx: number) => (
              <Marker
                key={`stop-${selectedTrip.id}-${idx}`}
                coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}
                pinColor={stop.status === 'delivered' ? '#34C759' : '#FF9500'}
                title={stop.partyName}
              />
            )) || []}

            {/* DYNAMIC ROAD ROUTING using Google Maps Directions API for Admin View */}
            {selectedTrip?.status === 'in_progress' && currentDriverLoc && destinationStop ? (
              <MapViewDirections
                origin={{
                  latitude: currentDriverLoc.latitude,
                  longitude: currentDriverLoc.longitude,
                }}
                destination={{
                  latitude: destinationStop.latitude,
                  longitude: destinationStop.longitude,
                }}
                waypoints={
                  pendingStopsForMap.slice(0, -1).map((s: any) => ({
                    latitude: s.latitude,
                    longitude: s.longitude,
                  }))
                }
                apikey={GOOGLE_MAPS_API_KEY} 
                strokeWidth={6}
                strokeColor="#007AFF"
                optimizeWaypoints={false}
                mode="DRIVING"
              />
            ) : (
              selectedTrip?.plannedRoute && (
                <Polyline coordinates={selectedTrip.plannedRoute} strokeColor="#007AFF" strokeWidth={5} />
              )
            )}
          </MapView>

          {/* Top Google Maps Style overlay (Admin sees driver's heading) */}
          {modalNavInfo && selectedTrip?.status === 'in_progress' && (
            <View style={styles.topNavOverlay}>
              <View style={styles.navHeaderCard}>
                <Text style={styles.navDirectionText}>Driver heading {modalNavInfo.bearingDirection} to: <Text style={{fontWeight: '700'}}>{modalNavInfo.nextStop?.partyName}</Text></Text>
                <Text style={styles.navSubText}>{modalNavInfo.nextStop?.address}</Text>
                <View style={styles.etaRow}>
                  <Text style={styles.etaHighlight}>{modalNavInfo.etaNext} min</Text>
                  <Text style={styles.etaDistance}>({modalNavInfo.distanceToNext} km)</Text>
                </View>
              </View>
            </View>
          )}

          {/* Bottom Google Maps Style overlay */}
          {modalNavInfo && selectedTrip?.status === 'in_progress' && (
            <View style={styles.bottomNavOverlay}>
              <View style={styles.bottomStatsCard}>
                <View style={styles.statBox}>
                  <Text style={styles.statValue}>{modalNavInfo.currentSpeed}</Text>
                  <Text style={styles.statLabel}>km/h</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statBox}>
                  <Text style={styles.statValue}>{modalNavInfo.etaTotal} m</Text>
                  <Text style={styles.statLabel}>overall remaining</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statBox}>
                  <Text style={styles.statValue}>{modalNavInfo.totalRemainingDistance}</Text>
                  <Text style={styles.statLabel}>km left</Text>
                </View>
              </View>
            </View>
          )}

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
  progressSection: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  progressBarBg: { flex: 1, height: 6, backgroundColor: '#E0E0E0', borderRadius: 3, overflow: 'hidden', marginRight: 8 },
  progressBarFill: { height: '100%', backgroundColor: '#34C759', borderRadius: 3 },
  progressPercent: { fontSize: 13, fontWeight: '600', color: '#34C759' },
  stopsList: { gap: 8, marginBottom: 12 },
  stopItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  stopNumber: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#007AFF', justifyContent: 'center', alignItems: 'center' },
  stopNumberText: { color: '#FFF', fontSize: 12, fontWeight: '600' },
  stopInfo: { flex: 1 },
  stopName: { fontSize: 14, fontWeight: '500', color: '#333' },
  stopAddress: { fontSize: 11, color: '#999', marginBottom: 4 },
  stopTime: { fontSize: 11, color: '#666', marginTop: 2 },
  routeMap: { height: 150, borderRadius: 8, overflow: 'hidden', marginBottom: 12 },
  miniMap: { flex: 1 },
  openMapBtn: { backgroundColor: '#F0F8FF', paddingVertical: 12, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#007AFF' },
  openMapBtnText: { color: '#007AFF', fontSize: 15, fontWeight: '700' },
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
  dropdownOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  dropdownContent: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%', padding: 20 },
  dropdownHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  dropdownTitle: { fontSize: 18, fontWeight: '700', color: '#333' },
  dropdownClose: { fontSize: 22, color: '#999', padding: 4 },
  searchInput: { backgroundColor: '#F5F5F5', borderRadius: 10, padding: 12, fontSize: 15, marginBottom: 16 },
  dropdownItem: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#E0E0E0' },
  dropdownItemText: { fontSize: 16, color: '#333' },
  emptySearchText: { textAlign: 'center', color: '#999', marginTop: 20, fontSize: 15 },

  fullscreenContainer: { flex: 1 },
  fullscreenMap: { flex: 1 },
  topNavOverlay: { position: 'absolute', top: 50, left: 16, right: 16, zIndex: 10 },
  navHeaderCard: { backgroundColor: 'rgba(255, 255, 255, 0.95)', borderRadius: 16, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8 },
  navDirectionText: { fontSize: 16, color: '#333', marginBottom: 4, lineHeight: 22 },
  navSubText: { fontSize: 13, color: '#666', marginBottom: 8 },
  etaRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  etaHighlight: { fontSize: 28, fontWeight: '800', color: '#34C759' },
  etaDistance: { fontSize: 16, color: '#666', fontWeight: '500' },
  bottomNavOverlay: { position: 'absolute', bottom: 40, left: 16, right: 16, zIndex: 10 },
  bottomStatsCard: { flexDirection: 'row', backgroundColor: 'rgba(30, 30, 30, 0.9)', borderRadius: 16, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8, alignItems: 'center', justifyContent: 'space-evenly' },
  statBox: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 22, fontWeight: '700', color: '#FFF' },
  statLabel: { fontSize: 11, color: '#AAA', marginTop: 2, textAlign: 'center' },
  statDivider: { width: 1, height: 30, backgroundColor: '#555' },
  closeFullscreenBtn: { position: 'absolute', top: 50, right: 16, backgroundColor: '#FFF', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4, elevation: 4, zIndex: 20 },
  closeFullscreenBtnText: { fontSize: 14, color: '#333', fontWeight: '700' },
});