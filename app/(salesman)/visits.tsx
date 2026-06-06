import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  FlatList,
  Modal,
} from 'react-native';
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  query,
  where,
  orderBy,
  Timestamp,
} from 'firebase/firestore';
import firebaseService from '../../src/services/firebase';
import { useAuth } from '../../src/context/AuthContext';
import { routeService } from '../../src/services/routes';
import { Party, TripStop, VisitOutcome } from '../../src/types';
import StatusBadge from '../../src/components/StatusBadge';
import { locationService } from '../../src/services/location';

const OUTCOMES: VisitOutcome[] = [
  'interested',
  'follow_up',
  'existing_customer',
  'new_lead',
  'not_interested',
];

export default function SalesmanVisits() {
  const { appUser } = useAuth();
  const [trips, setTrips] = useState<any[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedParties, setSelectedParties] = useState<string[]>([]);
  const [activeTrip, setActiveTrip] = useState<any>(null);
  const [showVisitModal, setShowVisitModal] = useState(false);
  const [selectedStop, setSelectedStop] = useState<any>(null);
  const [visitOutcome, setVisitOutcome] = useState<VisitOutcome>('interested');
  const [visitNotes, setVisitNotes] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');

  useEffect(() => {
    if (!appUser?.uid) return;

    // Load trips for this salesman
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
        const active = items.find((t) => t.status === 'in_progress');
        setActiveTrip(active || null);
      }
    );

    // Load parties
    const partiesUnsub = onSnapshot(
      collection(firebaseService.firestore, 'parties'),
      (snapshot) => {
        const items: Party[] = [];
        snapshot.forEach((doc) => {
          items.push({ id: doc.id, ...doc.data() } as Party);
        });
        setParties(items);
      }
    );

    return () => {
      tripsUnsub();
      partiesUnsub();
    };
  }, [appUser?.uid]);

  const handleCreateTrip = async () => {
    if (selectedParties.length === 0) {
      Alert.alert('Error', 'Select at least one party');
      return;
    }

    const currentLocation = await locationService.getCurrentPosition();
    const origin = currentLocation
      ? {
          latitude: currentLocation.coords.latitude,
          longitude: currentLocation.coords.longitude,
        }
      : { latitude: 20.5937, longitude: 78.9629 };

    const stops = selectedParties.map((id) => {
      const party = parties.find((p) => p.id === id)!;
      return { latitude: party.latitude, longitude: party.longitude, id: party.id };
    });

    try {
      const optimized = await routeService.calculateOptimizedRoute(origin, stops);

      const tripStops: TripStop[] = optimized.waypoints.map((partyId, index) => {
        const party = parties.find((p) => p.id === partyId)!;
        return {
          partyId: party.id,
          partyName: party.name,
          address: party.address,
          latitude: party.latitude,
          longitude: party.longitude,
          order: index + 1,
          status: 'pending',
        };
      });

      await addDoc(collection(firebaseService.firestore, 'trips'), {
        userId: appUser?.uid,
        userRole: 'salesman',
        date: new Date().toISOString().split('T')[0],
        status: 'planned',
        stops: tripStops,
        optimizedOrder: optimized.waypoints,
        originalOrder: selectedParties,
        totalDistance: optimized.totalDistance,
        totalDuration: optimized.totalDuration,
        distanceCovered: 0,
        distanceRemaining: optimized.totalDistance,
        completedStops: 0,
        pendingStops: tripStops.length,
        completionPercentage: 0,
        plannedRoute: optimized.polyline,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });

      setShowCreateModal(false);
      setSelectedParties([]);
      Alert.alert('Success', 'Visit plan created');
    } catch (error) {
      console.error('Error creating visit plan:', error);
      Alert.alert('Error', 'Failed to create visit plan');
    }
  };

  const handleStartTrip = async (tripId: string) => {
    try {
      await updateDoc(doc(firebaseService.firestore, 'trips', tripId), {
        status: 'in_progress',
        startedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      await locationService.startTracking('salesman');
      Alert.alert('Trip Started', 'Your visit plan has started');
    } catch (error) {
      console.error('Error starting trip:', error);
    }
  };

  const handleArrive = async (stop: any, stopIndex: number) => {
    setSelectedStop({ ...stop, index: stopIndex });
    setVisitOutcome('interested');
    setVisitNotes('');
    setFollowUpDate('');
    setShowVisitModal(true);
  };

  const handleSubmitVisit = async () => {
    if (!activeTrip || !selectedStop) return;

    try {
      const stops = [...activeTrip.stops];
      const departureTime = Timestamp.now();
      const arrivalTime = Timestamp.now();
      const durationSpent = 0; // In production, track actual arrival time

      stops[selectedStop.index] = {
        ...stops[selectedStop.index],
        status: 'departed',
        arrivalTime,
        departureTime,
        durationSpent,
        visitOutcome,
        visitNotes,
        followUpDate: followUpDate ? Timestamp.fromDate(new Date(followUpDate)) : undefined,
      };

      const completedStops = stops.filter((s: any) => s.status === 'departed').length;
      const completionPercentage = Math.round((completedStops / stops.length) * 100);
      const isComplete = completedStops === stops.length;

      await updateDoc(doc(firebaseService.firestore, 'trips', activeTrip.id), {
        stops,
        completedStops,
        pendingStops: stops.filter((s: any) => s.status === 'pending').length,
        completionPercentage,
        status: isComplete ? 'completed' : 'in_progress',
        completedAt: isComplete ? Timestamp.now() : null,
        updatedAt: Timestamp.now(),
      });

      setShowVisitModal(false);
      setSelectedStop(null);

      if (isComplete) {
        Alert.alert('All Visits Completed', 'You have completed all visits!');
        await locationService.stopTracking();
      }
    } catch (error) {
      console.error('Error submitting visit:', error);
      Alert.alert('Error', 'Failed to submit visit');
    }
  };

  const handleCreateLeadFromVisit = async () => {
    if (!selectedStop) return;

    try {
      const party = parties.find((p) => p.id === selectedStop.partyId);
      if (party) {
        await addDoc(collection(firebaseService.firestore, 'leads'), {
          name: party.name,
          phone: party.phoneNumber,
          address: party.address,
          latitude: party.latitude,
          longitude: party.longitude,
          notes: visitNotes || `Visit outcome: ${visitOutcome}`,
          createdBy: appUser?.uid,
          createdAt: Timestamp.now(),
          status: 'pending',
        });

        Alert.alert('Success', 'Lead created from this visit');
      }
    } catch (error) {
      console.error('Error creating lead:', error);
    }
  };

  const renderTrip = ({ item }: { item: any }) => {
    const isPlanned = item.status === 'planned';
    const isActive = item.status === 'in_progress';

    return (
      <View style={[styles.tripCard, isActive && styles.activeCard]}>
        <View style={styles.tripHeader}>
          <View>
            <Text style={styles.tripDate}>
              {new Date(item.createdAt?.toMillis() || Date.now()).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
              })}
            </Text>
            <StatusBadge status={item.status} />
          </View>
          {isPlanned && (
            <TouchableOpacity style={styles.startBtn} onPress={() => handleStartTrip(item.id)}>
              <Text style={styles.startBtnText}>Start</Text>
            </TouchableOpacity>
          )}
        </View>

        {isActive && (
          <View style={styles.progressSection}>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${item.completionPercentage}%` }]} />
            </View>
            <Text style={styles.progressText}>{item.completionPercentage}%</Text>
          </View>
        )}

        {item.stops?.map((stop: any, index: number) => (
          <View key={index} style={styles.stopItem}>
            <View style={styles.stopNumber}>
              <Text style={styles.stopNumberText}>{index + 1}</Text>
            </View>
            <View style={styles.stopInfo}>
              <Text style={styles.stopName}>{stop.partyName}</Text>
              <StatusBadge status={stop.status} size="small" />
              {stop.visitOutcome && (
                <Text style={styles.visitOutcomeText}>Outcome: {stop.visitOutcome.replace(/_/g, ' ')}</Text>
              )}
              {stop.durationSpent && (
                <Text style={styles.visitOutcomeText}>Duration: {stop.durationSpent} min</Text>
              )}
            </View>
            {isActive && stop.status === 'pending' && (
              <TouchableOpacity style={styles.visitBtn} onPress={() => handleArrive(stop, index)}>
                <Text style={styles.visitBtnText}>Visit</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}

        <View style={styles.tripFooter}>
          <Text>📍 {item.stops?.length || 0} stops</Text>
          <Text>🛣️ {item.totalDistance || 0} km</Text>
          <Text>✓ {item.completedStops || 0} done</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {!activeTrip && (
        <TouchableOpacity style={styles.createBtn} onPress={() => setShowCreateModal(true)}>
          <Text style={styles.createBtnText}>+ Plan New Visits</Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={trips}
        renderItem={renderTrip}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No visit plans yet</Text>
            <Text style={styles.emptySubtext}>Plan your visits to parties</Text>
          </View>
        }
      />

      {/* Create Trip Modal */}
      {showCreateModal && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Plan Visits</Text>
              <TouchableOpacity onPress={() => setShowCreateModal(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>Select parties to visit ({selectedParties.length})</Text>
            <FlatList
              data={parties}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.partyItem, selectedParties.includes(item.id) && styles.partyItemSelected]}
                  onPress={() => setSelectedParties((prev) =>
                    prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id]
                  )}
                >
                  <Text style={styles.partyName}>{item.name}</Text>
                  <Text style={styles.partyAddress}>{item.address}</Text>
                  <View style={[styles.checkbox, selectedParties.includes(item.id) && styles.checkboxChecked]}>
                    {selectedParties.includes(item.id) && <Text style={styles.checkMark}>✓</Text>}
                  </View>
                </TouchableOpacity>
              )}
              keyExtractor={(item) => item.id}
              style={{ maxHeight: 300 }}
            />
            <TouchableOpacity
              style={[styles.createTripBtn, selectedParties.length === 0 && { opacity: 0.5 }]}
              onPress={handleCreateTrip}
              disabled={selectedParties.length === 0}
            >
              <Text style={styles.createTripBtnText}>Plan Visits ({selectedParties.length})</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Visit Outcome Modal */}
      <Modal visible={showVisitModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.visitModal}>
            <Text style={styles.modalTitle}>
              Visit: {selectedStop?.partyName}
            </Text>

            <Text style={styles.label}>Outcome</Text>
            <View style={styles.outcomeRow}>
              {OUTCOMES.map((outcome) => (
                <TouchableOpacity
                  key={outcome}
                  style={[styles.outcomeChip, visitOutcome === outcome && styles.outcomeChipActive]}
                  onPress={() => setVisitOutcome(outcome)}
                >
                  <Text style={[styles.outcomeText, visitOutcome === outcome && styles.outcomeTextActive]}>
                    {outcome.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={styles.notesInput}
              placeholder="Visit notes..."
              value={visitNotes}
              onChangeText={setVisitNotes}
              multiline
            />

            <TextInput
              style={styles.input}
              placeholder="Follow-up date (YYYY-MM-DD)"
              value={followUpDate}
              onChangeText={setFollowUpDate}
            />

            <View style={styles.visitActions}>
              <TouchableOpacity style={styles.submitVisitBtn} onPress={handleSubmitVisit}>
                <Text style={styles.submitBtnText}>Submit Visit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.createLeadBtn} onPress={handleCreateLeadFromVisit}>
                <Text style={styles.createLeadBtnText}>+ Create Lead</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowVisitModal(false)}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  createBtn: { backgroundColor: '#007AFF', margin: 12, padding: 16, borderRadius: 12, alignItems: 'center' },
  createBtnText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  list: { padding: 12, gap: 12 },
  tripCard: { backgroundColor: '#FFF', borderRadius: 12, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
  activeCard: { borderWidth: 2, borderColor: '#34C759' },
  tripHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  tripDate: { fontSize: 14, color: '#666', marginBottom: 4 },
  startBtn: { backgroundColor: '#34C759', paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8 },
  startBtnText: { color: '#FFF', fontWeight: '600' },
  progressSection: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  progressBarBg: { flex: 1, height: 6, backgroundColor: '#E0E0E0', borderRadius: 3, overflow: 'hidden', marginRight: 8 },
  progressBarFill: { height: '100%', backgroundColor: '#34C759', borderRadius: 3 },
  progressText: { fontSize: 13, fontWeight: '600', color: '#34C759' },
  stopItem: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  stopNumber: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#34C759', justifyContent: 'center', alignItems: 'center' },
  stopNumberText: { color: '#FFF', fontSize: 12, fontWeight: '600' },
  stopInfo: { flex: 1 },
  stopName: { fontSize: 14, fontWeight: '500', color: '#333' },
  visitOutcomeText: { fontSize: 11, color: '#666', marginTop: 2 },
  visitBtn: { backgroundColor: '#34C759', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  visitBtnText: { color: '#FFF', fontSize: 12, fontWeight: '600' },
  tripFooter: { flexDirection: 'row', justifyContent: 'space-around', paddingTop: 8, borderTopWidth: 1, borderTopColor: '#E0E0E0' },
  emptyState: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: 16, color: '#999' },
  emptySubtext: { fontSize: 13, color: '#999', marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#333' },
  modalClose: { fontSize: 24, color: '#999', padding: 8 },
  modalSubtitle: { fontSize: 14, color: '#666', marginBottom: 16 },
  partyItem: { flexDirection: 'row', alignItems: 'center', padding: 14, borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 10, marginBottom: 8 },
  partyItemSelected: { borderColor: '#34C759', backgroundColor: '#F0FFF4' },
  partyName: { fontSize: 15, fontWeight: '500', color: '#333', flex: 1 },
  partyAddress: { fontSize: 12, color: '#999', flex: 1 },
  checkbox: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#CCC', justifyContent: 'center', alignItems: 'center' },
  checkboxChecked: { backgroundColor: '#34C759', borderColor: '#34C759' },
  checkMark: { color: '#FFF', fontWeight: '700' },
  createTripBtn: { backgroundColor: '#34C759', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  createTripBtnText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  visitModal: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '80%' },
  label: { fontSize: 14, fontWeight: '600', color: '#666', marginBottom: 8, marginTop: 16 },
  outcomeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  outcomeChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E0E0E0' },
  outcomeChipActive: { backgroundColor: '#34C759', borderColor: '#34C759' },
  outcomeText: { fontSize: 12, color: '#666' },
  outcomeTextActive: { color: '#FFF' },
  notesInput: { backgroundColor: '#FFF', borderRadius: 10, padding: 14, fontSize: 15, borderWidth: 1, borderColor: '#E0E0E0', marginBottom: 12, height: 80, textAlignVertical: 'top' },
  input: { backgroundColor: '#FFF', borderRadius: 10, padding: 14, fontSize: 15, borderWidth: 1, borderColor: '#E0E0E0', marginBottom: 12 },
  visitActions: { gap: 8, marginBottom: 12 },
  submitVisitBtn: { backgroundColor: '#34C759', padding: 14, borderRadius: 10, alignItems: 'center' },
  submitBtnText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  createLeadBtn: { backgroundColor: '#FFF', padding: 14, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: '#007AFF' },
  createLeadBtnText: { color: '#007AFF', fontSize: 16, fontWeight: '600' },
  cancelBtn: { alignItems: 'center', padding: 14 },
  cancelBtnText: { color: '#999', fontSize: 14 },
});