import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Dimensions,
  ScrollView,
} from 'react-native';
import MapView, { Marker, Callout, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { ref, onValue, off, DataSnapshot } from 'firebase/database';
import { collection, onSnapshot, query, where, Timestamp } from 'firebase/firestore';
import firebaseService from '../../src/services/firebase';
import { UserLocation, Party, PolylinePoint } from '../../src/types';
import StatusBadge from '../../src/components/StatusBadge';

const { width, height } = Dimensions.get('window');

const MARKER_COLORS: Record<string, string> = {
  admin: '#5856D6',
  driver: '#007AFF',
  salesman: '#34C759',
};

export default function LiveMapScreen() {
  const mapRef = useRef<MapView>(null);
  const [users, setUsers] = useState<{ [key: string]: UserLocation }>({});
  const [parties, setParties] = useState<Party[]>([]);
  const [trips, setTrips] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserLocation | null>(null);
  const [selectedParty, setSelectedParty] = useState<Party | null>(null);
  const [selectedTrip, setSelectedTrip] = useState<any>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [showFullscreenMap, setShowFullscreenMap] = useState(false);
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [partyFilter, setPartyFilter] = useState<string | null>(null);

  // Listen to live locations
  useEffect(() => {
    const locationsRef = ref(firebaseService.database, 'live-locations');
    const unsubscribe = onValue(locationsRef, (snapshot: DataSnapshot) => {
      if (snapshot.exists()) {
        setUsers(snapshot.val());
      } else {
        setUsers({});
      }
    });

    return () => off(locationsRef);
  }, []);

  // Listen to parties
  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(firebaseService.firestore, 'parties')),
      (snapshot) => {
        const items: Party[] = [];
        snapshot.forEach((doc) => {
          items.push({ id: doc.id, ...doc.data() } as Party);
        });
        setParties(items);
      }
    );
    return () => unsubscribe();
  }, []);

  // Listen to active trips
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
      }
    );
    return () => tripsUnsub();
  }, []);

  const getFilteredUsers = () => {
    const entries = Object.entries(users);
    if (roleFilter) {
      return entries.filter(([_, u]) => u.role === roleFilter);
    }
    return entries;
  };

  const getFilteredParties = () => {
    if (partyFilter) {
      return parties.filter((p) => p.id === partyFilter);
    }
    return parties;
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getRouteInfo = (trip: any) => {
    if (!trip) return null;
    const distance = trip.totalDistance || 0;
    const covered = trip.distanceCovered || 0;
    const remaining = distance - covered;
    const eta = trip.totalDuration ? Math.round(trip.totalDuration * (100 - (trip.completionPercentage || 0)) / 100) : 0;
    return { distance, covered, remaining, eta };
  };

  const getHeadingDirection = (heading: number) => {
    if (!heading) return 'N/A';
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(heading / 45) % 8;
    return directions[index];
  };

  const calculateBearing = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
              Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
    const bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360;
  };

  const getTurnInfo = (trip: any, user: UserLocation) => {
    if (!trip || !trip.stops || trip.stops.length === 0) return null;
    const nextStop = trip.stops.find((s: any) => s.status === 'pending');
    if (!nextStop) return null;
    
    const distance = calculateDistance(user.latitude, user.longitude, nextStop.latitude, nextStop.longitude);
    return {
      nextStop,
      distance: Math.round(distance),
      bearing: calculateBearing(user.latitude, user.longitude, nextStop.latitude, nextStop.longitude),
    };
  };

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
        {/* Party Markers */}
        {getFilteredParties()
          .filter((p) => p.latitude && p.longitude)
          .map((party) => (
            <Marker
              key={`party-${party.id}`}
              coordinate={{
                latitude: party.latitude,
                longitude: party.longitude,
              }}
              pinColor="#FF9500"
              onPress={() => setSelectedParty(party)}
            >
              <Callout onPress={() => setSelectedParty(party)}>
                <View style={styles.callout}>
                  <Text style={styles.calloutTitle}>{party.name}</Text>
                  <Text style={styles.calloutText}>{party.ownerName}</Text>
                  <Text style={styles.calloutText}>{party.phoneNumber}</Text>
                </View>
              </Callout>
            </Marker>
          ))}

        {/* User Markers with active trip routes */}
        {getFilteredUsers().map(([uid, user]) =>
          user.latitude && user.longitude ? (
            <Marker
              key={`user-${uid}`}
              coordinate={{
                latitude: user.latitude,
                longitude: user.longitude,
              }}
              pinColor={MARKER_COLORS[user.role] || '#007AFF'}
              onPress={() => setSelectedUser(user)}
            >
              <Callout>
                <View style={styles.callout}>
                  <Text style={styles.calloutTitle}>{user.displayName}</Text>
                  <StatusBadge status={user.role} size="small" />
                  {user.speed > 0 && (
                    <Text style={styles.calloutText}>Speed: {Math.round(user.speed * 3.6)} km/h</Text>
                  )}
                  {user.heading && (
                    <Text style={styles.calloutText}>Heading: {getHeadingDirection(user.heading)} ({Math.round(user.heading)}°)</Text>
                  )}
                  <Text style={styles.calloutText}>Updated: {formatTime(user.timestamp)}</Text>
                </View>
              </Callout>
            </Marker>
          ) : null
        )}

        {/* Active Trip Polylines */}
        {trips.map((trip) => 
          trip.plannedRoute && trip.plannedRoute.length > 0 && (
            <Polyline
              key={`route-${trip.id}`}
              coordinates={trip.plannedRoute}
              strokeColor="#007AFF"
              strokeWidth={3}
            />
          )
        )}
      </MapView>

      {/* Filter Button */}
      <TouchableOpacity
        style={styles.filterBtn}
        onPress={() => setShowFilter(true)}
      >
        <Text style={styles.filterBtnText}>
          Filter ▼
        </Text>
      </TouchableOpacity>

      {/* User Count */}
      <View style={styles.userCount}>
        <Text style={styles.userCountText}>
          Active: {Object.values(users).filter((u) => u.isActive).length}
        </Text>
      </View>

      {/* Active Trip Map Button */}
      {trips.filter(t => t.status === 'in_progress').length > 0 && (
        <TouchableOpacity
          style={styles.fullscreenBtn}
          onPress={() => setShowFullscreenMap(true)}
        >
          <Text style={styles.fullscreenBtnText}>🗺️ View Trip Map</Text>
        </TouchableOpacity>
      )}

      {/* User Detail Modal */}
      <Modal visible={!!selectedUser} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          onPress={() => setSelectedUser(null)}
        >
          <View style={styles.userDetailCard}>
            <Text style={styles.userDetailName}>{selectedUser?.displayName}</Text>
            <StatusBadge status={selectedUser?.role || ''} />
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Speed</Text>
              <Text style={styles.detailValue}>
                {Math.round((selectedUser?.speed || 0) * 3.6)} km/h
              </Text>
            </View>
            {selectedUser?.heading && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Heading</Text>
                <Text style={styles.detailValue}>
                  {getHeadingDirection(selectedUser.heading)} ({Math.round(selectedUser.heading)}°)
                </Text>
              </View>
            )}
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Last Updated</Text>
              <Text style={styles.detailValue}>
                {formatTime(selectedUser?.timestamp || 0)}
              </Text>
            </View>
            {selectedUser?.currentTrip && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Current Trip</Text>
                <Text style={styles.detailValue}>{selectedUser.currentTrip}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Party Detail Modal */}
      <Modal visible={!!selectedParty} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          onPress={() => setSelectedParty(null)}
        >
          <View style={styles.userDetailCard}>
            <Text style={styles.userDetailName}>{selectedParty?.name}</Text>
            <StatusBadge status={selectedParty?.category || ''} size="small" />
            <Text style={styles.detailLabel}>{selectedParty?.ownerName}</Text>
            <Text style={styles.detailValue}>{selectedParty?.phoneNumber}</Text>
            {selectedParty?.alternatePhone && (
              <Text style={styles.detailValue}>{selectedParty.alternatePhone}</Text>
            )}
            <Text style={styles.detailValue}>{selectedParty?.address}</Text>
            {selectedParty?.notes && (
              <Text style={styles.detailLabel}>📝 {selectedParty.notes}</Text>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Filter Modal */}
      <Modal visible={showFilter} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          onPress={() => setShowFilter(false)}
        >
          <ScrollView style={styles.filterCard} showsVerticalScrollIndicator={false}>
            <Text style={styles.filterTitle}>Filter Map</Text>
            
            <Text style={styles.filterSectionTitle}>Filter by Role</Text>
            {[null, 'admin', 'driver', 'salesman'].map((role) => (
              <TouchableOpacity
                key={`role-${String(role)}`}
                style={[
                  styles.filterOption,
                  roleFilter === role && styles.filterOptionActive,
                ]}
                onPress={() => {
                  setRoleFilter(role);
                  setShowFilter(false);
                }}
              >
                <Text
                  style={[
                    styles.filterOptionText,
                    roleFilter === role && styles.filterOptionTextActive,
                  ]}
                >
                  {role ? role.charAt(0).toUpperCase() + role.slice(1) : 'All Users'}
                </Text>
              </TouchableOpacity>
            ))}

            <Text style={styles.filterSectionTitle}>Filter by Party</Text>
            <TouchableOpacity
              style={[
                styles.filterOption,
                !partyFilter && styles.filterOptionActive,
              ]}
              onPress={() => {
                setPartyFilter(null);
                setShowFilter(false);
              }}
            >
              <Text style={styles.filterOptionText}>All Parties</Text>
            </TouchableOpacity>
            {parties.map((party) => (
              <TouchableOpacity
                key={`party-${party.id}`}
                style={[
                  styles.filterOption,
                  partyFilter === party.id && styles.filterOptionActive,
                ]}
                onPress={() => {
                  setPartyFilter(party.id);
                  setShowFilter(false);
                }}
              >
                <Text
                  style={[
                    styles.filterOptionText,
                    partyFilter === party.id && styles.filterOptionTextActive,
                  ]}
                >
                  {party.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </TouchableOpacity>
      </Modal>

      {/* Fullscreen Trip Map Modal */}
      <Modal visible={showFullscreenMap} animationType="fade">
        <View style={styles.fullscreenContainer}>
          <MapView
            style={styles.fullscreenMap}
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
            {/* Trip Markers */}
            {trips.filter(t => t.status === 'in_progress').map((trip) => (
              <Marker
                key={`trip-user-${trip.userId}`}
                coordinate={{
                  latitude: trips.find(t => t.userId === trip.userId) ? 
                    users[trip.userId]?.latitude || 20.5937 : 20.5937,
                  longitude: trips.find(t => t.userId === trip.userId) ? 
                    users[trip.userId]?.longitude || 78.9629 : 78.9629,
                }}
                pinColor="#007AFF"
              />
            ))}

            {/* Route Polylines */}
            {trips.filter(t => t.status === 'in_progress').map((trip) => 
              trip.plannedRoute && (
                <Polyline
                  key={`fullscreen-route-${trip.id}`}
                  coordinates={trip.plannedRoute}
                  strokeColor="#007AFF"
                  strokeWidth={4}
                />
              )
            )}

            {/* Stop Markers */}
            {trips.filter(t => t.status === 'in_progress').flatMap((trip) => 
              trip.stops?.map((stop: any, idx: number) => (
                <Marker
                  key={`stop-${trip.id}-${idx}`}
                  coordinate={{
                    latitude: stop.latitude,
                    longitude: stop.longitude,
                  }}
                  pinColor={stop.status === 'departed' ? '#34C759' : '#FF9500'}
                  title={stop.partyName}
                />
              )) || []
            )}
          </MapView>

          {/* Route Info Overlay */}
          <View style={styles.routeInfoOverlay}>
            {trips.filter(t => t.status === 'in_progress').map((trip) => {
              const user = users[trip.userId];
              const routeInfo = getRouteInfo(trip);
              const turnInfo = user ? getTurnInfo(trip, user) : null;
              
              return (
                <View key={`info-${trip.id}`} style={styles.routeInfoCard}>
                  <Text style={styles.routeInfoTitle}>Active Trip</Text>
                  <View style={styles.routeInfoRow}>
                    <Text style={styles.routeInfoLabel}>Total Distance</Text>
                    <Text style={styles.routeInfoValue}>{routeInfo?.distance || 0} km</Text>
                  </View>
                  <View style={styles.routeInfoRow}>
                    <Text style={styles.routeInfoLabel}>Distance Remaining</Text>
                    <Text style={styles.routeInfoValue}>{routeInfo?.remaining || 0} km</Text>
                  </View>
                  <View style={styles.routeInfoRow}>
                    <Text style={styles.routeInfoLabel}>ETA</Text>
                    <Text style={styles.routeInfoValue}>{routeInfo?.eta || 0} min</Text>
                  </View>
                  {turnInfo && (
                    <>
                      <View style={styles.routeInfoRow}>
                        <Text style={styles.routeInfoLabel}>Next Stop</Text>
                        <Text style={styles.routeInfoValue}>{turnInfo.nextStop?.partyName}</Text>
                      </View>
                      <View style={styles.routeInfoRow}>
                        <Text style={styles.routeInfoLabel}>Distance to Next</Text>
                        <Text style={styles.routeInfoValue}>{turnInfo.distance} m</Text>
                      </View>
                      <View style={styles.routeInfoRow}>
                        <Text style={styles.routeInfoLabel}>Turn</Text>
                        <Text style={styles.routeInfoValue}>
                           {turnInfo.bearing ? `Head ${getHeadingDirection(turnInfo.bearing)} after ${turnInfo.distance}m` : 'N/A'}
                        </Text>
                      </View>
                    </>
                  )}
                </View>
              );
            })}
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
  },
  map: {
    flex: 1,
  },
  callout: {
    padding: 8,
    minWidth: 150,
    alignItems: 'flex-start',
  },
  calloutTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  calloutTextWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  calloutText: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  filterBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: '#FFF',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  filterBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  fullscreenBtn: {
    position: 'absolute',
    top: 56,
    right: 16,
    backgroundColor: '#007AFF',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  fullscreenBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFF',
  },
  userCount: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    backgroundColor: '#FFF',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  userCountText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 24,
  },
  userDetailCard: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 20,
    gap: 10,
  },
  userDetailName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#333',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  detailLabel: {
    fontSize: 14,
    color: '#666',
  },
  detailValue: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  filterCard: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 20,
    maxHeight: 400,
  },
  filterTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
    color: '#333',
  },
  filterSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginTop: 12,
    marginBottom: 8,
  },
  filterOption: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 8,
  },
  filterOptionActive: {
    backgroundColor: '#007AFF',
  },
  filterOptionText: {
    fontSize: 16,
    color: '#333',
  },
  filterOptionTextActive: {
    color: '#FFF',
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
    bottom: 20,
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