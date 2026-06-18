import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import MapViewDirections from 'react-native-maps-directions';
import { ref, onValue, off, DataSnapshot } from 'firebase/database';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import firebaseService from '../../src/services/firebase';
import { UserLocation, Trip } from '../../src/types';
import StatusBadge from '../../src/components/StatusBadge';
import PlannedRouteDirections from '../../src/components/PlannedRouteDirections';

const { width } = Dimensions.get('window');
const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';

export default function LiveMapScreen() {
  const mapRef = useRef<MapView>(null);
  const [users, setUsers] = useState<{ [key: string]: UserLocation }>({});
  const [trips, setTrips] = useState<any[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<any | null>(null);
  // Ref to read selectedTrip inside closures without recreating subscriptions
  const selectedTripRef = useRef<any>(null);

  useEffect(() => {
    selectedTripRef.current = selectedTrip;
  }, [selectedTrip]);

  // 1. Listen to live driver locations from Realtime Database — runs once
  useEffect(() => {
    const locationsRef = ref(firebaseService.database, 'live-locations');
    const unsubscribe = onValue(locationsRef, (snapshot: DataSnapshot) => {
      setUsers(snapshot.exists() ? snapshot.val() : {});
    });
    return () => off(locationsRef);
  }, []);

  // 2. Listen to ongoing and planned trips from Firestore — runs once, uses ref for selectedTrip
  useEffect(() => {
    const tripsUnsub = onSnapshot(
      query(
        collection(firebaseService.firestore, 'trips'),
        where('status', 'in', ['in_progress', 'planned'])
      ),
      (snapshot) => {
        const items: any[] = [];
        snapshot.forEach((doc) => {
          items.push({ id: doc.id, ...doc.data() });
        });
        setTrips(items);

        // Keep selected trip data fresh without depending on selectedTrip state
        if (selectedTripRef.current) {
          const updated = items.find(i => i.id === selectedTripRef.current.id);
          if (updated) setSelectedTrip(updated);
        }
      }
    );
    return () => tripsUnsub();
  }, []);

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371e3;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const getNavigationInfo = (trip: any) => {
    const driverLoc = users[trip.userId];
    const pendingStops = trip.stops?.filter((s: any) => s.status === 'pending') || [];
    const completedStops = trip.stops?.filter((s: any) => s.status === 'delivered' || s.status === 'completed').length || 0;
    const totalStops = trip.stops?.length || 0;

    if (pendingStops.length === 0) {
      return { status: 'Completed', completedStops, totalStops };
    }

    const startLat = driverLoc?.latitude || trip.stops?.[0]?.latitude || 20.5937;
    const startLon = driverLoc?.longitude || trip.stops?.[0]?.longitude || 78.9629;

    const nextStop = pendingStops[0];
    const distToNext = calculateDistance(startLat, startLon, nextStop.latitude, nextStop.longitude) / 1000;

    const totalRemaining = pendingStops.reduce((sum: number, stop: any, idx: number, arr: any[]) => {
      if (idx === 0) return sum + distToNext;
      const prev = arr[idx - 1];
      return sum + (calculateDistance(prev.latitude, prev.longitude, stop.latitude, stop.longitude) / 1000);
    }, 0);

    const speedKmH = driverLoc?.speed ? Math.round(driverLoc.speed * 3.6) : 0;
    const effectiveSpeed = speedKmH > 5 ? speedKmH : 30;
    const etaNext = Math.round((distToNext / effectiveSpeed) * 60);
    const etaTotal = Math.round((totalRemaining / effectiveSpeed) * 60);

    const totalLaminates = (trip.stops || []).reduce((sum: number, s: any) => sum + (s.laminateQuantity || 0), 0);
    const deliveredLaminates = (trip.stops || [])
      .filter((s: any) => s.status === 'delivered')
      .reduce((sum: number, s: any) => sum + (s.laminateQuantity || 0), 0);

    return {
      nextStop,
      distToNext: distToNext.toFixed(1),
      totalRemaining: totalRemaining.toFixed(1),
      etaNext,
      etaTotal,
      currentSpeed: speedKmH,
      completedStops,
      totalStops,
      totalLaminates,
      deliveredLaminates,
    };
  };

  const fitAllDrivers = () => {
    const activeDrivers = Object.values(users).filter((u) => u.isActive);
    if (activeDrivers.length === 0 || !mapRef.current) return;
    mapRef.current.fitToCoordinates(
      activeDrivers.map((d) => ({ latitude: d.latitude, longitude: d.longitude })),
      { edgePadding: { top: 80, right: 40, bottom: 80, left: 40 }, animated: true }
    );
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={{
          latitude: 20.5937,
          longitude: 78.9629,
          latitudeDelta: 10,
          longitudeDelta: 10,
        }}
        showsUserLocation
        showsMyLocationButton
        showsTraffic={true}
        showsBuildings={true}
        showsCompass={true}
        showsScale={true}
        loadingEnabled={true}
        pitchEnabled={true}
        rotateEnabled={true}
      >
        {trips.map((trip) => {
          const driver = users[trip.userId];
          const isSelected = selectedTrip?.id === trip.id;
          const pendingStops = trip.stops?.filter((s: any) => s.status === 'pending') || [];
          const destinationStop = pendingStops.length > 0 ? pendingStops[pendingStops.length - 1] : null;

          if (!destinationStop) return null;

          const originCoord = driver
            ? { latitude: driver.latitude, longitude: driver.longitude }
            : { latitude: trip.stops[0].latitude, longitude: trip.stops[0].longitude };

          return (
            <React.Fragment key={`trip-group-${trip.id}`}>
              {/* Active Driver Marker with name callout */}
              {driver && (
                <Marker
                  coordinate={{ latitude: driver.latitude, longitude: driver.longitude }}
                  onPress={() => setSelectedTrip(trip)}
                  zIndex={isSelected ? 10 : 1}
                  tracksViewChanges={false}
                >
                  <View style={[styles.driverMarker, isSelected && styles.driverMarkerSelected]}>
                    <Text style={styles.driverMarkerIcon}>🚚</Text>
                    <Text style={styles.driverMarkerName} numberOfLines={1}>
                      {driver.displayName?.split(' ')[0] || 'Driver'}
                    </Text>
                  </View>
                </Marker>
              )}

              {/* Destination marker */}
              <Marker
                coordinate={{ latitude: destinationStop.latitude, longitude: destinationStop.longitude }}
                pinColor={isSelected ? '#FF3B30' : '#FF9500'}
                title={destinationStop.partyName}
                onPress={() => setSelectedTrip(trip)}
                tracksViewChanges={false}
              />

              {/* Route line */}
              {trip.status === 'in_progress' ? (
                <MapViewDirections
                  origin={originCoord}
                  destination={{ latitude: destinationStop.latitude, longitude: destinationStop.longitude }}
                  waypoints={pendingStops.slice(0, -1).map((s: any) => ({
                    latitude: s.latitude,
                    longitude: s.longitude,
                  }))}
                  apikey={GOOGLE_MAPS_API_KEY}
                  strokeWidth={isSelected ? 6 : 4}
                  strokeColor={isSelected ? '#FF3B30' : '#007AFF'}
                  optimizeWaypoints={false}
                  mode="DRIVING"
                />
              ) : (
                trip.stops && trip.stops.length >= 1 && (
                  <PlannedRouteDirections
                    stops={trip.stops}
                    strokeWidth={isSelected ? 6 : 3}
                    strokeColor={isSelected ? '#FF3B30' : '#A1A1AA'}
                  />
                )
              )}
            </React.Fragment>
          );
        })}
      </MapView>

      {/* Fit all drivers button */}
      <TouchableOpacity style={styles.fitBtn} onPress={fitAllDrivers}>
        <Text style={styles.fitBtnText}>⊙ All</Text>
      </TouchableOpacity>

      {/* Selected Trip Floating Details Overlay */}
      {selectedTrip && (
        <View style={styles.overlayContainer}>
          <View style={styles.routeInfoCard}>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={() => setSelectedTrip(null)}
              hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
            >
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>

            <View style={styles.headerRow}>
              <Text style={styles.routeInfoTitle}>Trip #{selectedTrip.id.slice(-6)}</Text>
              <StatusBadge status={selectedTrip.status} />
            </View>

            <Text style={styles.driverNameText}>
              Driver: {users[selectedTrip.userId]?.displayName || 'Pending Assignment'}
            </Text>

            {(() => {
              const info = getNavigationInfo(selectedTrip);

              if (!info) return <Text style={styles.noInfoText}>Awaiting route start...</Text>;
              if (info.status === 'Completed') return <Text style={styles.noInfoText}>All parties delivered!</Text>;

              return (
                <>
                  <View style={styles.divider} />

                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.label}>Heading To</Text>
                      <Text style={styles.valueHighlight} numberOfLines={1}>
                        {info.nextStop?.partyName || 'Unknown'}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.label}>ETA (Next)</Text>
                      <Text style={styles.valueHighlight}>{info.etaNext} min</Text>
                      <Text style={styles.subValueText}>{info.distToNext} km</Text>
                    </View>
                  </View>

                  <View style={styles.divider} />

                  <View style={styles.statsGrid}>
                    <View style={styles.statBox}>
                      <Text style={styles.label}>Speed</Text>
                      <Text style={styles.statBoxValue}>{info.currentSpeed}</Text>
                      <Text style={styles.subValueText}>km/h</Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text style={styles.label}>ETA Total</Text>
                      <Text style={styles.statBoxValue}>{info.etaTotal}</Text>
                      <Text style={styles.subValueText}>min</Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text style={styles.label}>Km Left</Text>
                      <Text style={styles.statBoxValue}>{info.totalRemaining}</Text>
                      <Text style={styles.subValueText}>km</Text>
                    </View>
                  </View>

                  <View style={styles.progressRow}>
                    <Text style={styles.label}>Parties:</Text>
                    <Text style={styles.valueText}>{info.completedStops}/{info.totalStops}</Text>
                  </View>

                  {(info.totalLaminates ?? 0) > 0 && (
                    <View style={styles.progressRow}>
                      <Text style={styles.label}>Laminates:</Text>
                      <Text style={styles.valueText}>
                        📦 {info.deliveredLaminates}/{info.totalLaminates}
                      </Text>
                    </View>
                  )}
                </>
              );
            })()}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  fitBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: '#FFF',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
    zIndex: 10,
  },
  fitBtnText: { fontSize: 13, fontWeight: '700', color: '#007AFF' },
  driverMarker: {
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
    borderWidth: 2,
    borderColor: '#007AFF',
  },
  driverMarkerSelected: {
    borderColor: '#FF3B30',
    backgroundColor: '#FFF5F5',
  },
  driverMarkerIcon: { fontSize: 18 },
  driverMarkerName: { fontSize: 10, fontWeight: '700', color: '#333', maxWidth: 60 },
  overlayContainer: {
    position: 'absolute',
    bottom: 30,
    left: 16,
    right: 16,
    zIndex: 10,
  },
  routeInfoCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.97)',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
    paddingRight: 28,
  },
  routeInfoTitle: { fontSize: 18, fontWeight: '800', color: '#333' },
  driverNameText: { fontSize: 15, fontWeight: '600', color: '#555', marginBottom: 8 },
  closeBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: '#F0F0F0',
    borderRadius: 15,
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  closeBtnText: { fontSize: 16, color: '#555', fontWeight: '700' },
  divider: { height: 1, backgroundColor: '#E0E0E0', marginVertical: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  label: { fontSize: 11, color: '#888', fontWeight: '600', textTransform: 'uppercase', marginBottom: 2 },
  valueHighlight: { fontSize: 20, fontWeight: '800', color: '#007AFF' },
  valueText: { fontSize: 15, fontWeight: '700', color: '#333' },
  subValueText: { fontSize: 13, color: '#666', fontWeight: '500' },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#F8F9FA',
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
  statBox: { alignItems: 'center', flex: 1 },
  statBoxValue: { fontSize: 22, fontWeight: '800', color: '#333' },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  noInfoText: { fontSize: 15, color: '#666', fontStyle: 'italic', marginTop: 10 },
});
