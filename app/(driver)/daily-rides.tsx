import React, { useEffect, useState } from 'react';
import {
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  View,
} from 'react-native';
import { ref, onValue, off, update as updateRTDB } from 'firebase/database';
import { collection, query, where, onSnapshot, QuerySnapshot, doc, updateDoc } from 'firebase/firestore';
import firebaseService from '../../src/services/firebase';
import { useAuth } from '../../src/context/AuthContext';
import { DailyRideSummary } from '../../src/types';
import StatusBadge from '../../src/components/StatusBadge';

export default function DailyRidesScreen() {
  const { appUser } = useAuth();
  const [todaySummary, setTodaySummary] = useState<DailyRideSummary | null>(null);
  const [archivedSummaries, setArchivedSummaries] = useState<DailyRideSummary[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [loading, setLoading] = useState(true);

  const formatDate = (date: Date) => {
    return (
      date.getFullYear() +
      '-' +
      String(date.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(date.getDate()).padStart(2, '0')
    );
  };

  const getDisplayDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-IN', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const goToPrevDay = () => {
    const prev = new Date(selectedDate);
    prev.setDate(prev.getDate() - 1);
    setSelectedDate(prev);
  };

  const goToNextDay = () => {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + 1);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (next <= today) setSelectedDate(next);
  };

  useEffect(() => {
    if (!appUser?.uid) return;

    const dateStr = formatDate(selectedDate);
    const todayStr = formatDate(new Date());
    const isToday = dateStr === todayStr;

    setLoading(true);
    setTodaySummary(null);
    setArchivedSummaries([]);

    if (isToday) {
      const todayRef = ref(firebaseService.database, `daily-ride-summaries/${appUser.uid}/dates/${dateStr}`);
      const unsubscribe = onValue(todayRef, (snapshot) => {
        if (snapshot.exists()) {
          setTodaySummary({ id: `${appUser.uid}_${dateStr}`, ...snapshot.val() });
        } else {
          setTodaySummary(null);
        }
        setLoading(false);
      });
      return () => off(todayRef);
    } else {
      const q = query(
        collection(firebaseService.firestore, 'daily-ride-summaries'),
        where('driverId', '==', appUser.uid),
        where('date', '==', dateStr)
      );
      const unsubscribe = onSnapshot(q, (snapshot: QuerySnapshot) => {
        if (!snapshot.empty) {
          const data = snapshot.docs[0].data() as DailyRideSummary;
          setArchivedSummaries([{ id: snapshot.docs[0].id, ...data }]);
        } else {
          setArchivedSummaries([]);
        }
        setLoading(false);
      });
      return () => unsubscribe();
    }
  }, [appUser?.uid, selectedDate]);

  const handlePayDriver = async (summary: DailyRideSummary) => {
    if (!appUser?.uid || !summary.id) return;

    Alert.alert(
      'Mark as Paid',
      `Mark rides as paid for ${summary.driverName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Pay',
          onPress: async () => {
            const dateStr = summary.date;
            const todayStr = formatDate(new Date());
            const isToday = dateStr === todayStr;

            if (isToday) {
              await updateRTDB(
                ref(firebaseService.database, `daily-ride-summaries/${summary.driverId}/dates/${dateStr}`),
                { status: 'paid', paidAt: Date.now(), updatedAt: Date.now() }
              );
            } else {
              await updateDoc(doc(firebaseService.firestore, 'daily-ride-summaries', summary.id!), {
                status: 'paid',
                paidAt: Date.now(),
                updatedAt: Date.now(),
              });
            }
          },
        },
      ]
    );
  };

  const handleConfirmPayment = async (summary: DailyRideSummary) => {
    if (!summary.id || !appUser?.uid) return;

    Alert.alert(
      'Confirm Payment',
      'Confirm you have received payment?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            const dateStr = summary.date;
            const todayStr = formatDate(new Date());
            const isToday = dateStr === todayStr;

            if (isToday) {
              // Today's data is in RTDB, not Firestore
              await updateRTDB(
                ref(firebaseService.database, `daily-ride-summaries/${appUser.uid}/dates/${dateStr}`),
                { status: 'confirmed', confirmedAt: Date.now(), updatedAt: Date.now() }
              );
            } else {
              // Historical data is in Firestore
              await updateDoc(doc(firebaseService.firestore, 'daily-ride-summaries', summary.id!), {
                status: 'confirmed',
                confirmedAt: Date.now(),
                updatedAt: Date.now(),
              });
            }
          },
        },
      ]
    );
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed': return '#34C759';
      case 'paid': return '#007AFF';
      default: return '#FF9500';
    }
  };

  const renderSummary = ({ item }: { item: DailyRideSummary }) => (
    <View style={styles.summaryCard}>
      <View style={styles.summaryHeader}>
        <Text style={styles.driverName}>{item.driverName}</Text>
        <StatusBadge status={item.status} />
      </View>

      <Text style={styles.dateText}>{getDisplayDate(item.date)}</Text>

      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{Math.round(item.totalDistanceKm)} km</Text>
          <Text style={styles.statLabel}>Distance</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{item.totalTrips}</Text>
          <Text style={styles.statLabel}>Trips</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{item.totalStops}</Text>
          <Text style={styles.statLabel}>Stops</Text>
        </View>
        {(item.totalLaminatesDelivered ?? 0) > 0 && (
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{item.totalLaminatesDelivered}</Text>
            <Text style={styles.statLabel}>Laminates</Text>
          </View>
        )}
      </View>

      {item.status === 'pending' && appUser?.role === 'admin' && (
        <TouchableOpacity style={styles.payBtn} onPress={() => handlePayDriver(item)}>
          <Text style={styles.payBtnText}>Mark as Paid</Text>
        </TouchableOpacity>
      )}

      {item.status === 'paid' && appUser?.role === 'driver' && (
        <TouchableOpacity style={styles.confirmBtn} onPress={() => handleConfirmPayment(item)}>
          <Text style={styles.confirmBtnText}>Confirm Payment Received</Text>
        </TouchableOpacity>
      )}

      {item.status === 'paid' && appUser?.role === 'admin' && (
        <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>
          ✓ Payment processed
        </Text>
      )}

      {item.status === 'confirmed' && (
        <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>
          ✓ Payment confirmed by driver
        </Text>
      )}
    </View>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Daily Rides</Text>
        </View>
        <View style={styles.emptyState}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </View>
    );
  }

  const isToday = formatDate(selectedDate) === formatDate(new Date());
  const hasData = isToday ? !!todaySummary : archivedSummaries.length > 0;
  const displayData: DailyRideSummary[] = isToday
    ? todaySummary ? [todaySummary] : []
    : archivedSummaries;

  const isNextDisabled = formatDate(selectedDate) === formatDate(new Date());

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Daily Rides</Text>
        <View style={styles.datePicker}>
          <TouchableOpacity style={styles.dateArrow} onPress={goToPrevDay}>
            <Text style={styles.dateArrowText}>◀</Text>
          </TouchableOpacity>
          <Text style={styles.dateLabel}>
            {isToday ? 'Today' : getDisplayDate(formatDate(selectedDate))}
          </Text>
          <TouchableOpacity
            style={[styles.dateArrow, isNextDisabled && styles.dateArrowDisabled]}
            onPress={goToNextDay}
            disabled={isNextDisabled}
          >
            <Text style={[styles.dateArrowText, isNextDisabled && { opacity: 0.3 }]}>▶</Text>
          </TouchableOpacity>
        </View>
      </View>

      {!hasData ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No rides recorded for this date</Text>
        </View>
      ) : (
        <FlatList
          data={displayData}
          renderItem={renderSummary}
          keyExtractor={(item) => item.id || ''}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingHorizontal: 20,
    backgroundColor: '#007AFF',
  },
  title: { fontSize: 20, fontWeight: '700', color: '#FFF' },
  datePicker: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 20,
    paddingHorizontal: 4,
    paddingVertical: 4,
    gap: 4,
  },
  dateArrow: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  dateArrowDisabled: { backgroundColor: 'transparent' },
  dateArrowText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  dateLabel: { color: '#FFF', fontSize: 13, fontWeight: '600', paddingHorizontal: 6, minWidth: 80, textAlign: 'center' },
  list: { padding: 12 },
  summaryCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  driverName: { fontSize: 18, fontWeight: '600', color: '#333' },
  dateText: { fontSize: 14, color: '#666', marginBottom: 12 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 16 },
  statItem: { alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '700', color: '#007AFF' },
  statLabel: { fontSize: 12, color: '#666', marginTop: 2 },
  payBtn: {
    backgroundColor: '#34C759',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  payBtnText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  confirmBtn: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  confirmBtnText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  statusText: { fontSize: 14, fontWeight: '600', textAlign: 'center', marginTop: 8 },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 16, color: '#999' },
  loadingText: { fontSize: 16, color: '#999' },
});
