/**
 * localPathfinder.js
 * * Le "cerveau" autonome de la planification d'itinéraire.
 * Calcule le meilleur itinéraire (bus + marche) en utilisant
 * les données GTFS locales, sans aucun appel externe.
 * * Utilise un algorithme de Dijkstra adapté aux graphes temporels.
 */

// Une classe simple de file de priorité (Min-Heap) pour l'algorithme de Dijkstra
class PriorityQueue {
    constructor() {
        this.collection = [];
    }
    enqueue(element) { // element est [valeur, priorité]
        if (this.isEmpty()) {
            this.collection.push(element);
        } else {
            let added = false;
            for (let i = 0; i < this.collection.length; i++) {
                if (element[1] < this.collection[i][1]) { // vérifie la priorité
                    this.collection.splice(i, 0, element);
                    added = true;
                    break;
                }
            }
            if (!added) {
                this.collection.push(element);
            }
        }
    }
    dequeue() {
        return this.collection.shift();
    }
    isEmpty() {
        return this.collection.length === 0;
    }
}

// C'EST L'EXPORT QUE VOTRE main.js RECHERCHE
export class LocalPathfinder {
    constructor(dataManager) {
        this.dataManager = dataManager;
        
        // Vitesse de marche moyenne (m/s)
        this.WALK_SPEED_MPS = 1.4; 
        
        // Distance de marche maximale pour un transfert ou pour rejoindre/quitter
        this.MAX_WALK_METERS = 500;
        
        // Stockage des transferts à pied pré-calculés entre les arrêts
        this.transferMap = new Map();
        
        // Pré-calculer les transferts est crucial pour la performance
        this.prebuildTransferMap();
    }

    /**
     * Calcule et stocke tous les transferts à pied possibles entre les arrêts.
     */
    prebuildTransferMap() {
        console.log('🧠 [Pathfinder] Pré-calcul des transferts à pied...');
        const stops = this.dataManager.masterStops;
        
        for (let i = 0; i < stops.length; i++) {
            const fromStop = stops[i];
            const transfers = [];
            
            for (let j = 0; j < stops.length; j++) {
                if (i === j) continue;
                const toStop = stops[j];
                
                const distance = this.dataManager.calculateDistance(
                    fromStop.stop_lat, fromStop.stop_lon,
                    toStop.stop_lat, toStop.stop_lon
                );
                
                if (distance <= this.MAX_WALK_METERS) {
                    const walkTimeSeconds = Math.ceil(distance / this.WALK_SPEED_MPS);
                    transfers.push({
                        toStopId: toStop.stop_id,
                        walkTime: walkTimeSeconds,
                        distance: distance
                    });
                }
            }
            this.transferMap.set(fromStop.stop_id, transfers);
        }
        console.log(`🧠 [Pathfinder] ${this.transferMap.size} arrêts indexés pour la marche.`);
    }

