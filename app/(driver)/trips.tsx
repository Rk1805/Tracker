import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  FlatList,
  Modal,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
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

export default function DriverTrips() {
  const { appUser } = useAuth();
  const [trips, setTrips] = useState<any[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<any>(null);
  const [showFullscreenMap, setShowFullscreenMap] = useState(false);

  useEffect(() => {
    if (!appUser?.uid) return;

    const tripsUnsub = onSnapshot(
      query(
        collection(firebaseService.firestore, 'trips'),
        where('userId', '==', appUser.uid),
        orderBy('createdAt', 'desc')
      ),
      (snapshot) => {
        const items: any[] = [];
        snapshot.forEach((doc) => {
          items.push({ id: doc.id, ...doc.data() });
        });
        setTrips(items);
      }
    );

    return () => tripsUnsub();
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

  const handleStartTrip = async (tripId: string) => {
    try {
      await updateDoc(doc(firebaseService.firestore, 'trips', tripId), {
        status: 'in_progress',
        startedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      await locationService.startTracking('driver');
      Alert.alert('Trip Started', 'Your trip has begun. Navigate to your first stop.');
    } catch (error) {
      console.error('Error starting trip:', error);
    }
  };

  const handleArriveAtStop = async (tripId: string, stopIndex: number) => {
    try {
      const trip = trips.find((t) => t.id === tripId);
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
      const trip = trips.find((t) => t.id === tripId);
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

  const renderTrip = ({ item }: { item: any }) => {
    const isActive = item.status === 'in_progress';
    const isPlanned = item.status === 'planned';

    return (
      <TouchableOpacity
        style={[styles.tripCard, isActive && styles.activeTripCard]}
        onPress={() => { setSelectedTrip(item); setShowFullscreenMap(true); }}
      >
        <View style={styles.tripHeader}>
          <View>
            <Text style={styles.tripDate}>
              {item.date || new Date(item.createdAt?.toMillis() || Date.now()).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </Text>
            <StatusBadge status={item.status} />
          </View>
          {isPlanned && (
            <TouchableOpacity
              style={styles.startBtn}
              onPress={() => handleStartTrip(item.id)}
            >
              <Text style={styles.startBtnText}>Start</Text>
            </TouchableOpacity>
          )}
        </View>

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
          {item.stops?.map((stop: any, index: number) => (
            <View key={index} style={styles.stopItem}>
              <View style={styles.stopNumber}>
                <Text style={styles.stopNumberText}>{index + 1}</Text>
              </View>
              <View style={styles.stopInfo}>
                <Text style={styles.stopName}>{stop.partyName}</Text>
                <Text style={styles.stopAddress}>{stop.address}</Text>
                <StatusBadge status={stop.status} size="small" />
                {stop.arrivalTime && (
                  <Text style={styles.stopTime}>
                    Arrived: {new Date(stop.arrivalTime.toMillis()).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                )}
                {stop.durationSpent && (
                  <Text style={styles.stopTime}>Spent: {stop.durationSpent} min</Text>
                )}
              </View>
              {isActive && stop.status === 'pending' && (
                <TouchableOpacity
                  style={styles.arriveBtn}
                  onPress={() => handleArriveAtStop(item.id, index)}
                >
                  <Text style={styles.arriveBtnText}>Arrive</Text>
                </TouchableOpacity>
              )}
              {isActive && stop.status === 'arrived' && (
                <TouchableOpacity
                  style={styles.departBtn}
                  onPress={() => handleDepartFromStop(item.id, index)}
                >
                  <Text style={styles.departBtnText}>Depart</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>

        {item.plannedRoute && item.plannedRoute.length > 0 && (
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
                  title={stop.partyName}
                  pinColor={stop.status === 'departed' ? '#34C759' : '#007AFF'}
                />
              ))}
            </MapView>
          </View>
        )}

        <View style={styles.tripFooter}>
          <Text style={styles.footerText}>📍 {item.stops?.length || 0} stops</Text>
          <Text style={styles.footerText}>🛣️ {Math.round(item.totalDistance || 0)} km</Text>
          <Text style={styles.footerText}>⏱️ {item.totalDuration || 0} min</Text>
          <Text style={styles.fullscreenHint}>🗺️ Tap for fullscreen map</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const navInfo = selectedTrip ? getNavigationInfo(selectedTrip) : null;

  return (
    <View style={styles.container}>
      <FlatList
        data={trips}
        renderItem={renderTrip}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No trips assigned</Text>
            <Text style={styles.emptySubtext}>Your trips will appear here when assigned by admin</Text>
          </View>
        }
      />

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
            ))}

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
                  <Text style={styles.routeInfoValue}>{navInfo.nextStop?.partyName}</Text>
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
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
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
  activeTripCard: {
    borderWidth: 2,
    borderColor: '#007AFF',
  },
  tripHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  tripDate: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  startBtn: {
    backgroundColor: '#34C759',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
  },
  startBtnText: {
    color: '#FFF',
    fontWeight: '600',
  },
  progressSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  progressBarBg: {
    flex: 1,
    height: 6,
    backgroundColor: '#E0E0E0',
    borderRadius: 3,
    overflow: 'hidden',
    marginRight: 8,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#34C759',
    borderRadius: 3,
  },
  progressPercent: {
    fontSize: 13,
    fontWeight: '600',
    color: '#34C759',
  },
  stopsList: {
    gap: 8,
    marginBottom: 12,
  },
  stopItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stopNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stopNumberText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  stopInfo: {
    flex: 1,
  },
  stopName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  stopAddress: {
    fontSize: 11,
    color: '#999',
    marginBottom: 4,
  },
  stopTime: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
  },
  arriveBtn: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  arriveBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  departBtn: {
    backgroundColor: '#34C759',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  departBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  routeMap: {
    height: 150,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 12,
  },
  miniMap: {
    flex: 1,
  },
  tripFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  footerText: {
    fontSize: 12,
    color: '#666',
  },
  fullscreenHint: {
    fontSize: 11,
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
  emptySubtext: {
    fontSize: 13,
    color: '#999',
    marginTop: 4,
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