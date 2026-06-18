import { Timestamp, GeoPoint } from 'firebase/firestore';

// ==================== ROLES ====================
export type UserRole = 'admin' | 'driver' | 'salesman' | 'customer';

export interface AppUser {
  uid: string;
  email?: string;
  displayName: string;
  role: UserRole;
  phoneNumber?: string;
  photoURL?: string;
  createdAt: Timestamp;
  isActive: boolean;
}

export interface DailyRideSummary {
  id?: string;
  driverId: string;
  driverName: string;
  date: string;
  totalDistanceKm: number;
  totalTrips: number;
  totalStops: number;
  totalLaminatesDelivered?: number;
  earnings: number;
  status: 'pending' | 'paid' | 'confirmed';
  paidAt?: number;
  confirmedAt?: number;
  createdAt: number;
  updatedAt: number;
}

// ==================== PARTY ====================
export interface Party {
  id: string;
  name: string;
  ownerName: string;
  phoneNumber: string;
  phoneNumberNormalized?: string;
  alternatePhone?: string;
  address: string;
  latitude: number;
  longitude: number;
  notes?: string;
  category: PartyCategory;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  isApproved: boolean;
  trackingId?: string;
  customerUserId?: string; // Link to customer user account
}

export type PartyCategory =
  | 'retail'
  | 'wholesale'
  | 'distributor'
  | 'supermarket'
  | 'restaurant'
  | 'other';

// ==================== TRIP ====================
export interface Trip {
  id: string;
  userId: string;
  userRole: UserRole;
  date: string;
  status: TripStatus;
  stops: TripStop[];
  /** Planned optimized route distance from Google Directions (km). */
  totalDistance: number;
  totalDuration: number; // minutes
  totalLaminateQuantity?: number;
  /** Live GPS odometer during an active trip (km). */
  distanceCovered: number;
  distanceRemaining: number;
  /** Final GPS odometer distance set when the trip completes (km). */
  actualDistanceKm?: number;
  /** Final elapsed time from trip start to completion (minutes). */
  actualDurationMinutes?: number;
  completedStops: number;
  pendingStops: number;
  estimatedArrivalTime?: string;
  notes?: string;
  completionPercentage: number;
  startedAt?: Timestamp;
  completedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface TripStop {
  partyId: string;
  partyName: string;
  address: string;
  latitude: number;
  longitude: number;
  order: number;
  status: StopStatus;
  laminateQuantity?: number;
  arrivalTime?: Timestamp;
  departureTime?: Timestamp;
  durationSpent?: number; // minutes
  visitNotes?: string;
  visitOutcome?: VisitOutcome;
  photos?: string[];
  followUpDate?: Timestamp;
}

export type TripStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';
  export type StopStatus = 'pending' | 'arrived' | 'departed' | 'skipped' | 'delivered';

// ==================== DELIVERY TRACKING ====================
export type DeliveryTrackingStatus = 'waiting' | 'out_for_delivery' | 'delivered';

export interface DeliveryTracking {
  id?: string;
  tripId: string;
  partyId: string;
  trackingId: string;
  customerPhone?: string;
  driverId: string;
  trackingEnabled: boolean;
  status: DeliveryTrackingStatus;
  etaMinutes?: number;
  currentDriverLatitude?: number;
  currentDriverLongitude?: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type VisitOutcome =
  | 'interested'
  | 'follow_up'
  | 'existing_customer'
  | 'new_lead'
  | 'not_interested';

export interface PolylinePoint {
  latitude: number;
  longitude: number;
}

// ==================== DELIVERY ====================
export interface Delivery {
  id: string;
  deliveryNumber: string;
  customer: string;
  products: DeliveryProduct[];
  notes?: string;
  priority: DeliveryPriority;
  status: DeliveryStatus;
  assignedDrivers: string[]; // UIDs of potential drivers
  acceptedBy?: string; // UID of driver who accepted
  route?: PolylinePoint[];
  startedAt?: Timestamp;
  deliveredAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface DeliveryProduct {
  name: string;
  quantity: number;
  unit: string;
}

export type DeliveryPriority = 'low' | 'medium' | 'high' | 'urgent';
export type DeliveryStatus =
  | 'pending'
  | 'accepted'
  | 'in_transit'
  | 'delivered'
  | 'failed';

// ==================== LEAD ====================
export interface Lead {
  id: string;

  name: string;
  ownerName?: string;

  phoneNumber: string;
  alternatePhone?: string;

  address: string;
  notes?: string;

  category?: string;

  latitude?: number;
  longitude?: number;

  createdBy: string;
  createdAt: any;

  status: 'pending' | 'approved' | 'rejected';

  isApproved?: boolean;
}

export type LeadStatus = 'pending' | 'approved' | 'rejected';

// ==================== ATTENDANCE ====================
export interface Attendance {
  id: string;
  userId: string;
  date: string;
  checkIn?: Timestamp;
  checkOut?: Timestamp;
  workingHours?: number;
  breakTime?: number;
  activeTime?: number;
  geofenceLatitude?: number;
  geofenceLongitude?: number;
  geofenceRadius?: number;
}

export interface Geofence {
  latitude: number;
  longitude: number;
  radius: number; // meters
  name: string;
}

// ==================== LOCATION ====================
export interface UserLocation {
  uid: string;
  displayName: string;
  role: UserRole;
  latitude: number;
  longitude: number;
  timestamp: number;
  speed: number;
  heading: number;
  currentTrip?: string;
  isActive: boolean;
}

export interface LocationRecord {
  latitude: number;
  longitude: number;
  timestamp: number;
  speed: number;
  heading: number;
}

// ==================== DEVIATION ====================
export interface RouteDeviation {
  tripId: string;
  deviationDistance: number; // km
  deviationPercentage: number;
  deviationLocations: PolylinePoint[];
  detectedAt: Timestamp;
}

// ==================== ANALYTICS ====================
export interface DriverAnalytics {
  userId: string;
  date: string;
  deliveriesCompleted: number;
  distanceTravelled: number;
  totalTripHours: number;
  idleTime: number;
  averageDeliveryTime: number;
}

export interface SalesmanAnalytics {
  userId: string;
  date: string;
  partiesVisited: number;
  leadsCreated: number;
  timeSpentAtParties: number;
  distanceTravelled: number;
  productivityScore: number;
}
