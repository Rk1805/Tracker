import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  FlatList,
  Modal,
  Platform,
  TextInput,
  ScrollView,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  collection,
  onSnapshot,
  updateDoc,
  doc,
  query,
  where,
  orderBy,
  Timestamp,
} from 'firebase/firestore';
import firebaseService from '../../src/services/firebase';
import { useAuth } from '../../src/context/AuthContext';
import StatusBadge from '../../src/components/StatusBadge';
import { locationService } from '../../src/services/location';

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

export default function DriverTrips() {
  const { appUser } = useAuth();
  
  const [upcomingTrips, setUpcomingTrips] = useState<any[]>([]);
  const [completedTrips, setCompletedTrips] = useState<any[]>([]);
  const [parties, setParties] = useState<any[]>([]);
  const [tab, setTab] = useState<'upcoming' | 'history'>('upcoming');
  
  const [selectedTrip, setSelectedTrip] = useState<any>(null);
  const [showFullscreenMap, setShowFullscreenMap] = useState(false);
  
  // Expand/Collapse State
  const [expandedTripIds, setExpandedTripIds] = useState<string[]>([]);

  // Filter States
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [filterDate, setFilterDate] = useState<string | null>(null);
  const [filterParty, setFilterParty] = useState<string | null>(null);

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showPartyPicker, setShowPartyPicker] = useState(false);

  useEffect(() => {
    if (!appUser?.uid) return;

    const upcomingUnsub = onSnapshot(
      query(
        collection(firebaseService.firestore, 'trips'),
        where('userId', '==', appUser.uid),
        where('status', 'in', ['planned', 'in_progress']),
        orderBy('createdAt', 'desc')
      ),
      (snapshot) => {
        const items: any[] = [];
        snapshot.forEach((doc) => {
          items.push({ id: doc.id, ...doc.data() });
        });
        setUpcomingTrips(items);
      }
    );

    const completedUnsub = onSnapshot(
      query(
        collection(firebaseService.firestore, 'trips'),
        where('userId', '==', appUser.uid),
        where('status', '==', 'completed'),
        orderBy('completedAt', 'desc')
      ),
      (snapshot) => {
        const items: any[] = [];
        snapshot.forEach((doc) => {
          items.push({ id: doc.id, ...doc.data() });
        });
        setCompletedTrips(items);
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

    return () => {
      upcomingUnsub();
      completedUnsub();
      partiesUnsub();
    };
  }, [appUser?.uid]);

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

  const getNavigationInfo = (trip: any) => {
    if (!trip?.stops?.length) return null;
    const pendingStops = trip.stops.filter((s: any) => s.status === 'pending'); 
    if (!pendingStops.length) return null;

    const nextStop = pendingStops[0];
    const distanceToNext = calculateDistance(
      20.5937, 78.9629,
      nextStop.latitude, nextStop.longitude
    );

    const totalRemaining = pendingStops.slice(1).reduce((sum: number, stop: any, idx: number) => {
      const prev = pendingStops[idx];
      return sum + calculateDistance(prev.latitude, prev.longitude, stop.latitude, stop.longitude);
    }, distanceToNext);

    const etaMinutes = Math.round((totalRemaining / 1000) / 40 * 60);

    return {
      nextStop,
      distanceToNext: Math.round(distanceToNext),
      totalRemainingDistance: Math.round(totalRemaining / 1000),
      eta: etaMinutes,
    };
  };

  const toggleExpandTrip = (tripId: string) => {
    setExpandedTripIds(prev => 
      prev.includes(tripId) 
        ? prev.filter(id => id !== tripId) 
        : [...prev, tripId]
    );
  };

  const handleStartTrip = async (tripId: string) => {
    try {
      await updateDoc(doc(firebaseService.firestore, 'trips', tripId), {
        status: 'in_progress',
        startedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      await locationService.startTracking('driver');
      Alert.alert('Trip Started', 'Your trip has begun. Navigate to your first stop.');
      
      // Auto expand when started
      if (!expandedTripIds.includes(tripId)) toggleExpandTrip(tripId);
    } catch (error) {
      console.error('Error starting trip:', error);
    }
  };

  const handleArriveAtStop = async (tripId: string, stopIndex: number) => {
    try {
      const trip = upcomingTrips.find((t) => t.id === tripId) || completedTrips.find((t) => t.id === tripId);
      if (!trip) return;

      const stops = [...trip.stops];
      stops[stopIndex] = {
        ...stops[stopIndex],
        status: 'arrived',
        arrivalTime: Timestamp.now(),
      };

      await updateDoc(doc(firebaseService.firestore, 'trips', tripId), {
        stops,
        updatedAt: Timestamp.now(),
      });
    } catch (error) {
      console.error('Error updating stop:', error);
    }
  };

  const handleDepartFromStop = async (tripId: string, stopIndex: number) => {
    try {
      const trip = upcomingTrips.find((t) => t.id === tripId) || completedTrips.find((t) => t.id === tripId);
      if (!trip) return;

      const stops = [...trip.stops];
      const departureTime = Timestamp.now();
      const arrivalTime = stops[stopIndex].arrivalTime;
      const durationSpent = arrivalTime
        ? Math.round((departureTime.toMillis() - arrivalTime.toMillis()) / 60000)
        : 0;

      stops[stopIndex] = {
        ...stops[stopIndex],
        status: 'departed',
        departureTime,
        durationSpent,
      };

      const completedStops = stops.filter((s: any) => s.status === 'departed').length;
      const pendingStops = stops.filter((s: any) => s.status === 'pending').length;
      const completionPercentage = Math.round((completedStops / stops.length) * 100);

      const distancePerStop = trip.totalDistance / stops.length;
      const distanceCovered = completedStops * distancePerStop;
      const distanceRemaining = pendingStops * distancePerStop;

      const isComplete = completedStops === stops.length;

      await updateDoc(doc(firebaseService.firestore, 'trips', tripId), {
        stops,
        completedStops,
        pendingStops,
        completionPercentage,
        distanceCovered: Math.round(distanceCovered * 10) / 10,
        distanceRemaining: Math.round(distanceRemaining * 10) / 10,
        status: isComplete ? 'completed' : 'in_progress',
        completedAt: isComplete ? Timestamp.now() : null,
        updatedAt: Timestamp.now(),
      });

      if (isComplete) {
        Alert.alert('Trip Complete', 'You have completed all stops!');
        await locationService.stopTracking();
      }
    } catch (error) {
      console.error('Error updating stop:', error);
    }
  };

  const clearFilters = () => {
    setFilterDate(null);
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

  const renderTrip = ({ item }: { item: any }) => {
    const isActive = item.status === 'in_progress';
    const isPlanned = item.status === 'planned';
    const isHistory = item.status === 'completed';
    const isExpanded = expandedTripIds.includes(item.id) || isActive; // Always expand active trips
    
    const partiesPreview = item.stops?.map((s: any) => s.partyName).join(', ') || 'No parties';

    return (
      <TouchableOpacity
        style={[styles.tripCard, isActive && styles.activeTripCard]}
        onPress={() => toggleExpandTrip(item.id)}
        activeOpacity={0.8}
      >
        <View style={styles.tripHeader}>
          <View style={{ flex: 1 }}>
            <View style={styles.titleRow}>
              <Text style={styles.tripDate}>
                {item.date || new Date(item.createdAt?.toMillis() || Date.now()).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </Text>
              <StatusBadge status={item.status} />
            </View>
            {!isExpanded && (
              <Text style={styles.previewText} numberOfLines={2}>
                <Text style={{ fontWeight: '600' }}>Parties: </Text>
                {partiesPreview}
              </Text>
            )}
          </View>

          {isPlanned && (
            <TouchableOpacity
              style={styles.startBtn}
              onPress={() => handleStartTrip(item.id)}
            >
              <Text style={styles.startBtnText}>Start</Text>
            </TouchableOpacity>
          )}
          
          <Text style={styles.expandIcon}>{isExpanded ? '▲' : '▼'}</Text>
        </View>

        {isExpanded && (
          <View style={styles.expandedContent}>
            {isActive && (
              <View style={styles.progressSection}>
                <View style={styles.progressBarBg}>
                  <View
                    style={[
                      styles.progressBarFill,
                      { width: `${item.completionPercentage || 0}%` },
                    ]}
                  />
                </View>
                <Text style={styles.progressPercent}>{item.completionPercentage || 0}%</Text>
              </View>
            )}

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

                    {isActive && stop.status === "pending" && (
                      <TouchableOpacity
                        style={styles.arriveBtn}
                        onPress={() => handleArriveAtStop(item.id, index)}
                      >
                        <Text style={styles.arriveBtnText}>Arrive</Text>
                      </TouchableOpacity>
                    )}

                    {isActive && stop.status === "arrived" && (
                      <TouchableOpacity
                        style={styles.departBtn}
                        onPress={() => handleDepartFromStop(item.id, index)}
                      >
                        <Text style={styles.departBtnText}>Depart</Text>
                      </TouchableOpacity>
                    )}
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

            <View style={styles.tripFooter}>
              <Text style={styles.footerText}>📍 {item.stops?.length || 0} stops</Text>
              <Text style={styles.footerText}>🛣️ {Math.round(item.totalDistance || 0)} km</Text>
              <Text style={styles.footerText}>⏱️ {item.totalDuration || 0} min</Text>
            </View>
            
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

  const navInfo = selectedTrip ? getNavigationInfo(selectedTrip) : null;

  // Apply filters only for history
  const filteredHistoryTrips = completedTrips.filter((trip) => {
    let matches = true;
    if (filterDate && trip.date !== filterDate) matches = false;
    if (filterParty) {
      const hasParty = trip.stops?.some((stop: any) => stop.partyId === filterParty);
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
              ⚙️ Filters {(filterDate || filterParty) ? '(Active)' : ''}
            </Text>
          </TouchableOpacity>
          {(filterDate || filterParty) ? (
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
              {tab === 'upcoming' ? 'No upcoming trips' : 'No history found'}
            </Text>
          </View>
        }
      />

      {/* HISTORY FILTER MODAL */}
      <Modal visible={showFilterModal} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Filter History</Text>
            <TouchableOpacity onPress={() => setShowFilterModal(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Date Filter */}
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

            {/* Party Filter */}
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

      {/* PARTY PICKER */}
      <SearchablePicker
        visible={showPartyPicker}
        onClose={() => setShowPartyPicker(false)}
        data={parties.map(p => ({ label: p.name || 'Unknown', value: p.id }))}
        onSelect={setFilterParty}
        title="Search Parties"
        placeholder="Type party name..."
      />

      {/* FULLSCREEN MAP MODAL */}
      <Modal visible={showFullscreenMap} animationType="fade">
        <View style={styles.fullscreenContainer}>
          <MapView
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
            {selectedTrip?.stops?.map((stop: any, idx: number) => (
              <Marker
                key={`stop-${selectedTrip.id}-${idx}`}
                coordinate={{
                  latitude: stop.latitude,
                  longitude: stop.longitude,
                }}
                pinColor={stop.status === 'departed' ? '#34C759' : '#FF9500'}
                title={stop.partyName}
              />
            )) || []}

            {selectedTrip?.plannedRoute && (
              <Polyline
                coordinates={selectedTrip.plannedRoute}
                strokeColor="#007AFF"
                strokeWidth={4}
              />
            )}
          </MapView>

          {navInfo && selectedTrip?.status === 'in_progress' && (
            <View style={styles.routeInfoOverlay}>
              <View style={styles.routeInfoCard}>
                <Text style={styles.routeInfoTitle}>Navigation</Text>
                <View style={styles.routeInfoRow}>
                  <Text style={styles.routeInfoLabel}>Next Stop</Text>
                  <Text style={styles.routeInfoValue}>{navInfo.nextStop?.partyName || 'N/A'}</Text>
                </View>
                <View style={styles.routeInfoRow}>
                  <Text style={styles.routeInfoLabel}>Distance to Next</Text>
                  <Text style={styles.routeInfoValue}>{navInfo.distanceToNext} m</Text>
                </View>
                <View style={styles.routeInfoRow}>
                  <Text style={styles.routeInfoLabel}>Total Remaining</Text>
                  <Text style={styles.routeInfoValue}>{navInfo.totalRemainingDistance} km</Text>
                </View>
                <View style={styles.routeInfoRow}>
                  <Text style={styles.routeInfoLabel}>ETA</Text>
                  <Text style={styles.routeInfoValue}>{navInfo.eta} min</Text>
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
  
  tripHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  tripDate: { fontSize: 15, color: '#333', fontWeight: '600' },
  previewText: { fontSize: 13, color: '#666', marginTop: 4, paddingRight: 8 },
  expandIcon: { fontSize: 12, color: '#999', paddingLeft: 8 },
  
  expandedContent: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F0F0F0' },
  
  startBtn: { backgroundColor: '#34C759', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, marginRight: 8 },
  startBtnText: { color: '#FFF', fontWeight: '600', fontSize: 13 },
  
  progressSection: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  progressBarBg: { flex: 1, height: 6, backgroundColor: '#E0E0E0', borderRadius: 3, overflow: 'hidden', marginRight: 8 },
  progressBarFill: { height: '100%', backgroundColor: '#34C759', borderRadius: 3 },
  progressPercent: { fontSize: 13, fontWeight: '600', color: '#34C759' },
  
  stopsList: { gap: 8, marginBottom: 12 },
  stopItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stopNumber: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#007AFF', justifyContent: 'center', alignItems: 'center' },
  stopNumberText: { color: '#FFF', fontSize: 12, fontWeight: '600' },
  stopInfo: { flex: 1 },
  stopName: { fontSize: 14, fontWeight: '500', color: '#333' },
  stopAddress: { fontSize: 11, color: '#999', marginBottom: 4 },
  stopTime: { fontSize: 11, color: '#666', marginTop: 2 },
  
  arriveBtn: { backgroundColor: '#007AFF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  arriveBtnText: { color: '#FFF', fontSize: 12, fontWeight: '600' },
  departBtn: { backgroundColor: '#34C759', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  departBtnText: { color: '#FFF', fontSize: 12, fontWeight: '600' },
  
  routeMap: { height: 150, borderRadius: 8, overflow: 'hidden', marginBottom: 12 },
  miniMap: { flex: 1 },
  
  tripFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTopWidth: 1, borderTopColor: '#E0E0E0', marginBottom: 12 },
  footerText: { fontSize: 13, color: '#666', fontWeight: '500' },
  
  openMapBtn: { backgroundColor: '#F0F8FF', paddingVertical: 10, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#007AFF' },
  openMapBtnText: { color: '#007AFF', fontSize: 14, fontWeight: '600' },

  emptyState: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: 16, color: '#999' },
  
  modal: { flex: 1, backgroundColor: '#F5F5F5', padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  modalTitle: { fontSize: 22, fontWeight: '700', color: '#333' },
  modalClose: { fontSize: 24, color: '#999', padding: 8 },
  label: { fontSize: 14, fontWeight: '600', color: '#666', marginBottom: 8, marginTop: 16 },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  dropdownSelector: { flex: 1, backgroundColor: '#FFF', padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#E0E0E0', justifyContent: 'center' },
  dropdownSelectorText: { fontSize: 15, color: '#333' },
  inlineClearBtn: { backgroundColor: '#FFEBEB', padding: 12, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  clearIcon: { fontSize: 16, color: '#F44336', fontWeight: 'bold' },
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
  routeInfoOverlay: { position: 'absolute', bottom: 100, left: 16, right: 16 },
  routeInfoCard: { backgroundColor: '#FFF', borderRadius: 12, padding: 16, gap: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 6 },
  routeInfoTitle: { fontSize: 16, fontWeight: '700', color: '#333', marginBottom: 4 },
  routeInfoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  routeInfoLabel: { fontSize: 14, color: '#666' },
  routeInfoValue: { fontSize: 14, color: '#333', fontWeight: '500' },
  closeFullscreenBtn: { position: 'absolute', top: 40, right: 16, backgroundColor: '#FFF', borderRadius: 20, width: 40, height: 40, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4, elevation: 4 },
  closeFullscreenBtnText: { fontSize: 18, color: '#333', fontWeight: '600' },
});