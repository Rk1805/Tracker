import { PolylinePoint, TripStop } from '../types';

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';

interface DirectionsResponse {
  routes: {
    legs: {
      distance: { text: string; value: number };
      duration: { text: string; value: number };
      start_location: { lat: number; lng: number };
      end_location: { lat: number; lng: number };
      steps: {
        polyline: { points: string };
      }[];
    }[];
    overview_polyline: { points: string };
  }[];
}

class RouteService {
  private apiKey: string;

  constructor() {
    this.apiKey = GOOGLE_MAPS_API_KEY;
  }

  /**
   * Calculate optimized route between stops using Google Directions API
   */
  async calculateOptimizedRoute(
    origin: { latitude: number; longitude: number },
    stops: { latitude: number; longitude: number; id: string }[],
    destination?: { latitude: number; longitude: number }
  ): Promise<{
    waypoints: string[];
    totalDistance: number;
    totalDuration: number;
    polyline: PolylinePoint[];
  }> {
    if (stops.length === 0) {
      return { waypoints: [], totalDistance: 0, totalDuration: 0, polyline: [] };
    }

    // For 2+ stops, use waypoints optimization
    // For 1 stop, just get directions
    if (stops.length === 1) {
      return this.getDirectRoute(
        origin,
        stops[0],
        destination || stops[0]
      );
    }

    return this.getOptimizedRouteWithWaypoints(origin, stops, destination);
  }

