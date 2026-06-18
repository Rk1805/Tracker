import DateTimePicker from "@react-native-community/datetimepicker";
import * as Location from "expo-location";
import {
  get as getRTDB,
  ref,
  remove as removeRTDB,
  set,
  update as updateRTDB,
} from "firebase/database";
import {
  QueryDocumentSnapshot,
  Timestamp,
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  startAfter,
  updateDoc,
  where,
} from "firebase/firestore";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, {
  AnimatedRegion,
  Marker,
  PROVIDER_GOOGLE,
} from "react-native-maps";
import MapViewDirections from "react-native-maps-directions";
import PlannedRouteDirections from "../../src/components/PlannedRouteDirections";
import StatusBadge from "../../src/components/StatusBadge";
import { getDepotOrigin } from "../../src/constants/depot";
import { useAuth } from "../../src/context/AuthContext";
import firebaseService from "../../src/services/firebase";
import {
  getTripDistanceKm,
  locationService,
  setCurrentTripId,
} from "../../src/services/location";
import { routeService } from "../../src/services/routes";
import { trackingService } from "../../src/services/tracking";
import { DeliveryPriority, Trip, TripStop } from "../../src/types";
import {
  computeActualDurationMinutes,
  formatDurationMinutes,
  getActualDistanceKm,
  getActualDurationMinutes,
  getPlannedDistanceKm,
  getPlannedDurationMinutes,
  getTwoYearsAgoTimestamp,
} from "../../src/utils/tripDistance";
import { buildOrderedTripStops } from "../../src/utils/tripStops";

const PRIORITIES: DeliveryPriority[] = ["low", "medium", "high", "urgent"];
const HISTORY_PAGE_SIZE = 50;

// --- Reusable Searchable Dropdown Component ---
const SearchablePicker = ({
  visible,
  onClose,
  data,
  onSelect,
  title,
  placeholder,
}: any) => {
  const [searchQuery, setSearchQuery] = useState("");
  const filteredData = data.filter((item: any) =>
    item.label.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.dropdownOverlay}>
        <View style={styles.dropdownContent}>
          <View style={styles.dropdownHeader}>
            <Text style={styles.dropdownTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.dropdownClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.searchInput}
            placeholder={placeholder}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
          />
          <FlatList
            data={filteredData}
            keyExtractor={(item) => item.value}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.dropdownItem}
                onPress={() => {
                  onSelect(item.value);
                  setSearchQuery("");
                  onClose();
                }}
              >
                <Text style={styles.dropdownItemText}>{item.label}</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={styles.emptySearchText}>No results found</Text>
            }
          />
        </View>
      </View>
    </Modal>
  );
};

