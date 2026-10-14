import { GeoPoint } from '../interfaces/geo-location.interface';
/**
 * Geographic utility functions for distance calculations and geo-spatial operations.
 *
 * This file contains reusable functions for working with geographic coordinates,
 * particularly for calculating distances between points on the Earth's surface.
 */

/**
 * Calculates the great-circle distance between two points on the Earth's surface
 * using the Haversine formula.
 *
 * @param coords1 - First geographic point with latitude and longitude in degrees
 * @param coords2 - Second geographic point with latitude and longitude in degrees
 * @returns Distance between the two points in meters
 *
 * @example
 * ```typescript
 * const point1: GeoPoint = { latitude: 40.7128, longitude: -74.0060 }; // New York
 * const point2: GeoPoint = { latitude: 34.0522, longitude: -118.2437 }; // Los Angeles
 * const distance = haversineDistance(point1, point2); // ~3940000 meters
 * ```
 *
 * @notes
 * - Uses the Haversine formula which assumes a spherical Earth
 * - Earth's radius is set to 6371e3 meters (6,371 km)
 * - Input coordinates must be in decimal degrees
 * - Returns distance in meters
 */
export function haversineDistance(
  coords1: GeoPoint,
  coords2: GeoPoint,
): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const lat1 = coords1.latitude;
  const lon1 = coords1.longitude;
  const lat2 = coords2.latitude;
  const lon2 = coords2.longitude;

  const R = 6371e3; // Earth's radius in meters
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}
