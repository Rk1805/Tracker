import React from 'react';
import MapViewDirections from 'react-native-maps-directions';
import { TripStop } from '../types';
import { getDepotOrigin } from '../constants/depot';

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';

interface PlannedRouteDirectionsProps {
  stops: TripStop[];
  strokeWidth?: number;
  strokeColor?: string;
}

export default function PlannedRouteDirections({
  stops,
  strokeWidth = 5,
  strokeColor = '#007AFF',
}: PlannedRouteDirectionsProps) {
  if (!GOOGLE_MAPS_API_KEY || stops.length === 0) return null;

  const depot = getDepotOrigin();
  const destination = stops[stops.length - 1];
  const waypoints = stops.slice(0, -1).map((stop) => ({
    latitude: stop.latitude,
    longitude: stop.longitude,
  }));

  return (
    <MapViewDirections
      origin={{ latitude: depot.latitude, longitude: depot.longitude }}
      destination={{ latitude: destination.latitude, longitude: destination.longitude }}
      waypoints={waypoints}
      apikey={GOOGLE_MAPS_API_KEY}
      strokeWidth={strokeWidth}
      strokeColor={strokeColor}
      mode="DRIVING"
      optimizeWaypoints={false}
    />
  );
}
