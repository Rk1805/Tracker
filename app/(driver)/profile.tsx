import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { collection, onSnapshot, query, where, Timestamp, doc, updateDoc } from 'firebase/firestore';
import { updateProfile } from 'firebase/auth';
import firebaseService from '../../src/services/firebase';
import { useAuth } from '../../src/context/AuthContext';
import StatusBadge from '../../src/components/StatusBadge';
import { useRouter } from "expo-router";

export default function DriverProfile() {
  const router = useRouter();
  const { appUser, logout } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [displayName, setDisplayName] = useState(appUser?.displayName || '');
  const [phoneNumber, setPhoneNumber] = useState(appUser?.phoneNumber || '');
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState({
    totalTrips: 0,
    completedTrips: 0,
    totalDeliveries: 0,
    deliveredCount: 0,
  });

  const handleLogout = async () => {
        await logout();
        router.replace("/auth/login");
    };

  useEffect(() => {
    setDisplayName(appUser?.displayName || '');
    setPhoneNumber(appUser?.phoneNumber || '');
  }, [appUser]);

  useEffect(() => {
    if (!appUser?.uid) return;

    const tripsUnsub = onSnapshot(
      query(collection(firebaseService.firestore, 'trips'), where('userId', '==', appUser.uid)),
      (snapshot) => {
        let total = 0, completed = 0;
        snapshot.forEach((doc) => { total++; if (doc.data().status === 'completed') completed++; });
        setStats((s) => ({ ...s, totalTrips: total, completedTrips: completed }));
      }
    );

    const deliveriesUnsub = onSnapshot(
      query(collection(firebaseService.firestore, 'deliveries'), where('acceptedBy', '==', appUser.uid)),
      (snapshot) => {
        let total = 0, delivered = 0;
        snapshot.forEach((doc) => { total++; if (doc.data().status === 'delivered') delivered++; });
        setStats((s) => ({ ...s, totalDeliveries: total, deliveredCount: delivered }));
      }
    );

    return () => { tripsUnsub(); deliveriesUnsub(); };
  }, [appUser?.uid]);

  const handleSave = async () => {
    if (!displayName.trim()) {
      Alert.alert('Error', 'Display name is required');
      return;
    }
    setSaving(true);
    try {
      const user = firebaseService.auth.currentUser;
      if (!user) throw new Error('No user');

      await updateProfile(user, { displayName: displayName.trim() });

      await updateDoc(doc(firebaseService.firestore, 'users', user.uid), {
        displayName: displayName.trim(),
        phoneNumber: phoneNumber.trim(),
        updatedAt: Timestamp.now(),
      });

      setIsEditing(false);
      Alert.alert('Saved', 'Profile updated successfully');
    } catch (error) {
      console.error('Save error:', error);
      Alert.alert('Error', 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.profileHeader}>
        <View style={styles.avatarPlaceholder}>
          <Text style={styles.avatarText}>
            {appUser?.displayName?.charAt(0)?.toUpperCase() || 'D'}
          </Text>
        </View>

        {isEditing ? (
          <TextInput
            style={styles.nameInput}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Display Name"
            placeholderTextColor="#999"
          />
        ) : (
          <Text style={styles.displayName}>{appUser?.displayName || 'Driver'}</Text>
        )}
        <Text style={styles.email}>{appUser?.phoneNumber || 'No phone set'}</Text>
        <StatusBadge status="driver" />
      </View>

      {isEditing && (
        <View style={styles.editSection}>
          <TextInput
            style={styles.input}
            placeholder="Phone Number"
            placeholderTextColor="#999"
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            keyboardType="phone-pad"
          />
          <View style={styles.editActions}>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
              <Text style={styles.saveBtnText}>{saving ? 'Saving...' : 'Save Changes'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => { setIsEditing(false); setDisplayName(appUser?.displayName || ''); setPhoneNumber(appUser?.phoneNumber || ''); }}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {!isEditing && (
        <TouchableOpacity style={styles.editProfileBtn} onPress={() => setIsEditing(true)}>
          <Text style={styles.editProfileBtnText}>Edit Profile</Text>
        </TouchableOpacity>
      )}

      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.totalTrips}</Text>
          <Text style={styles.statLabel}>Total Trips</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.completedTrips}</Text>
          <Text style={styles.statLabel}>Completed</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.totalDeliveries}</Text>
          <Text style={styles.statLabel}>Deliveries</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.deliveredCount}</Text>
          <Text style={styles.statLabel}>Delivered</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutBtnText}>Logout</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  profileHeader: { alignItems: 'center', padding: 24, backgroundColor: '#FFF', marginBottom: 16 },
  avatarPlaceholder: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#007AFF', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  avatarText: { fontSize: 32, fontWeight: '700', color: '#FFF' },
  displayName: { fontSize: 22, fontWeight: '700', color: '#333', marginBottom: 4 },
  nameInput: { fontSize: 20, fontWeight: '600', color: '#333', textAlign: 'center', borderBottomWidth: 1, borderBottomColor: '#007AFF', paddingVertical: 4, marginBottom: 4, minWidth: 150 },
  email: { fontSize: 14, color: '#666', marginBottom: 12 },
  editSection: { backgroundColor: '#FFF', marginHorizontal: 12, padding: 16, borderRadius: 12, marginBottom: 12 },
  input: { backgroundColor: '#F5F5F5', borderRadius: 10, padding: 14, fontSize: 15, borderWidth: 1, borderColor: '#E0E0E0', marginBottom: 12 },
  editActions: { gap: 8 },
  saveBtn: { backgroundColor: '#007AFF', padding: 14, borderRadius: 10, alignItems: 'center' },
  saveBtnText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  cancelBtn: { backgroundColor: '#FFF', padding: 14, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: '#E0E0E0' },
  cancelBtnText: { color: '#666', fontSize: 14 },
  editProfileBtn: { backgroundColor: '#FFF', marginHorizontal: 12, padding: 14, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: '#007AFF', marginBottom: 12 },
  editProfileBtnText: { color: '#007AFF', fontSize: 15, fontWeight: '600' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 12 },
  statCard: { backgroundColor: '#FFF', borderRadius: 12, padding: 16, width: '47%', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
  statValue: { fontSize: 28, fontWeight: '700', color: '#007AFF' },
  statLabel: { fontSize: 13, color: '#666', marginTop: 4 },
  logoutBtn: { backgroundColor: '#FF3B30', margin: 24, padding: 16, borderRadius: 12, alignItems: 'center' },
  logoutBtnText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
});
