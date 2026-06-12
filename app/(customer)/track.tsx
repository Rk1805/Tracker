import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import MapViewDirections from 'react-native-maps-directions';
import { doc, onSnapshot, query, where, collection } from 'firebase/firestore';
import firebaseService from '../../src/services/firebase';
import { trackingService } from '../../src/services/tracking';
import { DeliveryTracking, Party } from '../../src/types';
import { useAuth } from '../../src/context/AuthContext';

export default function CustomerTrackScreen() {
  const { appUser } = useAuth();
  const [trackingId, setTrackingId] = useState('');
  const [isTracking, setIsTracking] = useState(false);
  const [trackingData, setTrackingData] = useState<DeliveryTracking | null>(null);
  const [partyData, setPartyData] = useState<Party | null>(null);
  const [etaMinutes, setEtaMinutes] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const mapRef = useRef<MapView>(null);
  const etaInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

  const calculateETA = useCallback(async (driverLat: number, driverLon: number, partyLat: number, partyLon: number) => {
    if (!GOOGLE_MAPS_API_KEY) return null;
    
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/directions/json?origin=${driverLat},${driverLon}&destination=${partyLat},${partyLon}&key=${GOOGLE_MAPS_API_KEY}`
      );
      const data = await response.json();
      if (data.routes?.[0]?.legs?.[0]) {
        return Math.round(data.routes[0].legs[0].duration.value / 60);
      }
    } catch (error) {
      console.error('ETA calculation error:', error);
    }
    return null;
  }, [GOOGLE_MAPS_API_KEY]);

  // Auto-fetch active tracking for logged-in customers
  useEffect(() => {
    if (!appUser?.uid || isTracking) return;

    // Get parties for this customer
    const partiesUnsub = onSnapshot(
      query(
        collection(firebaseService.firestore, 'parties'),
        where('customerUserId', '==', appUser.uid)
      ),
      (partiesSnap) => {
        const partyIds = partiesSnap.docs.map((d) => d.id);
        if (partyIds.length === 0) return;

        // Find active tracking for this customer's parties
        const trackingUnsub = onSnapshot(
          query(
            collection(firebaseService.firestore, 'delivery-tracking'),
            where('partyId', 'in', partyIds),
            where('trackingEnabled', '==', true)
          ),
          (trackingSnap) => {
              if (!trackingSnap.empty) {
              const docSnapshot = trackingSnap.docs[0];
              const docData = docSnapshot.data() as DeliveryTracking;
              const data = { ...docData, id: docSnapshot.id };
              setTrackingData(data);
              setIsTracking(true);
              setTrackingId(data.trackingId);
              
              // Get party data
              if (data.partyId) {
                const partyRef = doc(firebaseService.firestore, 'parties', data.partyId);
                onSnapshot(partyRef, (partySnap) => {
                  if (partySnap.exists()) {
                    const partyDocData = partySnap.data() as Party;
                    setPartyData({ ...partyDocData, id: partySnap.id });
                  }
                });
              }
            }
          }
        );

        return () => trackingUnsub();
      }
    );

    return () => partiesUnsub();
  }, [appUser?.uid, isTracking]);

  const startTracking = async () => {
    if (!trackingId.trim()) {
      Alert.alert('Error', 'Please enter a tracking ID');
      return;
    }

    setLoading(true);
    try {
      const data = await trackingService.getTrackingById(trackingId);
      if (!data) {
        Alert.alert('Error', 'Invalid tracking ID or tracking not found');
        setLoading(false);
        return;
      }

      setTrackingData(data);
      setIsTracking(true);
      
      const partySnap = await firebaseService.queryDocuments('parties', [{ field: 'id', operator: '==', value: data.partyId }]);
      if (partySnap.docs.length > 0) {
        const partyDoc = partySnap.docs[0];
        const partyDocData = partyDoc.data() as Party;
        setPartyData({ ...partyDocData, id: partyDoc.id });
      }
    } catch (error) {
      console.error('Tracking error:', error);
      Alert.alert('Error', 'Failed to start tracking');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isTracking || !trackingId || !trackingData) return;

    const unsub = trackingService.subscribeToTracking(trackingId, (data) => {
      if (data) {
        setTrackingData(data);
      }
    });

    const partyUnsub = partyData?.id
      ? onSnapshot(doc(firebaseService.firestore, 'parties', partyData.id), (snap) => {
          if (snap.exists()) {
            const snapData = snap.data() as Party;
            setPartyData({ ...snapData, id: snap.id });
          }
        })
      : () => {};

    return () => {
      unsub();
      partyUnsub();
    };
  }, [isTracking, trackingId, trackingData]);

  useEffect(() => {
    if (!isTracking || !trackingData?.trackingEnabled || trackingData?.status === 'delivered') {
      if (etaInterval.current) {
        clearInterval(etaInterval.current);
        etaInterval.current = null;
      }
      return;
    }

    const updateETA = async () => {
      if (trackingData?.currentDriverLatitude && trackingData?.currentDriverLongitude && partyData?.latitude && partyData?.longitude) {
        const eta = await calculateETA(
          trackingData.currentDriverLatitude,
          trackingData.currentDriverLongitude,
          partyData.latitude,
          partyData.longitude
        );
        setEtaMinutes(eta);
      }
    };

    updateETA();
    etaInterval.current = setInterval(updateETA, 15000);

    return () => {
      if (etaInterval.current) {
        clearInterval(etaInterval.current);
        etaInterval.current = null;
      }
    };
  }, [isTracking, trackingData, partyData, calculateETA]);

  const getStatusDisplay = (): { text: string; color: string } => {
    if (!trackingData) return { text: 'Unknown', color: '#666' };
    
    switch (trackingData.status) {
      case 'waiting':
        return { text: 'Waiting For Dispatch', color: '#FF9500' };
      case 'out_for_delivery':
        return { text: 'Out For Delivery', color: '#007AFF' };
      case 'delivered':
        return { text: 'Delivered', color: '#34C759' };
      default:
        return { text: 'Unknown', color: '#666' };
    }
  };

  const renderMap = () => {
    if (!trackingData || !partyData) return null;

    const driverCoords = trackingData.currentDriverLatitude && trackingData.currentDriverLongitude
      ? { latitude: trackingData.currentDriverLatitude, longitude: trackingData.currentDriverLongitude }
      : null;

    const partyCoords = partyData?.latitude && partyData?.longitude
      ? { latitude: partyData.latitude, longitude: partyData.longitude }
      : null;

    if (trackingData.status === 'delivered') {
      return (
        <View style={styles.deliveredContainer}>
          <Text style={styles.deliveredIcon}>✅</Text>
          <Text style={styles.deliveredText}>Delivered Successfully</Text>
          <Text style={styles.thankYouText}>Thank you for your order!</Text>
        </View>
      );
    }

    if (!driverCoords || !partyCoords) {
      return (
        <View style={styles.noLocationContainer}>
          <Text style={styles.noLocationText}>Driver location not available yet</Text>
        </View>
      );
    }

    return (
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={{
          latitude: partyCoords.latitude,
          longitude: partyCoords.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
      >
        <Marker coordinate={partyCoords} title="Your Location">
          <View style={styles.destinationMarker}>
            <Text style={styles.destinationMarkerText}>📍</Text>
          </View>
        </Marker>

        {driverCoords && (
          <Marker
            coordinate={driverCoords}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <Image source={require('../../assets/images/auto.png')} style={{ width: 40, height: 40 }} />
          </Marker>
        )}

        {driverCoords && partyCoords && GOOGLE_MAPS_API_KEY && (
          <MapViewDirections
            origin={driverCoords}
            destination={partyCoords}
            apikey={GOOGLE_MAPS_API_KEY}
            strokeWidth={5}
            strokeColor="#007AFF"
            mode="DRIVING"
          />
        )}
      </MapView>
    );
  };

  if (!isTracking) {
    return (
      <View style={styles.container}>
        <View style={styles.inputContainer}>
          {appUser ? (
            <Text style={styles.title}>Your Deliveries</Text>
          ) : (
            <Text style={styles.title}>Track Your Delivery</Text>
          )}
          <Text style={styles.subtitle}>
            {appUser 
              ? 'Your active deliveries will appear here automatically'
              : 'Enter your tracking ID to see live status'
            }
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Enter Tracking ID (e.g., TRK-9A7XK2)"
            placeholderTextColor="#999"
            value={trackingId}
            onChangeText={setTrackingId}
            autoCapitalize="characters"
          />
          <TouchableOpacity
            style={styles.trackButton}
            onPress={startTracking}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.trackButtonText}>Track Delivery</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const statusDisplay = getStatusDisplay();

  return (
    <View style={styles.container}>
      <View style={styles.statusCard}>
        <Text style={styles.statusLabel}>Delivery Status</Text>
        <Text style={[styles.statusValue, { color: statusDisplay.color }]}>
          {statusDisplay.text}
        </Text>
      </View>

      {trackingData?.trackingEnabled && trackingData?.status !== 'delivered' && (
        <View style={styles.etaCard}>
          <Text style={styles.etaLabel}>Estimated Arrival</Text>
          <Text style={styles.etaValue}>
            {etaMinutes !== null ? `${etaMinutes} mins` : 'Calculating...'}
          </Text>
        </View>
      )}

      <View style={styles.mapContainer}>{renderMap()}</View>

      <TouchableOpacity
        style={styles.newTrackButton}
        onPress={() => {
          setIsTracking(false);
          setTrackingData(null);
          setPartyData(null);
          setTrackingId('');
        }}
      >
        <Text style={styles.newTrackButtonText}>Track Another Delivery</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  inputContainer: { flex: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 28, fontWeight: '700', color: '#333', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#666', textAlign: 'center', marginBottom: 32 },
  input: { backgroundColor: '#FFF', borderRadius: 12, padding: 16, fontSize: 16, borderWidth: 1, borderColor: '#E0E0E0', marginBottom: 16 },
  trackButton: { backgroundColor: '#007AFF', paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  trackButtonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  statusCard: { backgroundColor: '#FFF', margin: 16, padding: 20, borderRadius: 12, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  statusLabel: { fontSize: 14, color: '#666', marginBottom: 8 },
  statusValue: { fontSize: 24, fontWeight: '700' },
  etaCard: { backgroundColor: '#FFF', marginHorizontal: 16, marginBottom: 16, padding: 20, borderRadius: 12, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  etaLabel: { fontSize: 14, color: '#666', marginBottom: 8 },
  etaValue: { fontSize: 28, fontWeight: '700', color: '#007AFF' },
  mapContainer: { flex: 1, marginHorizontal: 16, marginBottom: 16, borderRadius: 12, overflow: 'hidden' },
  map: { flex: 1 },
  deliveredContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF', margin: 16, borderRadius: 12 },
  deliveredIcon: { fontSize: 64, marginBottom: 16 },
  deliveredText: { fontSize: 24, fontWeight: '700', color: '#34C759', marginBottom: 8 },
  thankYouText: { fontSize: 16, color: '#666' },
  noLocationContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF', margin: 16, borderRadius: 12 },
  noLocationText: { fontSize: 16, color: '#999' },
  newTrackButton: { backgroundColor: '#FFF', margin: 16, paddingVertical: 16, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#007AFF' },
  newTrackButtonText: { color: '#007AFF', fontSize: 16, fontWeight: '600' },
  destinationMarker: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  destinationMarkerText: { fontSize: 32 },
});