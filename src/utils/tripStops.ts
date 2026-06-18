import { TripStop } from '../types';

interface PartyForStop {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  laminateQuantity?: number;
}

export function buildOrderedTripStops(parties: PartyForStop[], waypointIds: string[]): TripStop[] {
  const byId = new Map(parties.map((party) => [party.id, party]));

  return waypointIds
    .map((partyId) => byId.get(partyId))
    .filter((party): party is PartyForStop => Boolean(party))
    .map((party, index) => ({
      partyId: party.id,
      partyName: party.name || 'Unknown',
      address: party.address || '',
      latitude: party.latitude,
      longitude: party.longitude,
      order: index + 1,
      status: 'pending' as const,
      laminateQuantity: party.laminateQuantity || 0,
    }));
}