    /**
     * Trouve le meilleur itinéraire entre deux points de coordonnées.
     * @param {object} startCoords - { lat, lon }
     * @param {object} endCoords - { lat, lon }
     * @param {Date} departureDate - L'objet Date de départ
     * @returns {object} - Un objet { status, path, stats }
     */
    async findItinerary(startCoords, endCoords, departureDate) {
        
        const startTime = Date.now();
        const departureTimeSeconds = (departureDate.getHours() * 3600) + (departureDate.getMinutes() * 60) + departureDate.getSeconds();
        const serviceId = this.dataManager.getServiceId(departureDate);

        if (!serviceId) {
            return { status: 'NO_SERVICE', path: [], stats: {} };
        }

        const pq = new PriorityQueue();
        
        // minArrivalTime[stopId] = Le temps d'arrivée le plus tôt connu à cet arrêt
        const minArrivalTime = new Map();
        
        // backLink[stopId] = { leg, prevStopId } (pour reconstruire le chemin)
        const backLink = new Map();

        // 1. Trouver les arrêts accessibles à pied depuis le point de départ
        const startStops = this.dataManager.findStopsWithinRadius(startCoords, this.MAX_WALK_METERS);
        
        if (startStops.length === 0) {
            return { status: 'NO_START_STOPS', path: [], stats: {} };
        }
        
        // 2. Trouver les arrêts de destination (à portée de marche de l'arrivée)
        const endStops = this.dataManager.findStopsWithinRadius(endCoords, this.MAX_WALK_METERS);
        const endStopIds = new Set(endStops.map(s => s.stop_id));

        if (endStops.length === 0) {
            return { status: 'NO_END_STOPS', path: [], stats: {} };
        }

        // 3. Initialiser la file de priorité avec les "legs" de marche initiaux
        for (const stopInfo of startStops) {
            const { stop, distance } = stopInfo;
            const walkTime = Math.ceil(distance / this.WALK_SPEED_MPS);
            const arrivalTime = departureTimeSeconds + walkTime;

            const leg = {
                type: 'WALK',
                fromCoords: startCoords,
                toCoords: { lat: stop.stop_lat, lon: stop.stop_lon },
                toStopId: stop.stop_id,
                toStopName: stop.stop_name,
                startTime: departureTimeSeconds,
                endTime: arrivalTime,
                duration: walkTime,
                distance: distance
            };

            pq.enqueue([leg, arrivalTime]);
            minArrivalTime.set(stop.stop_id, arrivalTime);
            backLink.set(stop.stop_id, { leg: leg, prevStopId: 'START' });
        }
        
        // Stocke l'ID de l'arrêt final (le premier qu'on atteint)
        let finalStopId = null;

        // 4. Lancer l'algorithme de Dijkstra
        while (!pq.isEmpty()) {
            const [currentLeg, currentArrivalTime] = pq.dequeue();
            const currentStopId = currentLeg.toStopId;

            // Si on a déjà trouvé un meilleur chemin vers cet arrêt, ignorer
            if (currentArrivalTime > (minArrivalTime.get(currentStopId) || Infinity)) {
                continue;
            }
            
            // C'EST GAGNÉ ? Si c'est un arrêt de destination, on a un chemin !
            if (endStopIds.has(currentStopId)) {
                finalStopId = currentStopId;
                break; // On a trouvé le chemin le plus rapide
            }

            // A. EXPANSION "BUS" (Prendre un bus)
            const departures = this.dataManager.stopTimesByStop[currentStopId] || [];
            
            for (const st of departures) {
                const trip = this.dataManager.tripsByTripId[st.trip_id];
                
                // Vérifier si ce bus roule (bon serviceId) et si on peut l'attendre
                const depTime = this.dataManager.timeToSeconds(st.departure_time);
                if (trip.service_id === serviceId && depTime >= currentArrivalTime) {
                    
                    // On peut prendre ce bus. Trouver tous les arrêts suivants sur ce trajet.
                    const tripStops = this.dataManager.getStopTimes(st.trip_id);
                    const currentStopSeq = parseInt(st.stop_sequence);

                    for (let i = 0; i < tripStops.length; i++) {
                        if (parseInt(tripStops[i].stop_sequence) > currentStopSeq) {
                            const nextStopOnTrip = tripStops[i];
                            const nextStopId = nextStopOnTrip.stop_id;
                            const nextArrivalTime = this.dataManager.timeToSeconds(nextStopOnTrip.arrival_time);
                            
                            // Si ce trajet améliore notre temps d'arrivée à l'arrêt suivant
                            if (nextArrivalTime < (minArrivalTime.get(nextStopId) || Infinity)) {
                                minArrivalTime.set(nextStopId, nextArrivalTime);
                                
                                const route = this.dataManager.getRoute(trip.route_id);
                                const busLeg = {
                                    type: 'BUS',
                                    fromStopId: st.stop_id,
                                    fromStopName: this.dataManager.getStop(st.stop_id).stop_name,
                                    toStopId: nextStopId,
                                    toStopName: this.dataManager.getStop(nextStopId).stop_name,
                                    startTime: depTime,
                                    endTime: nextArrivalTime,
                                    duration: nextArrivalTime - depTime,
                                    route: route,
                                    tripId: trip.trip_id,
                                    headsign: trip.trip_headsign
                                };
                                
                                pq.enqueue([busLeg, nextArrivalTime]);
                                backLink.set(nextStopId, { leg: busLeg, prevStopId: currentStopId });
                            }
                        }
                    }
                }
            }

            // B. EXPANSION "MARCHE" (Transfert à pied vers un autre arrêt)
            const transfers = this.transferMap.get(currentStopId) || [];
            for (const transfer of transfers) {
                const newArrivalTime = currentArrivalTime + transfer.walkTime;
                
                if (newArrivalTime < (minArrivalTime.get(transfer.toStopId) || Infinity)) {
                    minArrivalTime.set(transfer.toStopId, newArrivalTime);
                    
                    const fromStop = this.dataManager.getStop(currentStopId);
                    const toStop = this.dataManager.getStop(transfer.toStopId);
                    const walkLeg = {
                        type: 'WALK',
                        fromStopId: currentStopId,
                        fromStopName: fromStop.stop_name,
                        fromCoords: { lat: fromStop.stop_lat, lon: fromStop.stop_lon },
                        toStopId: transfer.toStopId,
                        toStopName: toStop.stop_name,
                        toCoords: { lat: toStop.stop_lat, lon: toStop.stop_lon },
                        startTime: currentArrivalTime,
                        endTime: newArrivalTime,
                        duration: transfer.walkTime,
                        distance: transfer.distance
                    };
                    
                    pq.enqueue([walkLeg, newArrivalTime]);
                    backLink.set(transfer.toStopId, { leg: walkLeg, prevStopId: currentStopId });
                }
            }
        } // Fin de la boucle while

        // 5. Reconstruire le chemin
        if (finalStopId) {
            const path = this.reconstructPath(backLink, finalStopId, endCoords);
            const stats = {
                duration: path.totalDuration,
                calcTime: Date.now() - startTime
            };
            return { status: 'OK', path: path.legs, stats: stats };
        } else {
            return { status: 'NO_PATH_FOUND', path: [], stats: { calcTime: Date.now() - startTime } };
        }
    }

