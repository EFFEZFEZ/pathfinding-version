/**
 * busPositionCalculator.js
 * * Calcule les positions géographiques interpolées des bus entre deux arrêts
 * * CORRIGÉ: S'adapte au tripScheduler V3 (qui retourne 'segment' ou 'position')
 */

export class BusPositionCalculator {
    constructor(dataManager) {
        this.dataManager = dataManager;
    }

    /**
     * Calcule la position interpolée d'un bus entre deux arrêts
     */
    calculatePosition(segment, routeId = null) {
        if (!segment || !segment.fromStopInfo || !segment.toStopInfo) {
            return null;
        }

        const fromLat = parseFloat(segment.fromStopInfo.stop_lat);
        const fromLon = parseFloat(segment.fromStopInfo.stop_lon);
        const toLat = parseFloat(segment.toStopInfo.stop_lat);
        const toLon = parseFloat(segment.toStopInfo.stop_lon);

        if (isNaN(fromLat) || isNaN(fromLon) || isNaN(toLat) || isNaN(toLon)) {
            console.warn('Coordonnées invalides pour les arrêts:', segment);
            return null;
        }

        const progress = segment.progress;

        // Tenter d'utiliser le tracé GeoJSON si disponible
        if (routeId) {
            const routeGeometry = this.dataManager.getRouteGeometry(routeId);
            if (routeGeometry && routeGeometry.length > 0) {
                const position = this.interpolateAlongRoute(
                    routeGeometry, 
                    fromLat, fromLon, 
                    toLat, toLon, 
                    progress
                );
                if (position) {
                    return position;
                }
            }
        }

        // Fallback: Interpolation linéaire si pas de tracé GeoJSON
        const lat = fromLat + (toLat - fromLat) * progress;
        const lon = fromLon + (toLon - fromLon) * progress;

        return {
            lat,
            lon,
            progress
        };
    }

    /**
     * Interpole la position le long d'un tracé GeoJSON
     */
    interpolateAlongRoute(routeCoordinates, fromLat, fromLon, toLat, toLon, progress) {
        // Trouver les points du tracé les plus proches des arrêts de départ et d'arrivée
        const fromIndex = this.dataManager.findNearestPointOnRoute(routeCoordinates, fromLat, fromLon);
        const toIndex = this.dataManager.findNearestPointOnRoute(routeCoordinates, toLat, toLon);

        if (fromIndex === null || toIndex === null || fromIndex === toIndex) {
            return null; // Pas de segment valide sur le tracé
        }

        // Déterminer la direction (aller ou retour)
        const direction = fromIndex < toIndex ? 1 : -1;
        const startIndex = fromIndex;
        const endIndex = toIndex;

        // Extraire le segment du tracé entre les deux arrêts
        let pathSegment;
        if (direction > 0) {
            pathSegment = routeCoordinates.slice(startIndex, endIndex + 1);
        } else {
            pathSegment = routeCoordinates.slice(endIndex, startIndex + 1).reverse();
        }

        if (pathSegment.length < 2) {
            return null;
        }

        // Calculer les distances cumulées le long du tracé
        const distances = [0];
        for (let i = 1; i < pathSegment.length; i++) {
            const [lon1, lat1] = pathSegment[i - 1];
            const [lon2, lat2] = pathSegment[i];
            const dist = this.dataManager.calculateDistance(lat1, lon1, lat2, lon2);
            distances.push(distances[i - 1] + dist);
        }

        const totalDistance = distances[distances.length - 1];
        if (totalDistance === 0) {
            return null;
        }

        // Trouver la distance cible selon la progression
        const targetDistance = totalDistance * progress;

        // Trouver le segment où se trouve le bus
        for (let i = 0; i < pathSegment.length - 1; i++) {
            if (targetDistance >= distances[i] && targetDistance <= distances[i + 1]) {
                const segmentDistance = distances[i + 1] - distances[i];
                const segmentProgress = segmentDistance > 0 
                    ? (targetDistance - distances[i]) / segmentDistance 
                    : 0;

                const [lon1, lat1] = pathSegment[i];
                const [lon2, lat2] = pathSegment[i + 1];

                // Interpolation linéaire sur ce segment du tracé
                const lat = lat1 + (lat2 - lat1) * segmentProgress;
                const lon = lon1 + (lon2 - lon1) * segmentProgress;

                return {
                    lat,
                    lon,
                    progress
                };
            }
        }

        // Si on arrive ici, retourner le dernier point
        const [lon, lat] = pathSegment[pathSegment.length - 1];
        return { lat, lon, progress };
    }

    /**
     * Calcule l'angle de déplacement du bus (pour orienter l'icône)
     */
    calculateBearing(segment) {
        if (!segment || !segment.fromStopInfo || !segment.toStopInfo) {
            return 0;
        }

        const fromLat = parseFloat(segment.fromStopInfo.stop_lat);
        const fromLon = parseFloat(segment.fromStopInfo.stop_lon);
        const toLat = parseFloat(segment.toStopInfo.stop_lat);
        const toLon = parseFloat(segment.toStopInfo.stop_lon);

        const fromLatRad = this.dataManager.toRad(fromLat);
        const fromLonRad = this.dataManager.toRad(fromLon);
        const toLatRad = this.dataManager.toRad(toLat);
        const toLonRad = this.dataManager.toRad(toLon);

        const dLon = toLonRad - fromLonRad;
        const y = Math.sin(dLon) * Math.cos(toLatRad);
        const x = Math.cos(fromLatRad) * Math.sin(toLatRad) -
                  Math.sin(fromLatRad) * Math.cos(toLatRad) * Math.cos(dLon);
        
        const bearing = Math.atan2(y, x);
        const degrees = (bearing * 180 / Math.PI + 360) % 360;
        
        return degrees;
    }

    /**
     * Calcule toutes les positions pour les bus actifs
     */
    calculateAllPositions(allBuses) {
        return allBuses.map(bus => {
            const routeId = bus.route?.route_id;
            let position = null;
            let bearing = 0;

            if (bus.segment) {
                // Cas 1: Bus en mouvement
                position = this.calculatePosition(bus.segment, routeId);
                bearing = this.calculateBearing(bus.segment);
            } else if (bus.position) {
                // Cas 2: Bus en attente à un arrêt (fourni par tripScheduler)
                position = bus.position;
            }

            if (!position) {
                return null;
            }

            return {
                ...bus,
                position,
                bearing 
            };
        }).filter(bus => bus !== null);
    }
}
