import React, { useEffect, useState } from 'react';
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
  ActionSheetIOS,
  Platform,
} from 'react-native';
import { collection, onSnapshot, addDoc, updateDoc, doc, deleteDoc, Timestamp, query, orderBy } from 'firebase/firestore';
import firebaseService from '../../src/services/firebase';
import { useAuth } from '../../src/context/AuthContext';
import { Party, PartyCategory } from '../../src/types';
import StatusBadge from '../../src/components/StatusBadge';

const CATEGORIES: PartyCategory[] = [
  'retail', 'wholesale', 'distributor', 'supermarket', 'restaurant', 'other',
];

export default function PartiesScreen() {
  const { appUser } = useAuth();
  const [parties, setParties] = useState<Party[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingParty, setEditingParty] = useState<Party | null>(null);
  const [newParty, setNewParty] = useState({
    name: '',
    ownerName: '',
    phoneNumber: '',
    alternatePhone: '',
    address: '',
    notes: '',
    category: 'retail' as PartyCategory,
    latitude: 0,
    longitude: 0,
  });

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(firebaseService.firestore, 'parties'), orderBy('createdAt', 'desc')),
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

  const filteredParties = parties.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.ownerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.phoneNumber.includes(searchQuery)
  );

  const handleAddParty = async () => {
    if (!newParty.name || !newParty.phoneNumber || !newParty.address) {
      Alert.alert('Error', 'Name, Phone, and Address are required');
      return;
    }

    try {
      const geoResponse = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(newParty.address)}&key=${process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY}`
      );
      const geoData = await geoResponse.json();
      
      if (geoData.results && geoData.results.length > 0) {
        newParty.latitude = geoData.results[0].geometry.location.lat;
        newParty.longitude = geoData.results[0].geometry.location.lng;
      }

      await addDoc(collection(firebaseService.firestore, 'parties'), {
        ...newParty,
        createdBy: appUser?.uid,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        isApproved: true,
      });

      setShowAddModal(false);
      setNewParty({
        name: '',
        ownerName: '',
        phoneNumber: '',
        alternatePhone: '',
        address: '',
        notes: '',
        category: 'retail',
        latitude: 0,
        longitude: 0,
      });
      Alert.alert('Success', 'Party added successfully');
    } catch (error) {
      console.error('Error adding party:', error);
      Alert.alert('Error', 'Failed to add party');
    }
  };

  const handleEditParty = async () => {
    if (!editingParty) return;
    
    if (!editingParty.name || !editingParty.phoneNumber || !editingParty.address) {
      Alert.alert('Error', 'Name, Phone, and Address are required');
      return;
    }

    try {
      await updateDoc(doc(firebaseService.firestore, 'parties', editingParty.id), {
        ...editingParty,
        updatedAt: Timestamp.now(),
      });

      setShowEditModal(false);
      setEditingParty(null);
      Alert.alert('Success', 'Party updated successfully');
    } catch (error) {
      console.error('Error updating party:', error);
      Alert.alert('Error', 'Failed to update party');
    }
  };

  const handleDeleteParty = (party: Party) => {
    Alert.alert(
      'Delete Party',
      `Are you sure you want to delete "${party.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteDoc(doc(firebaseService.firestore, 'parties', party.id));
              Alert.alert('Success', 'Party deleted successfully');
            } catch (error) {
              console.error('Error deleting party:', error);
              Alert.alert('Error', 'Failed to delete party');
            }
          },
        },
      ]
    );
  };

  const showActionSheet = (party: Party) => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Edit', 'Delete', 'Cancel'],
          destructiveButtonIndex: 1,
          cancelButtonIndex: 2,
        },
        (buttonIndex: number) => {
          if (buttonIndex === 0) {
            setEditingParty(party);
            setShowEditModal(true);
          } else if (buttonIndex === 1) {
            handleDeleteParty(party);
          }
        }
      );
    } else {
      Alert.alert(
        'Party Options',
        'Choose an action',
        [
          { text: 'Edit', onPress: () => { setEditingParty(party); setShowEditModal(true); } },
          { text: 'Delete', style: 'destructive', onPress: () => handleDeleteParty(party) },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
    }
  };

  const renderParty = ({ item }: { item: Party }) => (
    <TouchableOpacity 
      style={styles.partyCard}
      onLongPress={() => showActionSheet(item)}
    >
      <View style={styles.partyHeader}>
        <Text style={styles.partyName}>{item.name}</Text>
        <StatusBadge status={item.category} size="small" />
      </View>
      <Text style={styles.partyOwner}>{item.ownerName}</Text>
      <Text style={styles.partyPhone}>{item.phoneNumber}</Text>
      <Text style={styles.partyAddress}>{item.address}</Text>
      {item.notes && <Text style={styles.partyNotes}>📝 {item.notes}</Text>}
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search parties..."
          placeholderTextColor="#999"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => setShowAddModal(true)}
        >
          <Text style={styles.addButtonText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={filteredParties}
        renderItem={renderParty}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No parties found</Text>
          </View>
        }
      />

      {/* Add Party Modal */}
      <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet">
        <ScrollView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add New Party</Text>
            <TouchableOpacity onPress={() => setShowAddModal(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.input}
            placeholder="Party Name *"
            value={newParty.name}
            onChangeText={(v) => setNewParty({ ...newParty, name: v })}
          />
          <TextInput
            style={styles.input}
            placeholder="Owner Name"
            value={newParty.ownerName}
            onChangeText={(v) => setNewParty({ ...newParty, ownerName: v })}
          />
          <TextInput
            style={styles.input}
            placeholder="Phone Number *"
            value={newParty.phoneNumber}
            onChangeText={(v) => setNewParty({ ...newParty, phoneNumber: v })}
            keyboardType="phone-pad"
          />
          <TextInput
            style={styles.input}
            placeholder="Alternate Phone"
            value={newParty.alternatePhone}
            onChangeText={(v) => setNewParty({ ...newParty, alternatePhone: v })}
            keyboardType="phone-pad"
          />
          <TextInput
            style={styles.input}
            placeholder="Address *"
            value={newParty.address}
            onChangeText={(v) => setNewParty({ ...newParty, address: v })}
            multiline
          />
          <TextInput
            style={styles.input}
            placeholder="Notes"
            value={newParty.notes}
            onChangeText={(v) => setNewParty({ ...newParty, notes: v })}
            multiline
          />

          <Text style={styles.label}>Category</Text>
          <View style={styles.categoryRow}>
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[
                  styles.categoryChip,
                  newParty.category === cat && styles.categoryChipActive,
                ]}
                onPress={() => setNewParty({ ...newParty, category: cat })}
              >
                <Text
                  style={[
                    styles.categoryText,
                    newParty.category === cat && styles.categoryTextActive,
                  ]}
                >
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={styles.saveButton} onPress={handleAddParty}>
            <Text style={styles.saveButtonText}>Save Party</Text>
          </TouchableOpacity>
        </ScrollView>
      </Modal>

      {/* Edit Party Modal */}
      <Modal visible={showEditModal} animationType="slide" presentationStyle="pageSheet">
        <ScrollView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Edit Party</Text>
            <TouchableOpacity onPress={() => setShowEditModal(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>

          {editingParty && (
            <>
              <TextInput
                style={styles.input}
                placeholder="Party Name *"
                value={editingParty.name}
                onChangeText={(v) => setEditingParty({ ...editingParty, name: v })}
              />
              <TextInput
                style={styles.input}
                placeholder="Owner Name"
                value={editingParty.ownerName}
                onChangeText={(v) => setEditingParty({ ...editingParty, ownerName: v })}
              />
              <TextInput
                style={styles.input}
                placeholder="Phone Number *"
                value={editingParty.phoneNumber}
                onChangeText={(v) => setEditingParty({ ...editingParty, phoneNumber: v })}
                keyboardType="phone-pad"
              />
              <TextInput
                style={styles.input}
                placeholder="Alternate Phone"
                value={editingParty.alternatePhone || ''}
                onChangeText={(v) => setEditingParty({ ...editingParty, alternatePhone: v })}
                keyboardType="phone-pad"
              />
              <TextInput
                style={styles.input}
                placeholder="Address *"
                value={editingParty.address}
                onChangeText={(v) => setEditingParty({ ...editingParty, address: v })}
                multiline
              />
              <TextInput
                style={styles.input}
                placeholder="Notes"
                value={editingParty.notes || ''}
                onChangeText={(v) => setEditingParty({ ...editingParty, notes: v })}
                multiline
              />

              <Text style={styles.label}>Category</Text>
              <View style={styles.categoryRow}>
                {CATEGORIES.map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[
                      styles.categoryChip,
                      editingParty.category === cat && styles.categoryChipActive,
                    ]}
                    onPress={() => setEditingParty({ ...editingParty, category: cat })}
                  >
                    <Text
                      style={[
                        styles.categoryText,
                        editingParty.category === cat && styles.categoryTextActive,
                      ]}
                    >
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity style={styles.saveButton} onPress={handleEditParty}>
                <Text style={styles.saveButtonText}>Update Party</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  searchBar: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#FFF',
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  addButton: {
    backgroundColor: '#007AFF',
    borderRadius: 10,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  addButtonText: {
    color: '#FFF',
    fontWeight: '600',
    fontSize: 15,
  },
  list: {
    padding: 12,
    gap: 12,
  },
  partyCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  partyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  partyName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  partyOwner: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  partyPhone: {
    fontSize: 14,
    color: '#007AFF',
    marginBottom: 4,
  },
  partyAddress: {
    fontSize: 13,
    color: '#999',
  },
  partyNotes: {
    fontSize: 13,
    color: '#666',
    marginTop: 8,
    fontStyle: 'italic',
  },
  emptyState: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
  },
  modal: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#333',
  },
  modalClose: {
    fontSize: 24,
    color: '#999',
    padding: 8,
  },
  input: {
    backgroundColor: '#FFF',
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
    marginTop: 8,
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 24,
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  categoryChipActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  categoryText: {
    fontSize: 13,
    color: '#666',
  },
  categoryTextActive: {
    color: '#FFF',
  },
  saveButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  saveButtonText: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '600',
  },
});