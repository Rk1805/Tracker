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
} from 'react-native';
import {
  collection,
  onSnapshot,
  addDoc,
  query,
  where,
  orderBy,
  Timestamp,
} from 'firebase/firestore';
import firebaseService from '../../src/services/firebase';
import { useAuth } from '../../src/context/AuthContext';
import { Lead } from '../../src/types';
import StatusBadge from '../../src/components/StatusBadge';

export default function SalesmanLeads() {
  const { appUser } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [newLead, setNewLead] = useState({
    name: '',
    phone: '',
    address: '',
    notes: '',
  });

  useEffect(() => {
    if (!appUser?.uid) return;

    let q = query(
      collection(firebaseService.firestore, 'leads'),
      where('createdBy', '==', appUser.uid),
      orderBy('createdAt', 'desc')
    );

    if (statusFilter) {
      q = query(q, where('status', '==', statusFilter));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items: Lead[] = [];
      snapshot.forEach((doc) => {
        items.push({ id: doc.id, ...doc.data() } as Lead);
      });
      setLeads(items);
    });

    return () => unsubscribe();
  }, [appUser?.uid, statusFilter]);

  const handleCreateLead = async () => {
    if (!newLead.name || !newLead.phone) {
      Alert.alert('Error', 'Name and phone are required');
      return;
    }

    try {
      // Get coordinates from address
      let latitude = 0;
      let longitude = 0;
      if (newLead.address) {
        const geoResponse = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(newLead.address)}&key=${process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY}`
        );
        const geoData = await geoResponse.json();
        if (geoData.results && geoData.results.length > 0) {
          latitude = geoData.results[0].geometry.location.lat;
          longitude = geoData.results[0].geometry.location.lng;
        }
      }

      await addDoc(collection(firebaseService.firestore, 'leads'), {
        ...newLead,
        latitude,
        longitude,
        createdBy: appUser?.uid,
        createdAt: Timestamp.now(),
        status: 'pending',
      });

      setShowAddModal(false);
      setNewLead({ name: '', phone: '', address: '', notes: '' });
      Alert.alert('Success', 'Lead created. Waiting for admin approval.');
    } catch (error) {
      console.error('Error creating lead:', error);
      Alert.alert('Error', 'Failed to create lead');
    }
  };

  const renderLead = ({ item }: { item: Lead }) => (
    <View style={styles.leadCard}>
      <View style={styles.leadHeader}>
        <Text style={styles.leadName}>{item.name}</Text>
        <StatusBadge status={item.status} />
      </View>
      <Text style={styles.leadPhone}>{item.phone}</Text>
      {item.address && <Text style={styles.leadAddress}>{item.address}</Text>}
      {item.notes && <Text style={styles.leadNotes}>📝 {item.notes}</Text>}
      <Text style={styles.leadDate}>
        {new Date(item.createdAt?.toMillis() || Date.now()).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })}
      </Text>
      {item.status === 'approved' && (
        <View style={styles.approvedBadge}>
          <Text style={styles.approvedText}>✓ Approved</Text>
        </View>
      )}
      {item.status === 'rejected' && (
        <View style={styles.rejectedBadge}>
          <Text style={styles.rejectedText}>✕ Rejected</Text>
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Status Filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
        {[null, 'pending', 'approved', 'rejected'].map((status) => (
          <TouchableOpacity
            key={String(status)}
            style={[styles.filterChip, statusFilter === status && styles.filterChipActive]}
            onPress={() => setStatusFilter(status)}
          >
            <Text style={[styles.filterChipText, statusFilter === status && styles.filterChipTextActive]}>
              {status ? status.charAt(0).toUpperCase() + status.slice(1) : 'All'}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddModal(true)}>
          <Text style={styles.addBtnText}>+ New</Text>
        </TouchableOpacity>
      </ScrollView>

      <FlatList
        data={leads}
        renderItem={renderLead}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No leads yet</Text>
            <Text style={styles.emptySubtext}>Create a new lead from a party visit</Text>
          </View>
        }
      />

      {/* Add Lead Modal */}
      {showAddModal && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Lead</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.input}
              placeholder="Name *"
              value={newLead.name}
              onChangeText={(v) => setNewLead({ ...newLead, name: v })}
            />
            <TextInput
              style={styles.input}
              placeholder="Phone *"
              value={newLead.phone}
              onChangeText={(v) => setNewLead({ ...newLead, phone: v })}
              keyboardType="phone-pad"
            />
            <TextInput
              style={styles.input}
              placeholder="Address"
              value={newLead.address}
              onChangeText={(v) => setNewLead({ ...newLead, address: v })}
              multiline
            />
            <TextInput
              style={[styles.input, { height: 80 }]}
              placeholder="Notes"
              value={newLead.notes}
              onChangeText={(v) => setNewLead({ ...newLead, notes: v })}
              multiline
            />

            <TouchableOpacity style={styles.saveBtn} onPress={handleCreateLead}>
              <Text style={styles.saveBtnText}>Create Lead</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  filterRow: { paddingHorizontal: 12, paddingVertical: 10, maxHeight: 56 },
  filterChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#FFF', marginRight: 8, borderWidth: 1, borderColor: '#E0E0E0' },
  filterChipActive: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  filterChipText: { fontSize: 13, color: '#666' },
  filterChipTextActive: { color: '#FFF' },
  addBtn: { backgroundColor: '#007AFF', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginRight: 12 },
  addBtnText: { color: '#FFF', fontWeight: '600', fontSize: 13 },
  list: { padding: 12, gap: 12 },
  leadCard: { backgroundColor: '#FFF', borderRadius: 12, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
  leadHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  leadName: { fontSize: 16, fontWeight: '600', color: '#333' },
  leadPhone: { fontSize: 14, color: '#007AFF', marginBottom: 4 },
  leadAddress: { fontSize: 13, color: '#666', marginBottom: 4 },
  leadNotes: { fontSize: 13, color: '#666', marginBottom: 4, fontStyle: 'italic' },
  leadDate: { fontSize: 12, color: '#999' },
  approvedBadge: { backgroundColor: '#D4EDDA', padding: 6, borderRadius: 6, marginTop: 8, alignSelf: 'flex-start' },
  approvedText: { color: '#155724', fontSize: 12, fontWeight: '600' },
  rejectedBadge: { backgroundColor: '#F8D7DA', padding: 6, borderRadius: 6, marginTop: 8, alignSelf: 'flex-start' },
  rejectedText: { color: '#721C24', fontSize: 12, fontWeight: '600' },
  emptyState: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: 16, color: '#999' },
  emptySubtext: { fontSize: 13, color: '#999', marginTop: 4 },
  modalOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#333' },
  modalClose: { fontSize: 24, color: '#999', padding: 8 },
  input: { backgroundColor: '#FFF', borderRadius: 10, padding: 14, fontSize: 15, borderWidth: 1, borderColor: '#E0E0E0', marginBottom: 12 },
  saveBtn: { backgroundColor: '#007AFF', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  saveBtnText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
});