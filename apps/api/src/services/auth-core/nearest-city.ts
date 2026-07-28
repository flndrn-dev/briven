/**
 * Offline nearest-city fallback when MaxMind returns country + lat/lon but no city.
 * Self-hosted only — no third-party HTTP geocoding (same rule as lib/geoip.ts).
 *
 * Dense coverage for Belgium (ops / common users); major world cities for everyone else.
 */

export type NearestCity = {
  name: string;
  region: string | null;
  country: string;
  lat: number;
  lon: number;
};

/** Curated cities used only when MaxMind city is empty. */
const CITIES: NearestCity[] = [
  // Belgium (dense — flndrn / mavi ops)
  { name: 'Brussels', region: 'Brussels', country: 'Belgium', lat: 50.8503, lon: 4.3517 },
  { name: 'Ghent', region: 'East Flanders', country: 'Belgium', lat: 51.0543, lon: 3.7174 },
  { name: 'Antwerp', region: 'Antwerp', country: 'Belgium', lat: 51.2194, lon: 4.4025 },
  { name: 'Bruges', region: 'West Flanders', country: 'Belgium', lat: 51.2093, lon: 3.2247 },
  { name: 'Leuven', region: 'Flemish Brabant', country: 'Belgium', lat: 50.8798, lon: 4.7005 },
  { name: 'Liège', region: 'Liège', country: 'Belgium', lat: 50.6326, lon: 5.5797 },
  { name: 'Namur', region: 'Namur', country: 'Belgium', lat: 50.4674, lon: 4.872 },
  { name: 'Charleroi', region: 'Hainaut', country: 'Belgium', lat: 50.4108, lon: 4.4446 },
  { name: 'Mons', region: 'Hainaut', country: 'Belgium', lat: 50.4542, lon: 3.9561 },
  { name: 'Mechelen', region: 'Antwerp', country: 'Belgium', lat: 51.0259, lon: 4.4776 },
  { name: 'Aalst', region: 'East Flanders', country: 'Belgium', lat: 50.9378, lon: 4.0409 },
  { name: 'Kortrijk', region: 'West Flanders', country: 'Belgium', lat: 50.827, lon: 3.2648 },
  { name: 'Ostend', region: 'West Flanders', country: 'Belgium', lat: 51.2154, lon: 2.9286 },
  { name: 'Hasselt', region: 'Limburg', country: 'Belgium', lat: 50.9307, lon: 5.3325 },
  // Neighbours / major EU
  { name: 'Amsterdam', region: 'North Holland', country: 'Netherlands', lat: 52.3676, lon: 4.9041 },
  { name: 'Rotterdam', region: 'South Holland', country: 'Netherlands', lat: 51.9244, lon: 4.4777 },
  { name: 'Paris', region: 'Île-de-France', country: 'France', lat: 48.8566, lon: 2.3522 },
  { name: 'Lille', region: 'Hauts-de-France', country: 'France', lat: 50.6292, lon: 3.0573 },
  { name: 'London', region: 'England', country: 'United Kingdom', lat: 51.5074, lon: -0.1278 },
  { name: 'Berlin', region: 'Berlin', country: 'Germany', lat: 52.52, lon: 13.405 },
  { name: 'Cologne', region: 'North Rhine-Westphalia', country: 'Germany', lat: 50.9375, lon: 6.9603 },
  { name: 'Frankfurt', region: 'Hesse', country: 'Germany', lat: 50.1109, lon: 8.6821 },
  { name: 'Munich', region: 'Bavaria', country: 'Germany', lat: 48.1351, lon: 11.582 },
  { name: 'Luxembourg City', region: null, country: 'Luxembourg', lat: 49.6116, lon: 6.1319 },
  { name: 'Madrid', region: 'Madrid', country: 'Spain', lat: 40.4168, lon: -3.7038 },
  { name: 'Barcelona', region: 'Catalonia', country: 'Spain', lat: 41.3874, lon: 2.1686 },
  { name: 'Rome', region: 'Lazio', country: 'Italy', lat: 41.9028, lon: 12.4964 },
  { name: 'Milan', region: 'Lombardy', country: 'Italy', lat: 45.4642, lon: 9.19 },
  { name: 'Vienna', region: 'Vienna', country: 'Austria', lat: 48.2082, lon: 16.3738 },
  { name: 'Zurich', region: 'Zurich', country: 'Switzerland', lat: 47.3769, lon: 8.5417 },
  { name: 'Geneva', region: 'Geneva', country: 'Switzerland', lat: 46.2044, lon: 6.1432 },
  { name: 'Dublin', region: 'Leinster', country: 'Ireland', lat: 53.3498, lon: -6.2603 },
  { name: 'Stockholm', region: 'Stockholm', country: 'Sweden', lat: 59.3293, lon: 18.0686 },
  { name: 'Oslo', region: 'Oslo', country: 'Norway', lat: 59.9139, lon: 10.7522 },
  { name: 'Copenhagen', region: 'Capital Region', country: 'Denmark', lat: 55.6761, lon: 12.5683 },
  { name: 'Warsaw', region: 'Masovian', country: 'Poland', lat: 52.2297, lon: 21.0122 },
  { name: 'Prague', region: 'Prague', country: 'Czechia', lat: 50.0755, lon: 14.4378 },
  { name: 'Lisbon', region: 'Lisbon', country: 'Portugal', lat: 38.7223, lon: -9.1393 },
  { name: 'Athens', region: 'Attica', country: 'Greece', lat: 37.9838, lon: 23.7275 },
  { name: 'Istanbul', region: 'Istanbul', country: 'Turkey', lat: 41.0082, lon: 28.9784 },
  // Americas / APAC (common)
  { name: 'New York', region: 'New York', country: 'United States', lat: 40.7128, lon: -74.006 },
  { name: 'Los Angeles', region: 'California', country: 'United States', lat: 34.0522, lon: -118.2437 },
  { name: 'Chicago', region: 'Illinois', country: 'United States', lat: 41.8781, lon: -87.6298 },
  { name: 'San Francisco', region: 'California', country: 'United States', lat: 37.7749, lon: -122.4194 },
  { name: 'Toronto', region: 'Ontario', country: 'Canada', lat: 43.6532, lon: -79.3832 },
  { name: 'Vancouver', region: 'British Columbia', country: 'Canada', lat: 49.2827, lon: -123.1207 },
  { name: 'Mexico City', region: 'Mexico City', country: 'Mexico', lat: 19.4326, lon: -99.1332 },
  { name: 'São Paulo', region: 'São Paulo', country: 'Brazil', lat: -23.5505, lon: -46.6333 },
  { name: 'Buenos Aires', region: 'Buenos Aires', country: 'Argentina', lat: -34.6037, lon: -58.3816 },
  { name: 'Tokyo', region: 'Tokyo', country: 'Japan', lat: 35.6762, lon: 139.6503 },
  { name: 'Seoul', region: 'Seoul', country: 'South Korea', lat: 37.5665, lon: 126.978 },
  { name: 'Singapore', region: null, country: 'Singapore', lat: 1.3521, lon: 103.8198 },
  { name: 'Hong Kong', region: null, country: 'Hong Kong', lat: 22.3193, lon: 114.1694 },
  { name: 'Sydney', region: 'New South Wales', country: 'Australia', lat: -33.8688, lon: 151.2093 },
  { name: 'Melbourne', region: 'Victoria', country: 'Australia', lat: -37.8136, lon: 144.9631 },
  { name: 'Auckland', region: 'Auckland', country: 'New Zealand', lat: -36.8509, lon: 174.7645 },
  { name: 'Dubai', region: 'Dubai', country: 'United Arab Emirates', lat: 25.2048, lon: 55.2708 },
  { name: 'Mumbai', region: 'Maharashtra', country: 'India', lat: 19.076, lon: 72.8777 },
  { name: 'Delhi', region: 'Delhi', country: 'India', lat: 28.7041, lon: 77.1025 },
  { name: 'Bangalore', region: 'Karnataka', country: 'India', lat: 12.9716, lon: 77.5946 },
  { name: 'Johannesburg', region: 'Gauteng', country: 'South Africa', lat: -26.2041, lon: 28.0473 },
  { name: 'Lagos', region: 'Lagos', country: 'Nigeria', lat: 6.5244, lon: 3.3792 },
  { name: 'Cairo', region: 'Cairo', country: 'Egypt', lat: 30.0444, lon: 31.2357 },
];

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Nearest curated city within maxKm of the MaxMind coordinate.
 * Returns null if nothing is close enough (avoids wild guesses).
 */
export function nearestCityFromCoords(
  lat: number,
  lon: number,
  maxKm = 120,
): NearestCity | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best: NearestCity | null = null;
  let bestKm = Infinity;
  for (const c of CITIES) {
    const d = haversineKm(lat, lon, c.lat, c.lon);
    if (d < bestKm) {
      bestKm = d;
      best = c;
    }
  }
  if (!best || bestKm > maxKm) return null;
  return best;
}
