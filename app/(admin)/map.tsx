import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import MapViewDirections from 'react-native-maps-directions';
import { ref, onValue, off, DataSnapshot } from 'firebase/database';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import firebaseService from '../../src/services/firebase';
import { UserLocation, Trip } from '../../src/types';
import StatusBadge from '../../src/components/StatusBadge';

const { width } = Dimensions.get('window');
const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';

export default function LiveMapScreen() {
  const mapRef = useRef<MapView>(null);
  const [users, setUsers] = useState<{ [key: string]: UserLocation }>({});
  const [trips, setTrips] = useState<any[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<any | null>(null);

  // 1. Listen to live driver locations from Realtime Database
  useEffect(() => {
    const locationsRef = ref(firebaseService.database, 'live-locations');
    const unsubscribe = onValue(locationsRef, (snapshot: DataSnapshot) => {
      setUsers(snapshot.exists() ? snapshot.val() : {});
    });
    return () => off(locationsRef);
  }, []);

  // 2. Listen ONLY to ongoing and planned trips from Firestore
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

        // Keep selected trip data updated in real-time
        if (selectedTrip) {
          const updatedSelected = items.find(i => i.id === selectedTrip.id);
          if (updatedSelected) setSelectedTrip(updatedSelected);
        }
      }
    );
    return () => tripsUnsub();
  }, [selectedTrip]);

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371e3; // meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // returns distance in meters
  };

  const getNavigationInfo = (trip: any) => {
    const driverLoc = users[trip.userId];
    const pendingStops = trip.stops?.filter((s: any) => s.status === 'pending') || [];
    const completedStops = trip.stops?.filter((s: any) => s.status === 'delivered' || s.status === 'completed').length || 0;
    const totalStops = trip.stops?.length || 0;

    if (pendingStops.length === 0) {
      return { status: 'Completed', completedStops, totalStops };
    }

    // Determine starting location (Live driver loc OR first stop loc if planned)
    const startLat = driverLoc?.latitude || trip.stops?.[0]?.latitude || 20.5937;
    const startLon = driverLoc?.longitude || trip.stops?.[0]?.longitude || 78.9629;

    const nextStop = pendingStops[0];
    const distToNext = calculateDistance(startLat, startLon, nextStop.latitude, nextStop.longitude) / 1000;
    
    // Calculate total remaining distance across all pending stops
    const totalRemaining = pendingStops.reduce((sum: number, stop: any, idx: number, arr: any[]) => {
      if (idx === 0) return sum + distToNext;
      const prev = arr[idx - 1];
      return sum + (calculateDistance(prev.latitude, prev.longitude, stop.latitude, stop.longitude) / 1000);
    }, 0);

    const speedKmH = driverLoc?.speed ? Math.round(driverLoc.speed * 3.6) : 0;
    const effectiveSpeed = speedKmH > 5 ? speedKmH : 30; // Use 30km/h as baseline if stationary/slow

    const etaNext = Math.round((distToNext / effectiveSpeed) * 60);
    const etaTotal = Math.round((totalRemaining / effectiveSpeed) * 60);

    return {
      nextStop,
      distToNext: distToNext.toFixed(1),
      totalRemaining: totalRemaining.toFixed(1),
      etaNext,
      etaTotal,
      currentSpeed: speedKmH,
      completedStops,
      totalStops
    };
  };

  const handleRoutePress = (trip: any) => {
    setSelectedTrip(trip);
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
      >
        {trips.map((trip) => {
          const driver = users[trip.userId];
          const isSelected = selectedTrip?.id === trip.id;
          const pendingStops = trip.stops?.filter((s: any) => s.status === 'pending') || [];
          const destinationStop = pendingStops.length > 0 ? pendingStops[pendingStops.length - 1] : null;

          // Only render if we have a destination to draw a route to
          if (!destinationStop) return null;

          const originCoord = driver 
            ? { latitude: driver.latitude, longitude: driver.longitude } 
            : { latitude: trip.stops[0].latitude, longitude: trip.stops[0].longitude };

          return (
            <React.Fragment key={`trip-group-${trip.id}`}>
              {/* Active Driver Marker */}
              {driver && (
                <Marker
                  coordinate={{ latitude: driver.latitude, longitude: driver.longitude }}
                  pinColor="#007AFF"
                  title={driver.displayName}
                  description="Driver Location"
                  onPress={() => handleRoutePress(trip)}
                  style={{ zIndex: isSelected ? 10 : 1 }}
                />
              )}

              {/* Destination Marker */}
              <Marker
                coordinate={{ latitude: destinationStop.latitude, longitude: destinationStop.longitude }}
                pinColor="#FF9500"
                title="Final Destination"
                onPress={() => handleRoutePress(trip)}
              />

              {/* Dynamic Route Line */}
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
                  strokeColor={isSelected ? "#FF3B30" : "#007AFF"}
                  optimizeWaypoints={false}
                  tappable={true}
                  onPress={() => handleRoutePress(trip)}
                />
              ) : (
                // Fallback polyline for planned trips not yet active
                trip.plannedRoute && trip.plannedRoute.length > 0 && (
                  <Polyline
                    coordinates={trip.plannedRoute}
                    strokeColor={isSelected ? "#FF3B30" : "#A1A1AA"}
                    strokeWidth={isSelected ? 6 : 4}
                    tappable={true}
                    onPress={() => handleRoutePress(trip)}
                  />
                )
              )}
            </React.Fragment>
          );
        })}
      </MapView>

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
              if (info.status === 'Completed') return <Text style={styles.noInfoText}>All parties delivered successfully!</Text>;

              return (
                <>
                  <View style={styles.divider} />
                  
                  {/* Next Stop Info */}
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

                  {/* Overall Trip Stats */}
                  <View style={styles.statsGrid}>
                    <View style={styles.statBox}>
                      <Text style={styles.label}>Speed</Text>
                      <Text style={styles.statBoxValue}>{info.currentSpeed}</Text>
                      <Text style={styles.subValueText}>km/h</Text>
                    </View>
                    
                    <View style={styles.statBox}>
                      <Text style={styles.label}>Time Left</Text>
                      <Text style={styles.statBoxValue}>{info.etaTotal}</Text>
                      <Text style={styles.subValueText}>min overall</Text>
                    </View>
                    
                    <View style={styles.statBox}>
                      <Text style={styles.label}>Distance Left</Text>
                      <Text style={styles.statBoxValue}>{info.totalRemaining}</Text>
                      <Text style={styles.subValueText}>km overall</Text>
                    </View>
                  </View>

                  {/* Completed Parties */}
                  <View style={styles.progressRow}>
                    <Text style={styles.label}>Parties Completed:</Text>
                    <Text style={styles.valueText}>
                      {info.completedStops} / {info.totalStops}
                    </Text>
                  </View>
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
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  overlayContainer: {
    position: 'absolute',
    bottom: 30,
    left: 16,
    right: 16,
    zIndex: 10,
  },
  routeInfoCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
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
    paddingRight: 24, // Leave space for close btn
  },
  routeInfoTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#333',
  },
  driverNameText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#555',
    marginBottom: 8,
  },
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
  closeBtnText: {
    fontSize: 16,
    color: '#555',
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: '#E0E0E0',
    marginVertical: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  label: {
    fontSize: 12,
    color: '#888',
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  valueHighlight: {
    fontSize: 20,
    fontWeight: '800',
    color: '#007AFF',
  },
  valueText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
  },
  subValueText: {
    fontSize: 13,
    color: '#666',
    fontWeight: '500',
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#F8F9FA',
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
  statBox: {
    alignItems: 'center',
    flex: 1,
  },
  statBoxValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#333',
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  noInfoText: {
    fontSize: 15,
    color: '#666',
    fontStyle: 'italic',
    marginTop: 10,
  }
});