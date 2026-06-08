import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
} from 'react-native';
import {
  collection,
  query,
  where,
  onSnapshot,
  updateDoc,
  doc,
  Timestamp,
  addDoc,
} from 'firebase/firestore';

import firebaseService from '../../src/services/firebase';
import { useAuth } from '../../src/context/AuthContext';
import StatusBadge from '../../src/components/StatusBadge';

export default function LeadVerification() {
  const { appUser } = useAuth();

  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(firebaseService.firestore, 'leads'),
      where('status', '==', 'pending')
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const items: any[] = [];

      snapshot.forEach((docSnap) => {
        items.push({
          id: docSnap.id,
          ...docSnap.data(),
        });
      });

      setLeads(items);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  const openMap = (lead: any) => {
    const url =
      `https://www.google.com/maps/search/?api=1&query=${lead.latitude},${lead.longitude}`;

    Linking.openURL(url);
  };

  const approveLead = async (lead: any) => {
    try {
      // Update lead
      await updateDoc(
        doc(firebaseService.firestore, 'leads', lead.id),
        {
          status: 'approved',
          approvedAt: Timestamp.now(),
          approvedBy: appUser?.uid || '',
        }
      );

      // Create Party
      const partyRef = await addDoc(
      collection(firebaseService.firestore, 'parties'),
      {
        name: lead.name,

        ownerName: lead.ownerName || '',

        phoneNumber: lead.phoneNumber || '',

        alternatePhone:
          lead.alternatePhone || '',

        address: lead.address || '',

        notes: lead.notes || '',

        category:
          lead.category || 'retail',

        latitude: lead.latitude || 0,
        longitude: lead.longitude || 0,

        createdBy: lead.createdBy,

        createdAt:
          lead.createdAt || Timestamp.now(),

        updatedAt: Timestamp.now(),

        isApproved: true,
      }
    );

    await updateDoc(
      doc(firebaseService.firestore, 'leads', lead.id),
      {
        status: 'approved',
        isApproved: true,

        approvedAt: Timestamp.now(),
        approvedBy: appUser?.uid || '',
      }
    );

      Alert.alert(
        'Success',
        'Lead approved and Party created.'
      );
    } catch (error) {
      console.error(error);

      Alert.alert(
        'Error',
        'Failed to approve lead.'
      );
    }
  };

  const rejectLead = async (lead: any) => {
    try {
      await updateDoc(
        doc(firebaseService.firestore, 'leads', lead.id),
        {
          status: 'rejected',
          isApproved: false,
          rejectedAt: Timestamp.now(),
          rejectedBy: appUser?.uid || '',
        }
      );

      Alert.alert(
        'Lead Rejected',
        'Lead has been rejected.'
      );
    } catch (error) {
      console.error(error);

      Alert.alert(
        'Error',
        'Failed to reject lead.'
      );
    }
  };

  const confirmApprove = (lead: any) => {
    Alert.alert(
      'Approve Lead',
      `Approve "${lead.name}" and create a Party?`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Approve',
          onPress: () => approveLead(lead),
        },
      ]
    );
  };

  const confirmReject = (lead: any) => {
    Alert.alert(
      'Reject Lead',
      `Reject "${lead.name}"?`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: () => rejectLead(lead),
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <Text>Loading leads...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>
          Lead Verification
        </Text>

        <Text style={styles.subtitle}>
          Pending Leads: {leads.length}
        </Text>
      </View>

      {leads.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>
            No pending leads
          </Text>
        </View>
      )}

      {leads.map((lead) => (
        <View
          key={lead.id}
          style={styles.card}
        >
          <View style={styles.cardHeader}>
            <Text style={styles.partyName}>
              {lead.name}
            </Text>

            <StatusBadge
              status={lead.status}
            />
          </View>

          <Text style={styles.detail}>
            📞 {lead.phoneNumber || 'No Phone'}
          </Text>

          {lead.ownerName ? (
            <Text style={styles.detail}>
              👤 {lead.ownerName}
            </Text>
          ) : null}

          {lead.category ? (
            <Text style={styles.detail}>
              🏷️ {lead.category}
            </Text>
          ) : null}

          <Text style={styles.detail}>
            📍 {lead.address}
          </Text>

          {lead.notes ? (
            <Text style={styles.notes}>
              {lead.notes}
            </Text>
          ) : null}

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={styles.mapBtn}
              onPress={() => openMap(lead)}
            >
              <Text style={styles.btnText}>
                Open Map
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.approveBtn}
              onPress={() =>
                confirmApprove(lead)
              }
            >
              <Text style={styles.btnText}>
                Approve
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.rejectBtn}
              onPress={() =>
                confirmReject(lead)
              }
            >
              <Text style={styles.btnText}>
                Reject
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },

  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  header: {
    padding: 16,
  },

  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
  },

  subtitle: {
    marginTop: 4,
    color: '#666',
  },

  emptyState: {
    alignItems: 'center',
    marginTop: 80,
  },

  emptyText: {
    fontSize: 16,
    color: '#666',
  },

  card: {
    backgroundColor: '#FFF',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 12,

    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,

    elevation: 2,
  },

  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },

  partyName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
  },

  detail: {
    color: '#666',
    marginBottom: 6,
  },

  notes: {
    marginTop: 8,
    color: '#444',
    fontStyle: 'italic',
  },

  buttonRow: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 8,
  },

  mapBtn: {
    flex: 1,
    backgroundColor: '#5856D6',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },

  approveBtn: {
    flex: 1,
    backgroundColor: '#34C759',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },

  rejectBtn: {
    flex: 1,
    backgroundColor: '#FF3B30',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },

  btnText: {
    color: '#FFF',
    fontWeight: '600',
  },
});