export default function TripsScreen() {
  const { appUser } = useAuth();
  const mapRef = useRef<MapView>(null);
  const [upcomingTrips, setUpcomingTrips] = useState<Trip[]>([]);
  const [completedTrips, setCompletedTrips] = useState<Trip[]>([]);
  const [historyLastDoc, setHistoryLastDoc] =
    useState<QueryDocumentSnapshot | null>(null);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [parties, setParties] = useState<any[]>([]);
  const [users, setUsers] = useState<{ [key: string]: any }>({});
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showFullscreenMap, setShowFullscreenMap] = useState(false);
  const [tab, setTab] = useState<"upcoming" | "history">("upcoming");
  const [selectedDrivers, setSelectedDrivers] = useState<string[]>([]);
  const [selectedParties, setSelectedParties] = useState<string[]>([]);
  const [partyLaminates, setPartyLaminates] = useState<Record<string, string>>(
    {},
  );
  const [newTrip, setNewTrip] = useState({
    priority: "medium" as DeliveryPriority,
    notes: "",
  });
  const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  // Debounced origin for the directions line — only update every 30s to prevent redrawing
  const [routeOrigin, setRouteOrigin] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const lastRouteOriginUpdateRef = useRef(0);
  // Expand/Collapse State
  const [expandedTripIds, setExpandedTripIds] = useState<string[]>([]);

  const animatedLocation = useRef(
    new AnimatedRegion({
      latitude: 20.5937,
      longitude: 78.9629,
      latitudeDelta: 0.001,
      longitudeDelta: 0.001,
    }),
  ).current;

  // Filter States
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [filterDate, setFilterDate] = useState<string | null>(null);
  const [filterDriver, setFilterDriver] = useState<string | null>(null);
  const [filterParty, setFilterParty] = useState<string | null>(null);

  // Dropdown / Picker Visibility States
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showDriverPicker, setShowDriverPicker] = useState(false);
  const [showPartyPicker, setShowPartyPicker] = useState(false);

  // Live Tracking States
  const [currentLocation, setCurrentLocation] =
    useState<Location.LocationObject | null>(null);
  const [currentSpeed, setCurrentSpeed] = useState<number>(0);
  const [isNearNextStop, setIsNearNextStop] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const unsubUpcoming = onSnapshot(
      query(
        collection(firebaseService.firestore, "trips"),
        where("userId", "==", appUser?.uid),
        where("status", "in", ["planned", "in_progress"]),
        orderBy("createdAt", "desc"),
      ),
      (snapshot) => {
        const items: Trip[] = [];
        snapshot.forEach((doc) => {
          items.push({ id: doc.id, ...doc.data() } as Trip);
        });
        setUpcomingTrips(items);
        if (selectedTrip) {
          const updatedSelected = items.find((i) => i.id === selectedTrip.id);
          if (updatedSelected) setSelectedTrip(updatedSelected);
        }
      },
    );

    const driversUnsub = onSnapshot(
      query(
        collection(firebaseService.firestore, "users"),
        where("role", "==", "driver"),
      ),
      (snapshot) => {
        const items: any[] = [];
        snapshot.forEach((doc) => {
          items.push({ id: doc.id, ...doc.data() });
        });
        setDrivers(items);
      },
    );

    const partiesUnsub = onSnapshot(
      query(
        collection(firebaseService.firestore, "parties"),
        orderBy("name", "asc"),
      ),
      (snapshot) => {
        const items: any[] = [];
        snapshot.forEach((doc) => {
          items.push({ id: doc.id, ...doc.data() });
        });
        setParties(items);
      },
    );

    const usersUnsub = firebaseService.onRealtimeValue(
      "live-locations",
      (snapshot) => {
        if (snapshot.exists()) {
          setUsers(snapshot.val());
        }
      },
    );

    return () => {
      unsubUpcoming();
      driversUnsub();
      partiesUnsub();
      usersUnsub();
    };
  }, [selectedTrip]);

  const loadCompletedTrips = async (append = false) => {
    if (
      loadingHistory ||
      (!append && !hasMoreHistory && completedTrips.length > 0)
    )
      return;
    setLoadingHistory(true);

    try {
      const twoYearsAgo = Timestamp.fromDate(getTwoYearsAgoTimestamp());
      let historyQuery = query(
        collection(firebaseService.firestore, "trips"),
        where("userId", "==", appUser?.uid),
        where("status", "==", "completed"),
        where("completedAt", ">=", twoYearsAgo),
        orderBy("completedAt", "desc"),
        limit(HISTORY_PAGE_SIZE),
      );

      if (append && historyLastDoc) {
        historyQuery = query(historyQuery, startAfter(historyLastDoc));
      }

      const snapshot = await getDocs(historyQuery);
      const items: Trip[] = [];
      snapshot.forEach((docSnap) => {
        items.push({ id: docSnap.id, ...docSnap.data() } as Trip);
      });

      setCompletedTrips((prev) => (append ? [...prev, ...items] : items));
      setHistoryLastDoc(snapshot.docs[snapshot.docs.length - 1] ?? null);
      setHasMoreHistory(snapshot.size === HISTORY_PAGE_SIZE);
    } catch (error) {
      console.error("Error loading trip history:", error);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (tab === "history") {
      setHistoryLastDoc(null);
      setHasMoreHistory(true);
      loadCompletedTrips(false);
    }
  }, [tab]);

  useEffect(() => {
    const hasActiveTrip = upcomingTrips.some(
      (trip) => trip.status === "in_progress",
    );
    if (!hasActiveTrip) return;

    const intervalId = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(intervalId);
  }, [upcomingTrips]);

  // Real-time location watcher for Navigation map with Google Maps-style Auto-Camera Tracking
  useEffect(() => {
    let unsubWatcher: (() => void) | undefined;

    if (showFullscreenMap && selectedTrip?.status === "in_progress") {
      // Seed routeOrigin immediately so directions draw on map open
      locationService.getCurrentPosition().then((loc) => {
        if (loc) {
          setRouteOrigin({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          });
          lastRouteOriginUpdateRef.current = Date.now();
        }
      });
      const startWatching = async () => {
        unsubWatcher = await locationService.watchPosition((loc) => {
          setCurrentLocation(loc);
          animatedLocation
            .timing({
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
              duration: 500,
              useNativeDriver: false,
            } as any)
            .start();
          setCurrentSpeed(
            loc.coords.speed ? Math.round(loc.coords.speed * 3.6) : 0,
          );

          // Throttle directions redraw to every 30s — prevents flickering polyline
          const now = Date.now();
          if (now - lastRouteOriginUpdateRef.current > 30000) {
            lastRouteOriginUpdateRef.current = now;
            setRouteOrigin({
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
            });
          }

          // Google Maps Style: Auto-animate map camera to follow driver with heading and tilt
          if (mapRef.current) {
            const speed = (loc.coords.speed || 0) * 3.6;
            const lookAhead = speed > 60 ? 700 : speed > 30 ? 500 : 250;
            const aheadPoint = getPointAhead(
              loc.coords.latitude,
              loc.coords.longitude,
              loc.coords.heading || 0,
              lookAhead,
            );
            mapRef.current?.animateCamera(
              {
                center: aheadPoint,
                heading: loc.coords.heading || 0,
                pitch: 75,
                zoom: 18,
              },
              { duration: 800 },
            );
          }

          // Auto-detect arrival at next stop (within 80 metres)
          const pendingStops = selectedTrip.stops.filter(
            (s: any) => s.status === "pending",
          );
          if (pendingStops.length > 0) {
            const nextStop = pendingStops[0];
            const dist = locationService.getDistanceBetweenPoints(
              loc.coords.latitude,
              loc.coords.longitude,
              nextStop.latitude,
              nextStop.longitude,
            );
            setIsNearNextStop(dist <= 0.08);
          } else {
            setIsNearNextStop(false);
          }
        });
      };
      startWatching();
    }
    return () => {
      if (unsubWatcher) unsubWatcher();
    };
  }, [showFullscreenMap, selectedTrip]);

  const toggleExpandTrip = (tripId: string) => {
    setExpandedTripIds((prev) =>
      prev.includes(tripId)
        ? prev.filter((id) => id !== tripId)
        : [...prev, tripId],
    );
  };

  const calculateDistance = (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ) => {
    const R = 6371e3;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const calculateBearing = (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ) => {
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const y = Math.sin(dLon) * Math.cos((lat2 * Math.PI) / 180);
    const x =
      Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
      Math.sin((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.cos(dLon);
    const bearing = (Math.atan2(y, x) * 180) / Math.PI;
    return (bearing + 360) % 360;
  };

  const getHeadingDirection = (heading: number) => {
    if (!heading) return "North";
    const directions = [
      "North",
      "Northeast",
      "East",
      "Southeast",
      "South",
      "Southwest",
      "West",
      "Northwest",
    ];
    const index = Math.round(heading / 45) % 8;
    return directions[index];
  };

  const getDynamicNavigationInfo = (trip: Trip) => {
    if (!trip?.stops?.length || !trip.userId) return null;

    // For live navigation, prioritize actual driver device coordinates, fallback to DB, then default
    const currentLat =
      currentLocation?.coords.latitude ||
      users[trip.userId]?.latitude ||
      20.5937;
    const currentLon =
      currentLocation?.coords.longitude ||
      users[trip.userId]?.longitude ||
      78.9629;
    const speedKmH = currentLocation?.coords.speed
      ? Math.round(currentLocation.coords.speed * 3.6)
      : users[trip.userId]?.speed
        ? Math.round(users[trip.userId].speed * 3.6)
        : 0;

    const pendingStops = trip.stops.filter((s) => s.status === "pending");
    if (!pendingStops.length) return null;

    const nextStop = pendingStops[0];

    const distanceToNext =
      calculateDistance(
        currentLat,
        currentLon,
        nextStop.latitude,
        nextStop.longitude,
      ) / 1000;
    const bearingToNext = calculateBearing(
      currentLat,
      currentLon,
      nextStop.latitude,
      nextStop.longitude,
    );

    const totalRemaining = pendingStops.slice(1).reduce((sum, stop, idx) => {
      const prev = pendingStops[idx];
      return (
        sum +
        calculateDistance(
          prev.latitude,
          prev.longitude,
          stop.latitude,
          stop.longitude,
        ) /
          1000
      );
    }, distanceToNext);

    const effectiveSpeed = speedKmH > 5 ? speedKmH : 30;
    const etaNextMinutes = Math.round((distanceToNext / effectiveSpeed) * 60);
    const etaTotalMinutes = Math.round((totalRemaining / effectiveSpeed) * 60);

    return {
      nextStop,
      distanceToNext: Math.round(distanceToNext * 100) / 100,
      totalRemainingDistance: Math.round(totalRemaining * 10) / 10,
      etaNext: etaNextMinutes,
      etaTotal: etaTotalMinutes,
      currentSpeed: speedKmH,
      bearingDirection: getHeadingDirection(bearingToNext),
    };
  };

  const handleReorderStops = async (
    tripId: string,
    stopIndex: number,
    direction: "up" | "down",
  ) => {
    const trip = upcomingTrips.find((t) => t.id === tripId);
    if (!trip) return;

    const stops = [...trip.stops];
    const targetIndex = direction === "up" ? stopIndex - 1 : stopIndex + 1;

    if (targetIndex < 0 || targetIndex >= stops.length) return;
    if (
      stops[targetIndex].status !== "pending" ||
      stops[stopIndex].status !== "pending"
    )
      return;

    const temp = stops[stopIndex];
    stops[stopIndex] = stops[targetIndex];
    stops[targetIndex] = temp;

    // Recalculate order index fields
    stops.forEach((s, idx) => {
      s.order = idx + 1;
    });

    try {
      await updateDoc(doc(firebaseService.firestore, "trips", tripId), {
        stops,
        updatedAt: Timestamp.now(),
      });
    } catch (error) {
      console.error("Error modifying delivery sequence order:", error);
    }
  };

  const handleDelivered = async (tripId: string, stopIndex: number) => {
    try {
      const trip = upcomingTrips.find((t) => t.id === tripId);
      if (!trip) return;

      const stops = [...trip.stops];
      stops[stopIndex] = {
        ...stops[stopIndex],
        status: "delivered",
        arrivalTime: Timestamp.now(),
      };

      const completedStops = stops.filter(
        (s: any) => s.status === "delivered",
      ).length;
      const pendingStops = stops.filter(
        (s: any) => s.status === "pending",
      ).length;
      const completionPercentage = Math.round(
        (completedStops / stops.length) * 100,
      );

      const isComplete = completedStops === stops.length;

      // Update tracking record for this party
      const partyId = stops[stopIndex].partyId;
      await trackingService.updateTrackingOnStopDelivered(partyId);

      const actualDistanceKm = getTripDistanceKm();
      const completedAt = isComplete ? Timestamp.now() : null;
      const actualDurationMinutes = isComplete
        ? computeActualDurationMinutes(trip.startedAt, completedAt)
        : undefined;

      const tripUpdate: Record<string, unknown> = {
        stops,
        completedStops,
        pendingStops,
        completionPercentage,
        status: isComplete ? "completed" : "in_progress",
        completedAt,
        updatedAt: Timestamp.now(),
      };

      if (isComplete) {
        tripUpdate.actualDistanceKm = actualDistanceKm;
        tripUpdate.distanceCovered = actualDistanceKm;
        tripUpdate.distanceRemaining = Math.max(
          0,
          Math.round(((trip.totalDistance || 0) - actualDistanceKm) * 10) / 10,
        );
        if (actualDurationMinutes != null) {
          tripUpdate.actualDurationMinutes = actualDurationMinutes;
        }

        const totalLaminatesDelivered = stops.reduce(
          (sum: number, s: any) => sum + (s.laminateQuantity || 0),
          0,
        );
        await updateDailyRideSummary(
          trip.userId,
          actualDistanceKm,
          stops.length,
          totalLaminatesDelivered,
        );
      }

      await updateDoc(
        doc(firebaseService.firestore, "trips", tripId),
        tripUpdate,
      );

      // Reset arrival threshold and force immediate route redraw for next stop
      setIsNearNextStop(false);
      if (currentLocation) {
        setRouteOrigin({
          latitude: currentLocation.coords.latitude,
          longitude: currentLocation.coords.longitude,
        });
        lastRouteOriginUpdateRef.current = Date.now();
      }

      if (isComplete) {
        Alert.alert("Trip Complete", "You have delivered all packages!");
        setCurrentTripId(null);
        await locationService.stopTracking();
        setShowFullscreenMap(false);
      }
    } catch (error) {
      console.error("Error updating stop to delivered:", error);
    }
  };

  const updateDailyRideSummary = async (
    driverId: string,
    distanceKm: number,
    tripStops: number,
    laminatesDelivered: number = 0,
  ) => {
    const now = new Date();

    const dateStr =
      now.getFullYear() +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(now.getDate()).padStart(2, "0");
    console.log("SUMMARY DATE", dateStr);
    console.log("DRIVER ID", driverId);
    console.log("DISTANCE", distanceKm);
    try {
      // Archive yesterday's data to Firestore if it exists in RTDB
      await archiveYesterdayToFirestore(driverId);

      // Update today's data in RTDB
      const todayRef = ref(
        firebaseService.database,
        `daily-ride-summaries/${driverId}/dates/${dateStr}`,
      );
      const snapshot = await getRTDB(todayRef);
      let summary = snapshot.val();

      if (summary) {
        await updateRTDB(todayRef, {
          totalDistanceKm: summary.totalDistanceKm + distanceKm,
          totalTrips: summary.totalTrips + 1,
          totalStops: summary.totalStops + tripStops,
          totalLaminatesDelivered:
            (summary.totalLaminatesDelivered || 0) + laminatesDelivered,
          updatedAt: Date.now(),
        });
      } else {
        const driverSnap = await getDoc(
          doc(firebaseService.firestore, "users", driverId),
        );
        const driverData = driverSnap.exists() ? driverSnap.data() : {};
        const driverName = driverData.displayName || "Unknown";

        await set(todayRef, {
          driverId,
          driverName,
          date: dateStr,
          totalDistanceKm: distanceKm,
          totalTrips: 1,
          totalStops: tripStops,
          totalLaminatesDelivered: laminatesDelivered,
          earnings: 0,
          status: "pending",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    } catch (error) {
      console.error("Error updating daily ride summary:", error);
    }
  };

  const archiveYesterdayToFirestore = async (driverId: string) => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const yesterdayStr =
      yesterday.getFullYear() +
      "-" +
      String(yesterday.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(yesterday.getDate()).padStart(2, "0");

    const yesterdayRef = ref(
      firebaseService.database,
      `daily-ride-summaries/${driverId}/dates/${yesterdayStr}`,
    );

    try {
      const snapshot = await getRTDB(yesterdayRef);
      if (snapshot.exists()) {
        const summary = snapshot.val();
        const docId = `${driverId}_${yesterdayStr}`;

        // Save to Firestore
        await setDoc(
          doc(firebaseService.firestore, "daily-ride-summaries", docId),
          {
            ...summary,
            archivedAt: Timestamp.now(),
          },
        );

        // Remove from RTDB
        await removeRTDB(yesterdayRef);
      }
    } catch (error) {
      console.error("Error archiving yesterday data:", error);
    }
  };

  const handleStartTrip = async (tripId: string) => {
    try {
      const trip = upcomingTrips.find((t) => t.id === tripId);
      if (!trip) return;

      // Set tripId for tracking updates
      setCurrentTripId(tripId, {
        distanceCovered: trip.distanceCovered || 0,
        totalDistance: trip.totalDistance || 0,
      });

      await updateDoc(doc(firebaseService.firestore, "trips", tripId), {
        status: "in_progress",
        startedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });

      // Create delivery tracking records for each stop
      const stopData = trip.stops.map((s) => ({
        partyId: s.partyId,
        partyName: s.partyName,
        latitude: s.latitude,
        longitude: s.longitude,
      }));
      await trackingService.createTrackingRecords(
        tripId,
        stopData,
        trip.userId,
      );

      // Initialize tracking and animate map open
      await locationService.startTracking("driver");
      Alert.alert(
        "Trip Started",
        "Trip status changed to In Progress. Navigate to your first stop.",
      );

      if (!expandedTripIds.includes(tripId)) toggleExpandTrip(tripId);
    } catch (error) {
      console.error("Error starting trip:", error);
      Alert.alert("Error", "Failed to start trip");
    }
  };

  const getPointAhead = (
    lat: number,
    lng: number,
    heading: number,
    distanceMeters: number,
  ) => {
    const R = 6378137;

    const dLat = (distanceMeters * Math.cos((heading * Math.PI) / 180)) / R;

    const dLng =
      (distanceMeters * Math.sin((heading * Math.PI) / 180)) /
      (R * Math.cos((lat * Math.PI) / 180));

    return {
      latitude: lat + (dLat * 180) / Math.PI,
      longitude: lng + (dLng * 180) / Math.PI,
    };
  };

  const handleCreateTrip = async () => {
    if (selectedParties.length === 0) {
      Alert.alert("Error", "Select at least one party");
      return;
    }

    if (selectedDrivers.length === 0) {
      Alert.alert("Error", "Select at least one driver");
      return;
    }

    const selectedPartyData = parties.filter((p) =>
      selectedParties.includes(p.id),
    );

    const stopCoords = selectedPartyData.map((p) => ({
      latitude: p.latitude,
      longitude: p.longitude,
      id: p.id,
    }));

    try {
      const routeResult = await routeService.calculateOptimizedRoute(
        getDepotOrigin(),
        stopCoords,
      );

      const stops: TripStop[] = buildOrderedTripStops(
        selectedPartyData.map((p) => ({
          id: p.id,
          name: p.name || "Unknown",
          address: p.address || "",
          latitude: p.latitude,
          longitude: p.longitude,
          laminateQuantity: parseInt(partyLaminates[p.id] || "0", 10) || 0,
        })),
        routeResult.waypoints,
      );
      const totalLaminateQuantity = stops.reduce(
        (sum, s) => sum + (s.laminateQuantity || 0),
        0,
      );

      const today = new Date();
      const formattedDate =
        String(today.getDate()).padStart(2, "0") +
        "-" +
        String(today.getMonth() + 1).padStart(2, "0") +
        "-" +
        today.getFullYear();

      const driverId = selectedDrivers[0];
      await addDoc(collection(firebaseService.firestore, "trips"), {
        userId: driverId,
        userRole: "driver",
        date: formattedDate,
        status: "planned",
        stops,
        totalDistance: routeResult.totalDistance,
        totalDuration: routeResult.totalDuration,
        totalLaminateQuantity,
        distanceCovered: 0,
        distanceRemaining: routeResult.totalDistance,
        completedStops: 0,
        pendingStops: stops.length,
        completionPercentage: 0,
        priority: newTrip.priority,
        notes: newTrip.notes,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });

      setShowAddModal(false);
      setSelectedDrivers([]);
      setSelectedParties([]);
      setPartyLaminates({});
      setNewTrip({ priority: "medium", notes: "" });
      Alert.alert("Success", "Trip created successfully");
    } catch (error) {
      console.error("Error creating trip:", error);
      Alert.alert("Error", "Failed to create trip");
    }
  };

  const getDriverName = (uid: string) => {
    const driver = drivers.find((d) => d.id === uid);
    return driver?.displayName || "Unknown";
  };

  const clearFilters = () => {
    setFilterDate(null);
    setFilterDriver(null);
    setFilterParty(null);
  };

  const handleDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === "android") setShowDatePicker(false);

    if (event.type === "set" && selectedDate) {
      const formatted =
        String(selectedDate.getDate()).padStart(2, "0") +
        "-" +
        String(selectedDate.getMonth() + 1).padStart(2, "0") +
        "-" +
        selectedDate.getFullYear();
      setFilterDate(formatted);
    } else if (event.type === "dismissed") {
      setShowDatePicker(false);
    }
  };

  const getDateObj = (dateStr: string) => {
    const [d, m, y] = dateStr.split("-");
    return new Date(Number(y), Number(m) - 1, Number(d));
  };

  const renderTrip = ({ item }: { item: Trip }) => {
    const navInfo = getDynamicNavigationInfo(item);
    const isActive = item.status === "in_progress";
    const isHistory = item.status === "completed";
    const isPlanned = item.status === "planned";
    const isExpanded = expandedTripIds.includes(item.id) || isActive;
    const driverName = getDriverName(item.userId) || "Unknown Driver";

    const partiesPreview =
      item.stops?.map((s) => s.partyName).join(", ") || "No parties";

    return (
      <TouchableOpacity
        style={[styles.tripCard, isActive && styles.activeTripCard]}
        onPress={() => toggleExpandTrip(item.id)}
        activeOpacity={0.8}
      >
        <View style={styles.tripHeader}>
          <View style={{ flex: 1 }}>
            <View style={styles.titleRow}>
              <Text style={styles.tripTitle}>Trip #{item.id.slice(-6)}</Text>
              <StatusBadge status={item.status} />
            </View>
            <Text style={styles.tripDate}>{item.date || "No date"}</Text>

            {!isExpanded && (
              <Text style={styles.previewText} numberOfLines={2}>
                <Text style={{ fontWeight: "600" }}>
                  🚗 {driverName}
                  {"\n"}
                </Text>
                <Text style={{ fontWeight: "600" }}>Parties: </Text>
                {partiesPreview}
              </Text>
            )}
          </View>
          {isPlanned && (
            <TouchableOpacity
              style={styles.startBtn}
              onPress={() => handleStartTrip(item.id)}
            >
              <Text style={styles.startBtnText}>Start Trip</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.expandIcon}>{isExpanded ? "▲" : "▼"}</Text>
        </View>

        {isExpanded && (
          <View style={styles.expandedContent}>
            <View style={styles.tripMeta}>
              <Text style={styles.metaText}>🚗 {driverName}</Text>
              <Text style={styles.metaText}>
                📍 {item.stops?.length || 0} stops
              </Text>
              <Text style={styles.metaText}>
                📏 Planned {Math.round(getPlannedDistanceKm(item))} km · ⏱️{" "}
                {formatDurationMinutes(getPlannedDurationMinutes(item))}
              </Text>
              {(isHistory || isActive) && (
                <Text style={styles.metaText}>
                  🛣️ Actual {Math.round(getActualDistanceKm(item))} km · ⏱️{" "}
                  {formatDurationMinutes(getActualDurationMinutes(item, nowMs))}
                </Text>
              )}
            </View>

            {/* In Progress Status Bar */}
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
                <Text style={styles.progressPercent}>
                  {item.completionPercentage || 0}%
                </Text>
              </View>
            )}

            {navInfo && isActive && (
              <View style={styles.navInfo}>
                <View style={styles.navRow}>
                  <Text style={styles.navLabel}>Driver Heading To</Text>
                  <Text style={styles.navValue}>
                    {navInfo.nextStop?.partyName || "N/A"}
                  </Text>
                </View>
                <View style={styles.navRow}>
                  <Text style={styles.navLabel}>Distance to Next</Text>
                  <Text style={styles.navValue}>
                    {navInfo.distanceToNext} km
                  </Text>
                </View>
                <View style={styles.navRow}>
                  <Text style={styles.navLabel}>Total Remaining</Text>
                  <Text style={styles.navValue}>
                    {navInfo.totalRemainingDistance} km
                  </Text>
                </View>
                <View style={styles.navRow}>
                  <Text style={styles.navLabel}>ETA Overall</Text>
                  <Text style={styles.navValue}>{navInfo.etaTotal} min</Text>
                </View>
              </View>
            )}

            {item.notes && (
              <Text style={styles.tripNotes}>📝 {item.notes}</Text>
            )}

            <View style={styles.stopsList}>
              {item.stops?.map((stop: any, index: number) => {
                const arrivalDate = stop.arrivalTime
                  ? stop.arrivalTime?.toDate
                    ? stop.arrivalTime.toDate()
                    : stop.arrivalTime?.seconds
                      ? new Date(stop.arrivalTime.seconds * 1000)
                      : null
                  : null;
                const isPending = stop.status === "pending";
                const isFirstPending =
                  isPending &&
                  item.stops.findIndex((s: any) => s.status === "pending") ===
                    index;

                return (
                  <View key={index} style={styles.stopContainerItem}>
                    <View style={styles.stopMainRow}>
                      <View
                        style={[
                          styles.stopNumber,
                          stop.status === "delivered" && {
                            backgroundColor: "#34C759",
                          },
                        ]}
                      >
                        <Text style={styles.stopNumberText}>
                          {stop.status === "delivered" ? "✓" : index + 1}
                        </Text>
                      </View>

                      <View style={styles.stopInfo}>
                        <Text
                          style={[
                            styles.stopName,
                            stop.status === "delivered" && {
                              textDecorationLine: "line-through",
                              color: "#999",
                            },
                          ]}
                        >
                          {String(stop.partyName || "Unknown")}
                        </Text>
                        <Text style={styles.stopAddress}>
                          {String(stop.address || "No address")}
                        </Text>
                        {(stop.laminateQuantity ?? 0) > 0 && (
                          <Text style={styles.stopLaminate}>
                            📦 {stop.laminateQuantity} laminates
                          </Text>
                        )}
                        {arrivalDate && (
                          <Text style={styles.stopTime}>
                            Delivered:{" "}
                            {arrivalDate.toLocaleTimeString("en-IN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </Text>
                        )}
                      </View>

                      {/* Manual sorting priority handles */}
                      {isActive && isPending && (
                        <View style={styles.orderControls}>
                          <TouchableOpacity
                            onPress={() =>
                              handleReorderStops(item.id, index, "up")
                            }
                            style={styles.orderBtn}
                          >
                            <Text style={styles.orderBtnText}>▲</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() =>
                              handleReorderStops(item.id, index, "down")
                            }
                            style={styles.orderBtn}
                          >
                            <Text style={styles.orderBtnText}>▼</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>

                    {/* Auto-detected Delivery Unlock */}
                    {isActive && isFirstPending && (
                      <View style={styles.actionRow}>
                        <TouchableOpacity
                          style={[
                            styles.deliverBtn,
                            !isNearNextStop && styles.deliverBtnDisabled,
                          ]}
                          disabled={!isNearNextStop}
                          onPress={() => handleDelivered(item.id, index)}
                        >
                          <Text style={styles.deliverBtnText}>
                            {isNearNextStop
                              ? "✅ Mark Delivered"
                              : "🚗 Drive closer to deliver"}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>

            {/* STATIC MINIMAP ONLY FOR UPCOMING TRIPS */}
            {!isHistory &&
              !isActive &&
              item.stops &&
              item.stops.length >= 1 && (
                <View style={styles.routeMap}>
                  <MapView
                    style={styles.miniMap}
                    provider={PROVIDER_GOOGLE}
                    scrollEnabled={false}
                    zoomEnabled={false}
                    initialRegion={{
                      latitude: getDepotOrigin().latitude,
                      longitude: getDepotOrigin().longitude,
                      latitudeDelta: 0.5,
                      longitudeDelta: 0.5,
                    }}
                  >
                    <PlannedRouteDirections
                      stops={item.stops}
                      strokeWidth={3}
                    />
                    {item.stops?.map((stop: any, idx: number) => (
                      <Marker
                        key={idx}
                        coordinate={{
                          latitude: stop.latitude,
                          longitude: stop.longitude,
                        }}
                        pinColor={
                          stop.status === "delivered" ? "#34C759" : "#FF9500"
                        }
                      />
                    )) || []}
                  </MapView>
                </View>
              )}

            <TouchableOpacity
              style={styles.openMapBtn}
              onPress={(e) => {
                e.stopPropagation();
                setSelectedTrip(item);
                setShowFullscreenMap(true);
              }}
            >
              <Text style={styles.openMapBtnText}>
                {isActive ? "🗺️ View Live Navigation" : "🗺️ View Full Map"}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const filteredHistoryTrips = completedTrips.filter((trip) => {
    let matches = true;
    if (filterDate && trip.date !== filterDate) matches = false;
    if (filterDriver && trip.userId !== filterDriver) matches = false;
    if (filterParty) {
      const hasParty = trip.stops?.some((stop) => stop.partyId === filterParty);
      if (!hasParty) matches = false;
    }
    return matches;
  });

  const tripsToShow = tab === "upcoming" ? upcomingTrips : filteredHistoryTrips;

  // Logic for the Fullscreen Modal
  const pendingStopsForMap =
    selectedTrip?.stops?.filter((s: any) => s.status === "pending") || [];
  const destinationStop =
    pendingStopsForMap.length > 0
      ? pendingStopsForMap[pendingStopsForMap.length - 1]
      : null;
  const modalNavInfo = selectedTrip
    ? getDynamicNavigationInfo(selectedTrip)
    : null;

  return (
    <View style={styles.container}>
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === "upcoming" && styles.tabBtnActive]}
          onPress={() => setTab("upcoming")}
        >
          <Text
            style={[styles.tabText, tab === "upcoming" && styles.tabTextActive]}
          >
            Upcoming ({upcomingTrips.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === "history" && styles.tabBtnActive]}
          onPress={() => setTab("history")}
        >
          <Text
            style={[styles.tabText, tab === "history" && styles.tabTextActive]}
          >
            History ({completedTrips.length})
          </Text>
        </TouchableOpacity>
      </View>

      {tab === "history" && (
        <View style={styles.filterBar}>
          <TouchableOpacity
            style={styles.filterBtn}
            onPress={() => setShowFilterModal(true)}
          >
            <Text style={styles.filterBtnText}>
              ⚙️ Filters{" "}
              {filterDate || filterDriver || filterParty ? "(Active)" : ""}
            </Text>
          </TouchableOpacity>
          {filterDate || filterDriver || filterParty ? (
            <TouchableOpacity style={styles.clearBtn} onPress={clearFilters}>
              <Text style={styles.clearBtnText}>Clear</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      <FlatList
        data={tripsToShow}
        renderItem={renderTrip}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>
              {tab === "upcoming"
                ? "No upcoming trips"
                : loadingHistory
                  ? "Loading history..."
                  : "No trip history found"}
            </Text>
          </View>
        }
        ListFooterComponent={
          tab === "history" && hasMoreHistory ? (
            <TouchableOpacity
              style={styles.loadMoreBtn}
              onPress={() => loadCompletedTrips(true)}
              disabled={loadingHistory}
            >
              <Text style={styles.loadMoreBtnText}>
                {loadingHistory ? "Loading..." : "Load more history"}
              </Text>
            </TouchableOpacity>
          ) : null
        }
      />

      {appUser?.role === "admin" && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => setShowAddModal(true)}
        >
          <Text style={styles.fabText}>+ New Trip</Text>
        </TouchableOpacity>
      )}

      {/* FILTER MODAL */}
      <Modal
        visible={showFilterModal}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Filter History</Text>
            <TouchableOpacity onPress={() => setShowFilterModal(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.label}>Select Date</Text>
            <View style={styles.filterRow}>
              <TouchableOpacity
                style={styles.dropdownSelector}
                onPress={() => setShowDatePicker(true)}
              >
                <Text
                  style={[
                    styles.dropdownSelectorText,
                    !filterDate && { color: "#999" },
                  ]}
                >
                  {filterDate || "Select a date"}
                </Text>
              </TouchableOpacity>
              {filterDate && (
                <TouchableOpacity
                  style={styles.inlineClearBtn}
                  onPress={() => setFilterDate(null)}
                >
                  <Text style={styles.clearIcon}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.label}>Select Driver</Text>
            <View style={styles.filterRow}>
              <TouchableOpacity
                style={styles.dropdownSelector}
                onPress={() => setShowDriverPicker(true)}
              >
                <Text
                  style={[
                    styles.dropdownSelectorText,
                    !filterDriver && { color: "#999" },
                  ]}
                >
                  {filterDriver
                    ? drivers.find((d) => d.id === filterDriver)?.displayName ||
                      "Unknown"
                    : "Select a driver"}
                </Text>
              </TouchableOpacity>
              {filterDriver && (
                <TouchableOpacity
                  style={styles.inlineClearBtn}
                  onPress={() => setFilterDriver(null)}
                >
                  <Text style={styles.clearIcon}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.label}>Select Party</Text>
            <View style={styles.filterRow}>
              <TouchableOpacity
                style={styles.dropdownSelector}
                onPress={() => setShowPartyPicker(true)}
              >
                <Text
                  style={[
                    styles.dropdownSelectorText,
                    !filterParty && { color: "#999" },
                  ]}
                >
                  {filterParty
                    ? parties.find((p) => p.id === filterParty)?.name ||
                      "Unknown"
                    : "Select a party"}
                </Text>
              </TouchableOpacity>
              {filterParty && (
                <TouchableOpacity
                  style={styles.inlineClearBtn}
                  onPress={() => setFilterParty(null)}
                >
                  <Text style={styles.clearIcon}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity
              style={styles.saveButton}
              onPress={() => setShowFilterModal(false)}
            >
              <Text style={styles.saveButtonText}>Apply Filters</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.saveButton,
                { backgroundColor: "#F44336", marginTop: 12 },
              ]}
              onPress={clearFilters}
            >
              <Text style={styles.saveButtonText}>Clear All Filters</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* DATE PICKER */}
      {showDatePicker && (
        <DateTimePicker
          value={filterDate ? getDateObj(filterDate) : new Date()}
          mode="date"
          display="default"
          onChange={handleDateChange}
        />
      )}

      {/* SEARCHABLE SELECTION DROPDOWNS */}
      <SearchablePicker
        visible={showDriverPicker}
        onClose={() => setShowDriverPicker(false)}
        data={drivers.map((d) => ({
          label: d.displayName || "Unknown",
          value: d.id,
        }))}
        onSelect={setFilterDriver}
        title="Search Drivers"
        placeholder="Type driver name..."
      />

      <SearchablePicker
        visible={showPartyPicker}
        onClose={() => setShowPartyPicker(false)}
        data={parties.map((p) => ({ label: p.name || "Unknown", value: p.id }))}
        onSelect={setFilterParty}
        title="Search Parties"
        placeholder="Type party name..."
      />

      {/* CREATE NEW TRIP MODAL */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Create New Trip</Text>
            <TouchableOpacity onPress={() => setShowAddModal(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Priority</Text>
          <View style={styles.priorityRow}>
            {PRIORITIES.map((p) => (
              <TouchableOpacity
                key={p}
                style={[
                  styles.priorityChip,
                  newTrip.priority === p && styles.priorityChipActive,
                ]}
                onPress={() => setNewTrip({ ...newTrip, priority: p })}
              >
                <Text
                  style={[
                    styles.priorityText,
                    newTrip.priority === p && styles.priorityTextActive,
                  ]}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Assign Driver</Text>
          {drivers.map((driver) => (
            <TouchableOpacity
              key={driver.id}
              style={[
                styles.driverRow,
                selectedDrivers.includes(driver.id) && styles.driverRowSelected,
              ]}
              onPress={() => {
                setSelectedDrivers((prev) =>
                  prev.includes(driver.id)
                    ? prev.filter((id) => id !== driver.id)
                    : [...prev, driver.id],
                );
              }}
            >
              <Text style={styles.driverName}>
                {driver.displayName || "Unknown"}
              </Text>
              <Text style={styles.driverCheck}>
                {selectedDrivers.includes(driver.id) ? "✓" : "○"}
              </Text>
            </TouchableOpacity>
          ))}

          <Text style={styles.label}>Select Parties & Laminate Qty</Text>
          <ScrollView style={{ maxHeight: 260 }}>
            {parties.map((party) => {
              const isSelected = selectedParties.includes(party.id);
              return (
                <View key={party.id}>
                  <TouchableOpacity
                    style={[
                      styles.partyRow,
                      isSelected && styles.partyRowSelected,
                    ]}
                    onPress={() => {
                      setSelectedParties((prev) =>
                        prev.includes(party.id)
                          ? prev.filter((id) => id !== party.id)
                          : [...prev, party.id],
                      );
                    }}
                  >
                    <Text style={styles.partyName}>
                      {party.name || "Unknown"}
                    </Text>
                    <Text style={styles.partyCheck}>
                      {isSelected ? "✓" : "○"}
                    </Text>
                  </TouchableOpacity>
                  {isSelected && (
                    <View style={styles.laminateInputRow}>
                      <Text style={styles.laminateLabel}>Laminates (qty):</Text>
                      <TextInput
                        style={styles.laminateInput}
                        value={partyLaminates[party.id] || ""}
                        onChangeText={(v) =>
                          setPartyLaminates((prev) => ({
                            ...prev,
                            [party.id]: v.replace(/[^0-9]/g, ""),
                          }))
                        }
                        placeholder="0"
                        keyboardType="numeric"
                        returnKeyType="done"
                      />
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>

          <TextInput
            style={[styles.input, { height: 80 }]}
            placeholder="Notes"
            value={newTrip.notes}
            onChangeText={(v) => setNewTrip({ ...newTrip, notes: v })}
            multiline
          />

          <TouchableOpacity
            style={styles.saveButton}
            onPress={handleCreateTrip}
          >
            <Text style={styles.saveButtonText}>Create Trip</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* GOOGLE MAPS DIRECT STREET NAVIGATION MODAL */}
      <Modal visible={showFullscreenMap} animationType="fade">
        <View style={styles.fullscreenContainer}>
          <MapView
            ref={mapRef}
            style={styles.fullscreenMap}
            provider={PROVIDER_GOOGLE}
            showsUserLocation={false}
            showsMyLocationButton={false}
            showsTraffic={true}
            showsBuildings={true}
            showsCompass={true}
            pitchEnabled={true}
            rotateEnabled={true}
            loadingEnabled={true}
            initialRegion={{
              latitude:
                currentLocation?.coords.latitude ||
                selectedTrip?.stops?.[0]?.latitude ||
                20.5937,
              longitude:
                currentLocation?.coords.longitude ||
                selectedTrip?.stops?.[0]?.longitude ||
                78.9629,
              latitudeDelta: 0.05,
              longitudeDelta: 0.05,
            }}
          >
            {/* Custom animated vehicle marker — rotation handled natively by Marker, NOT by Image transform */}
            {selectedTrip?.status === "in_progress" && currentLocation && (
              <Marker.Animated
                coordinate={animatedLocation as any}
                anchor={{ x: 0.5, y: 0.5 }}
                rotation={currentLocation.coords.heading || 0}
                flat={true}
                tracksViewChanges={false}
                zIndex={100}
              >
                <Image
                  source={require("../../assets/images/auto.jpg")}
                  style={{ width: 40, height: 40 }}
                />
              </Marker.Animated>
            )}

            {/* Destination stop markers */}
            {selectedTrip?.stops?.map((stop: any, idx: number) => (
              <Marker
                key={`stop-${selectedTrip.id}-${idx}`}
                coordinate={{
                  latitude: stop.latitude,
                  longitude: stop.longitude,
                }}
                pinColor={stop.status === "delivered" ? "#34C759" : "#FF9500"}
                title={stop.partyName}
                description={
                  (stop.laminateQuantity ?? 0) > 0
                    ? `📦 ${stop.laminateQuantity} laminates`
                    : undefined
                }
              />
            )) || []}

            {/* Live road route — uses debounced routeOrigin to avoid flickering on every location ping */}
            {selectedTrip?.status === "in_progress" &&
            routeOrigin &&
            destinationStop &&
            GOOGLE_MAPS_API_KEY ? (
              <MapViewDirections
                origin={routeOrigin}
                destination={{
                  latitude: destinationStop.latitude,
                  longitude: destinationStop.longitude,
                }}
                waypoints={pendingStopsForMap.slice(0, -1).map((s: any) => ({
                  latitude: s.latitude,
                  longitude: s.longitude,
                }))}
                apikey={GOOGLE_MAPS_API_KEY}
                strokeWidth={6}
                strokeColor="#007AFF"
                mode="DRIVING"
                optimizeWaypoints={false}
              />
            ) : (
              selectedTrip?.stops &&
              selectedTrip.stops.length >= 2 && (
                <PlannedRouteDirections
                  stops={selectedTrip.stops}
                  strokeWidth={5}
                />
              )
            )}
          </MapView>

          {/* Recenter Button (Like Google Maps) */}
          {selectedTrip?.status === "in_progress" && currentLocation && (
            <TouchableOpacity
              style={styles.recenterBtn}
              onPress={() => {
                mapRef.current?.animateCamera({
                  center: {
                    latitude: currentLocation.coords.latitude,
                    longitude: currentLocation.coords.longitude,
                  },
                  pitch: 75,
                  heading: currentLocation.coords.heading || 0,
                  zoom: 18,
                });
              }}
            >
              <Text style={styles.recenterIcon}>🧭</Text>
            </TouchableOpacity>
          )}

          {/* Top Heads-Up Street Directory Overlay Card */}
          {modalNavInfo && selectedTrip?.status === "in_progress" && (
            <View style={styles.topNavOverlay}>
              <View style={styles.navHeaderCard}>
                <Text style={styles.navDirectionText}>
                  Next Action: Head {modalNavInfo.bearingDirection} to{" "}
                  <Text style={{ fontWeight: "700" }}>
                    {modalNavInfo.nextStop?.partyName}
                  </Text>
                </Text>
                <Text style={styles.navSubText}>
                  {modalNavInfo.nextStop?.address}
                </Text>
                <View style={styles.etaRow}>
                  <Text style={styles.etaHighlight}>
                    {modalNavInfo.etaNext} min
                  </Text>
                  <Text style={styles.etaDistance}>
                    ({modalNavInfo.distanceToNext} km)
                  </Text>
                </View>
              </View>
            </View>
          )}

          {/* Bottom Diagnostics Overlay Data Metrics Strip */}
          {modalNavInfo && selectedTrip?.status === "in_progress" && (
            <View style={styles.bottomNavOverlay}>
              <View style={styles.bottomStatsCard}>
                <View style={styles.statBox}>
                  <Text style={styles.statValue}>
                    {modalNavInfo.currentSpeed}
                  </Text>
                  <Text style={styles.statLabel}>km/h</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statBox}>
                  <Text style={styles.statValue}>
                    {modalNavInfo.etaTotal} min
                  </Text>
                  <Text style={styles.statLabel}>overall ETA</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statBox}>
                  <Text style={styles.statValue}>
                    {modalNavInfo.totalRemainingDistance}
                  </Text>
                  <Text style={styles.statLabel}>km total left</Text>
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
  container: { flex: 1, backgroundColor: "#F5F5F5" },
  tabContainer: {
    flexDirection: "row",
    backgroundColor: "#FFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  tabBtn: { flex: 1, paddingVertical: 14, alignItems: "center" },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: "#007AFF" },
  tabText: { fontSize: 15, color: "#666" },
  tabTextActive: { color: "#007AFF", fontWeight: "600" },
  filterBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#FFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  filterBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: "#F0F8FF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#007AFF",
  },
  filterBtnText: { color: "#007AFF", fontSize: 13, fontWeight: "600" },
  clearBtn: { paddingVertical: 6, paddingHorizontal: 12 },
  clearBtnText: { color: "#F44336", fontSize: 13, fontWeight: "600" },
  list: { padding: 12, gap: 12 },
  tripCard: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  activeTripCard: { borderWidth: 2, borderColor: "#007AFF" },
  tripHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 4,
  },
  tripTitle: { fontSize: 16, fontWeight: "600", color: "#333" },
  tripDate: { fontSize: 13, color: "#666", marginTop: 2 },
  previewText: { fontSize: 13, color: "#666", marginTop: 8, paddingRight: 8 },
  expandIcon: { fontSize: 12, color: "#999", paddingLeft: 8, marginTop: 4 },
  expandedContent: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#F0F0F0",
  },
  tripMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    marginBottom: 12,
  },
  metaText: { fontSize: 13, color: "#666", fontWeight: "500" },
  navInfo: {
    backgroundColor: "#F0F8FF",
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    gap: 4,
  },
  navRow: { flexDirection: "row", justifyContent: "space-between" },
  navLabel: { fontSize: 12, color: "#666" },
  navValue: { fontSize: 12, color: "#007AFF", fontWeight: "500" },
  tripNotes: { fontSize: 12, color: "#999", marginBottom: 12 },
  progressSection: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  progressBarBg: {
    flex: 1,
    height: 6,
    backgroundColor: "#E0E0E0",
    borderRadius: 3,
    overflow: "hidden",
    marginRight: 8,
  },
  progressBarFill: {
    height: "100%",
    backgroundColor: "#34C759",
    borderRadius: 3,
  },
  progressPercent: { fontSize: 13, fontWeight: "600", color: "#34C759" },

  stopsList: { gap: 8, marginBottom: 12 },
  stopContainerItem: {
    backgroundColor: "#F9F9F9",
    padding: 10,
    borderRadius: 8,
    marginVertical: 2,
  },
  stopMainRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  stopNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#007AFF",
    justifyContent: "center",
    alignItems: "center",
  },
  stopNumberText: { color: "#FFF", fontSize: 12, fontWeight: "600" },
  stopInfo: { flex: 1 },
  stopName: { fontSize: 14, fontWeight: "500", color: "#333" },
  stopAddress: { fontSize: 11, color: "#999", marginBottom: 4 },
  stopTime: { fontSize: 11, color: "#666", marginTop: 2 },
  stopLaminate: {
    fontSize: 11,
    color: "#FF9500",
    fontWeight: "600",
    marginTop: 1,
  },
  laminateInputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF9F0",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#F0E0C0",
    gap: 8,
  },
  laminateLabel: { fontSize: 13, color: "#888", flex: 1 },
  laminateInput: {
    width: 80,
    backgroundColor: "#FFF",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#FF9500",
    padding: 8,
    fontSize: 15,
    textAlign: "center",
    color: "#333",
  },

  orderControls: { flexDirection: "row", gap: 4 },
  orderBtn: {
    backgroundColor: "#E0E0E0",
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  orderBtnText: { fontSize: 14, color: "#333" },

  actionRow: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#E0E0E0",
    paddingTop: 8,
  },
  deliverBtn: {
    backgroundColor: "#34C759",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  deliverBtnDisabled: { backgroundColor: "#A5D6A7" },
  deliverBtnText: { color: "#FFF", fontWeight: "700", fontSize: 14 },

  routeMap: {
    height: 150,
    borderRadius: 8,
    overflow: "hidden",
    marginBottom: 12,
  },
  miniMap: { flex: 1 },
  openMapBtn: {
    backgroundColor: "#F0F8FF",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#007AFF",
  },
  openMapBtnText: { color: "#007AFF", fontSize: 15, fontWeight: "700" },

  emptyState: { padding: 40, alignItems: "center" },
  emptyText: { fontSize: 16, color: "#999" },
  loadMoreBtn: {
    marginTop: 8,
    marginBottom: 24,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#FFF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  loadMoreBtnText: { color: "#007AFF", fontSize: 15, fontWeight: "600" },
  fab: {
    position: "absolute",
    bottom: 24,
    right: 24,
    backgroundColor: "#007AFF",
    borderRadius: 28,
    paddingVertical: 14,
    paddingHorizontal: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  fabText: { color: "#FFF", fontSize: 16, fontWeight: "600" },

  modal: { flex: 1, backgroundColor: "#F5F5F5", padding: 20 },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  modalTitle: { fontSize: 22, fontWeight: "700", color: "#333" },
  modalClose: { fontSize: 24, color: "#999", padding: 8 },
  input: {
    backgroundColor: "#FFF",
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    borderWidth: 1,
    borderColor: "#E0E0E0",
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
    marginBottom: 8,
    marginTop: 16,
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  dropdownSelector: {
    flex: 1,
    backgroundColor: "#FFF",
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E0E0E0",
    justifyContent: "center",
  },
  dropdownSelectorText: { fontSize: 15, color: "#333" },
  inlineClearBtn: {
    backgroundColor: "#FFEBEB",
    padding: 12,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  clearIcon: { fontSize: 16, color: "#F44336", fontWeight: "bold" },
  priorityRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  priorityChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  priorityChipActive: { backgroundColor: "#FF9500", borderColor: "#FF9500" },
  priorityText: { fontSize: 13, color: "#666" },
  priorityTextActive: { color: "#FFF" },
  driverRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#FFF",
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  driverRowSelected: { borderColor: "#007AFF", backgroundColor: "#F0F8FF" },
  driverName: { fontSize: 15, color: "#333" },
  driverCheck: { fontSize: 18, color: "#007AFF" },
  partyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#FFF",
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  partyRowSelected: { borderColor: "#007AFF", backgroundColor: "#F0F8FF" },
  partyName: { fontSize: 15, color: "#333" },
  partyCheck: { fontSize: 18, color: "#007AFF" },
  saveButton: {
    backgroundColor: "#007AFF",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    marginTop: 24,
  },
  saveButtonText: { color: "#FFF", fontSize: 17, fontWeight: "600" },

  dropdownOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  dropdownContent: {
    backgroundColor: "#FFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "80%",
    padding: 20,
  },
  dropdownHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  dropdownTitle: { fontSize: 18, fontWeight: "700", color: "#333" },
  dropdownClose: { fontSize: 22, color: "#999", padding: 4 },
  searchInput: {
    backgroundColor: "#F5F5F5",
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    marginBottom: 16,
  },
  dropdownItem: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  dropdownItemText: { fontSize: 16, color: "#333" },
  emptySearchText: {
    textAlign: "center",
    color: "#999",
    marginTop: 20,
    fontSize: 15,
  },

  // Navigation Map Overlays
  fullscreenContainer: { flex: 1 },
  fullscreenMap: { flex: 1 },
  rickshawMarker: {
    width: 36,
    height: 36,
    backgroundColor: "#FFF",
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  rickshawText: { fontSize: 20 },
  topNavOverlay: {
    position: "absolute",
    top: 50,
    left: 16,
    right: 16,
    zIndex: 20,
  },
  navHeaderCard: {
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  navDirectionText: {
    fontSize: 16,
    color: "#333",
    marginBottom: 4,
    lineHeight: 22,
  },
  navSubText: { fontSize: 13, color: "#666", marginBottom: 8 },
  etaRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  etaHighlight: { fontSize: 28, fontWeight: "800", color: "#34C759" },
  etaDistance: { fontSize: 16, color: "#666", fontWeight: "500" },

  bottomNavOverlay: {
    position: "absolute",
    bottom: 40,
    left: 16,
    right: 16,
    zIndex: 10,
  },
  bottomStatsCard: {
    flexDirection: "row",
    backgroundColor: "rgba(30, 30, 30, 0.9)",
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    alignItems: "center",
    justifyContent: "space-evenly",
  },
  statBox: { alignItems: "center", flex: 1 },
  statValue: { fontSize: 22, fontWeight: "700", color: "#FFF" },
  statLabel: { fontSize: 11, color: "#AAA", marginTop: 2, textAlign: "center" },
  statDivider: { width: 1, height: 30, backgroundColor: "#555" },

  closeFullscreenBtn: {
    position: "absolute",
    top: 10,
    right: 16,
    backgroundColor: "#FFF",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
    zIndex: 20,
  },
  closeFullscreenBtnText: { fontSize: 14, color: "#333", fontWeight: "700" },

  recenterBtn: {
    position: "absolute",
    bottom: 160,
    right: 16,
    backgroundColor: "#FFF",
    borderRadius: 25,
    width: 50,
    height: 50,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    elevation: 5,
  },
  recenterIcon: { fontSize: 24 },

  startBtn: {
    backgroundColor: "#34C759",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 10,
  },

  startBtnText: {
    color: "#FFF",
    fontWeight: "600",
    fontSize: 13,
  },
});
