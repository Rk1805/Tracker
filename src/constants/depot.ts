/** Fixed depot — all driver trips start from here. */
export const DEPOT_ADDRESS =
  'Do.no.77/1, Near Swayam Prabha Kalyana Mantapa Nanjundeshwara Nilaya Meenakshi Nagar 6th main, Police Station Rd, Kamakshipalya, Bengaluru, Karnataka 560079';

export const DEPOT_LOCATION = {
  latitude: 12.985994314394592,
  longitude: 77.53273418300074,
};

export function getDepotOrigin() {
  return DEPOT_LOCATION;
}