  private async getDirectRoute(
    origin: { latitude: number; longitude: number },
    stop: { latitude: number; longitude: number; id: string },
    destination: { latitude: number; longitude: number }
  ) {
    const originStr = `${origin.latitude},${origin.longitude}`;
    const destStr = `${destination.latitude},${destination.longitude}`;

    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${originStr}&destination=${destStr}&key=${this.apiKey}`;

    try {
      const response = await fetch(url);
      const data: DirectionsResponse = await response.json();

      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const totalDistance = route.legs.reduce(
          (sum, leg) => sum + leg.distance.value,
          0
        );
        const totalDuration = route.legs.reduce(
          (sum, leg) => sum + leg.duration.value,
          0
        );
        const polyline = this.decodePolyline(route.overview_polyline.points);

        return {
          waypoints: [stop.id],
          totalDistance: Math.round((totalDistance / 1000) * 10) / 10, // km
          totalDuration: Math.round(totalDuration / 60), // minutes
          polyline,
        };
      }
    } catch (error) {
      console.error('Directions API error:', error);
    }

    // Fallback: calculate straight-line distance
    return this.fallbackRoute(origin, [stop], destination);
  }

  private async getOptimizedRouteWithWaypoints(
    origin: { latitude: number; longitude: number },
    stops: { latitude: number; longitude: number; id: string }[],
    destination?: { latitude: number; longitude: number }
  ) {
    const originStr = `${origin.latitude},${origin.longitude}`;
    const destStr = destination
      ? `${destination.latitude},${destination.longitude}`
      : `${stops[stops.length - 1].latitude},${stops[stops.length - 1].longitude}`;

    // Use waypoints for optimization (Google will reorder them optimally)
    const waypointsStr = stops
      .slice(0, -1)
      .map((s) => `${s.latitude},${s.longitude}`)
      .join('|');

    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${originStr}&destination=${destStr}&waypoints=optimize:true|${waypointsStr}&key=${this.apiKey}`;

    try {
      const response = await fetch(url);
      const data: DirectionsResponse = await response.json();

      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];

        // Get optimized waypoint order
        const waypointOrder = route.legs[0]?.steps
          ? Array.from(
              { length: stops.length },
              (_, i) => i
            )
          : stops.map((_, i) => i);

        // Calculate totals
        let totalDistance = 0;
        let totalDuration = 0;

        for (const leg of route.legs) {
          totalDistance += leg.distance.value;
          totalDuration += leg.duration.value;
        }

        const polyline = this.decodePolyline(route.overview_polyline.points);

        // Map waypoint order to stop IDs
        const waypoints = waypointOrder.map(
          (index: number) => stops[index].id
        );

        return {
          waypoints,
          totalDistance: Math.round((totalDistance / 1000) * 10) / 10,
          totalDuration: Math.round(totalDuration / 60),
          polyline,
        };
      }
    } catch (error) {
      console.error('Directions API error:', error);
    }

    return this.fallbackRoute(origin, stops, destination);
  }

  private async fallbackRoute(
    origin: { latitude: number; longitude: number },
    stops: { latitude: number; longitude: number; id: string }[],
    destination?: { latitude: number; longitude: number }
  ) {
    // Simple nearest-neighbor TSP approximation
    const unvisited = [...stops];
    const ordered: string[] = [];
    let current = origin;
    let totalDistance = 0;
    const polyline: PolylinePoint[] = [{ latitude: origin.latitude, longitude: origin.longitude }];

    while (unvisited.length > 0) {
      let nearest = 0;
      let minDist = Infinity;

      for (let i = 0; i < unvisited.length; i++) {
        const dist = this.haversineDistance(
          current.latitude,
          current.longitude,
          unvisited[i].latitude,
          unvisited[i].longitude
        );
        if (dist < minDist) {
          minDist = dist;
          nearest = i;
        }
      }

      const stop = unvisited[nearest];
      ordered.push(stop.id);
      totalDistance += minDist;
      polyline.push({
        latitude: stop.latitude,
        longitude: stop.longitude,
      });
      current = stop;
      unvisited.splice(nearest, 1);
    }

    return {
      waypoints: ordered,
      totalDistance: Math.round(totalDistance * 10) / 10,
      totalDuration: Math.round(totalDistance * 2), // rough estimate: 2 min per km
      polyline,
    };
  }

  /**
   * Decode Google Maps encoded polyline
   */
  private decodePolyline(encoded: string): PolylinePoint[] {
    const points: PolylinePoint[] = [];
    let index = 0;
    const len = encoded.length;
    let lat = 0;
    let lng = 0;

    while (index < len) {
      let b: number;
      let shift = 0;
      let result = 0;

      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);

      const dlat = result & 1 ? ~(result >> 1) : result >> 1;
      lat += dlat;

      shift = 0;
      result = 0;

      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);

      const dlng = result & 1 ? ~(result >> 1) : result >> 1;
      lng += dlng;

      points.push({
        latitude: lat / 1e5,
        longitude: lng / 1e5,
      });
    }

    return points;
  }

  /**
   * Haversine distance between two points in km
   */
  private haversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371;
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  /**
   * Calculate deviation between planned and actual route
   */
  calculateDeviation(
    plannedRoute: PolylinePoint[],
    actualRoute: PolylinePoint[],
    threshold: number = 0.1 // 100m threshold
  ): {
    deviationDistance: number;
    deviationPercentage: number;
    deviationPoints: PolylinePoint[];
  } {
    let totalDeviation = 0;
    const deviationPoints: PolylinePoint[] = [];

    // Sample points from actual route and compare to planned
    const sampleRate = Math.max(
      1,
      Math.floor(actualRoute.length / 50)
    );

    for (let i = 0; i < actualRoute.length; i += sampleRate) {
      const point = actualRoute[i];
      const minDistToPlanned = this.minDistanceToRoute(point, plannedRoute);

      if (minDistToPlanned > threshold) {
        totalDeviation += minDistToPlanned;
        deviationPoints.push(point);
      }
    }

    const totalPlannedDistance = this.calculateRouteDistance(plannedRoute);
    const deviationPercentage =
      totalPlannedDistance > 0
        ? Math.round((totalDeviation / totalPlannedDistance) * 100 * 10) / 10
        : 0;

    return {
      deviationDistance: Math.round(totalDeviation * 100) / 100,
      deviationPercentage,
      deviationPoints,
    };
  }

  private minDistanceToRoute(
    point: PolylinePoint,
    route: PolylinePoint[]
  ): number {
    let minDist = Infinity;

    for (let i = 0; i < route.length - 1; i++) {
      const dist = this.pointToSegmentDistance(
        point,
        route[i],
        route[i + 1]
      );
      if (dist < minDist) minDist = dist;
    }

    return minDist;
  }

  private pointToSegmentDistance(
    p: PolylinePoint,
    a: PolylinePoint,
    b: PolylinePoint
  ): number {
    const d = this.haversineDistance(a.latitude, a.longitude, b.latitude, b.longitude);
    if (d === 0) return this.haversineDistance(p.latitude, p.longitude, a.latitude, a.longitude);

    const t = Math.max(
      0,
      Math.min(
        1,
        ((p.latitude - a.latitude) * (b.latitude - a.latitude) +
          (p.longitude - a.longitude) * (b.longitude - a.longitude)) /
          (d * d)
      )
    );

    const proj: PolylinePoint = {
      latitude: a.latitude + t * (b.latitude - a.latitude),
      longitude: a.longitude + t * (b.longitude - a.longitude),
    };

    return this.haversineDistance(p.latitude, p.longitude, proj.latitude, proj.longitude);
  }

  private calculateRouteDistance(route: PolylinePoint[]): number {
    let distance = 0;
    for (let i = 0; i < route.length - 1; i++) {
      distance += this.haversineDistance(
        route[i].latitude,
        route[i].longitude,
        route[i + 1].latitude,
        route[i + 1].longitude
      );
    }
    return distance;
  }
}

export const routeService = new RouteService();