    /**
     * Remonte la chaîne "backLink" pour construire le chemin final
     */
    reconstructPath(backLink, finalStopId, endCoords) {
        const legs = [];
        let currentStopId = finalStopId;
        
        // D'abord, ajouter le dernier "leg" de marche (de l'arrêt final au point de destination)
        const finalStop = this.dataManager.getStop(finalStopId);
        const finalDistance = this.dataManager.calculateDistance(
            finalStop.stop_lat, finalStop.stop_lon,
            endCoords.lat, endCoords.lon
        );
        const finalWalkTime = Math.ceil(finalDistance / this.WALK_SPEED_MPS);
        const finalLegArrivalTime = backLink.get(finalStopId).leg.endTime;
        
        const finalWalkLeg = {
            type: 'WALK',
            fromStopId: finalStopId,
            fromStopName: finalStop.stop_name,
            fromCoords: { lat: finalStop.stop_lat, lon: finalStop.stop_lon },
            toCoords: endCoords,
            startTime: finalLegArrivalTime,
            endTime: finalLegArrivalTime + finalWalkTime,
            duration: finalWalkTime,
            distance: finalDistance
        };
        legs.push(finalWalkLeg);

        // Maintenant, remonter le chemin
        let currentLink = backLink.get(finalStopId);
        while (currentLink.prevStopId !== 'START') {
            legs.push(currentLink.leg);
            currentLink = backLink.get(currentLink.prevStopId);
        }
        // Ajouter le premier "leg" de marche
        legs.push(currentLink.leg);

        const reversedLegs = legs.reverse();
        const totalDuration = reversedLegs[reversedLegs.length - 1].endTime - reversedLegs[0].startTime;
        
        return { legs: reversedLegs, totalDuration: totalDuration };
    }
}
