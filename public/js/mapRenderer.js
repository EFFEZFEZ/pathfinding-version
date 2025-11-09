/**
 * mapRenderer.js - VERSION FINALE (Audit V4 + Mode Itinéraire)
 * Gère l'affichage de la carte Leaflet et le rendu des bus et routes
 *
 * Logique anti-clignotement (Audit 5.1 & 6.2) CONSERVÉE.
 * NOUVELLES fonctions pour le mode itinéraire.
 */

export class MapRenderer {
    /**
     * @param {string} mapElementId - L'ID de l'élément HTML de la carte
     * @param {DataManager} dataManager - L'instance de DataManager
     * @param {TimeManager} timeManager - L'instance de TimeManager
     */
    constructor(mapElementId, dataManager, timeManager) {
        this.mapElementId = mapElementId;
        this.map = null;
        this.busMarkers = {};
        this.routeLayer = null;
        this.routeLayersById = {};
        this.selectedRoute = null;
        this.centerCoordinates = [45.1833, 0.7167];
        this.zoomLevel = 13; // Zoom initial un peu plus large
        this.tempStopMarker = null;

        this.stopLayer = null;
        this.itineraryLayer = null; // NOUVEAU: Couche pour l'itinéraire A->B

        this.dataManager = dataManager;
        this.timeManager = timeManager;

        this.clusterGroup = L.markerClusterGroup({
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            disableClusteringAtZoom: 16 
        });
    }

    /**
     * Initialise la carte Leaflet
     */
    initializeMap() {
        this.map = L.map(this.mapElementId).setView(this.centerCoordinates, this.zoomLevel);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19
        }).addTo(this.map);
        
        this.stopLayer = L.layerGroup().addTo(this.map);
        this.itineraryLayer = L.layerGroup().addTo(this.map); // NOUVEAU
        this.map.addLayer(this.clusterGroup);
        
        console.log('🗺️ Carte initialisée');
        this.map.on('click', () => {
            if (this.tempStopMarker) {
                this.map.removeLayer(this.tempStopMarker);
                this.tempStopMarker = null;
            }
        });
    }

    //
    // --- SECTION LOGIQUE D'AFFICHAGE GTFS (VISUALISATION) ---
    // (Toutes vos fonctions offsetPoint, offsetLineString, displayMultiColorRoutes, 
    //  addRoutePopup, updateBusMarkers, updateMovingBusPopup, updateStationaryBusPopup,
    //  createBusPopupContent, createBusMarker, highlightRoute, zoomToRoute, 
    //  zoomToStop, displayStops, onStopClick, createStopPopupContent
    //  restent EXACTEMENT telles que vous les avez fournies. 
    //  Je les inclus pour la complétude.)
    //

    offsetPoint(lat1, lon1, lat2, lon2, offsetMeters, index, total) {
        const earthRadius = 6371000;
        const lat1Rad = lat1 * Math.PI / 180;
        const lon1Rad = lon1 * Math.PI / 180;
        const lat2Rad = lat2 * Math.PI / 180;
        const lon2Rad = lon2 * Math.PI / 180;
        const bearing = Math.atan2(
            Math.sin(lon2Rad - lon1Rad) * Math.cos(lat2Rad),
            Math.cos(lat1Rad) * Math.sin(lat2Rad) - 
            Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(lon2Rad - lon1Rad)
        );
        const perpBearing = bearing + Math.PI / 2;
        const offsetDistance = offsetMeters * (index - (total - 1) / 2);
        const angularDistance = offsetDistance / earthRadius;
        const newLat = Math.asin(
            Math.sin(lat1Rad) * Math.cos(angularDistance) +
            Math.cos(lat1Rad) * Math.sin(angularDistance) * Math.cos(perpBearing)
        );
        const newLon = lon1Rad + Math.atan2(
            Math.sin(perpBearing) * Math.sin(angularDistance) * Math.cos(lat1Rad),
            Math.cos(angularDistance) - Math.sin(lat1Rad) * Math.sin(newLat)
        );
        return [newLat * 180 / Math.PI, newLon * 180 / Math.PI];
    }
    
    offsetLineString(coordinates, offsetMeters, index, total) {
        const offsetCoords = [];
        for (let i = 0; i < coordinates.length; i++) {
            const [lon, lat] = coordinates[i];
            let lon2, lat2;
            if (i < coordinates.length - 1) {
                [lon2, lat2] = coordinates[i + 1];
            } else {
                [lon2, lat2] = coordinates[i - 1];
            }
            const [newLat, newLon] = this.offsetPoint(lat, lon, lat2, lon2, offsetMeters, index, total);
            offsetCoords.push([newLon, newLat]);
        }
        return offsetCoords;
    }
    
    displayMultiColorRoutes(geoJsonData, dataManager, visibleRoutes) {
        if (!geoJsonData) {
            console.warn('Aucune donnée GeoJSON à afficher');
            return;
        }
        this.clearAllRoutes(); // Utilise la nouvelle fonction de nettoyage
        this.routeLayer = L.layerGroup().addTo(this.map);
        this.routeLayersById = {};
        const geometryMap = new Map();
        geoJsonData.features.forEach(feature => {
            if (feature.geometry && feature.geometry.type === 'LineString') {
                const routeId = feature.properties?.route_id;
                if (!visibleRoutes.has(routeId)) {
                    return;
                }
                const geomKey = JSON.stringify(feature.geometry.coordinates);
                if (!geometryMap.has(geomKey)) {
                    geometryMap.set(geomKey, []);
                }
                geometryMap.get(geomKey).push(feature);
            }
        });
        geometryMap.forEach((features, geomKey) => {
            const numRoutes = features.length;
            const baseWidth = 4;
            const offsetMeters = 3;
            if (numRoutes === 1) {
                const feature = features[0];
                const routeColor = feature.properties?.route_color || '#3388ff';
                const routeId = feature.properties?.route_id;
                const layer = L.geoJSON(feature, {
                    style: {
                        color: routeColor,
                        weight: baseWidth,
                        opacity: 0.85,
                        lineCap: 'round',
                        lineJoin: 'round'
                    }
                });
                if (routeId) {
                    if (!this.routeLayersById[routeId]) this.routeLayersById[routeId] = [];
                    this.routeLayersById[routeId].push(layer);
                }
                this.addRoutePopup(layer, features, dataManager);
                layer.addTo(this.routeLayer);
            } else {
                features.forEach((feature, index) => {
                    const routeColor = feature.properties?.route_color || '#3388ff';
                    const routeId = feature.properties?.route_id;
                    const offsetCoords = this.offsetLineString(
                        feature.geometry.coordinates,
                        offsetMeters,
                        index,
                        numRoutes
                    );
                    const offsetFeature = {
                        type: 'Feature',
                        geometry: {
                            type: 'LineString',
                            coordinates: offsetCoords
                        },
                        properties: feature.properties
                    };
                    const layer = L.geoJSON(offsetFeature, {
                        style: {
                            color: routeColor,
                            weight: baseWidth,
                            opacity: 0.85,
                            lineCap: 'round',
                            lineJoin: 'round'
                        }
                    });
                    if (routeId) {
                        if (!this.routeLayersById[routeId]) this.routeLayersById[routeId] = [];
                        this.routeLayersById[routeId].push(layer);
                    }
                    layer.addTo(this.routeLayer);
                    this.addRoutePopup(layer, features, dataManager);
                });
            }
        });
        console.log(`✓ ${geometryMap.size} segments de routes affichées`);
    }
    
    addRoutePopup(layer, features, dataManager) {
        let content = '<b>Ligne(s) sur ce tracé:</b><br>';
        const routeNames = new Set();
        features.forEach(feature => {
            const routeId = feature.properties?.route_id;
            const route = dataManager.getRoute(routeId);
            if (route) {
                routeNames.add(route.route_short_name || routeId);
            }
        });
        content += Array.from(routeNames).join(', ');
        layer.bindPopup(content);
    }

    updateBusMarkers(busesWithPositions, tripScheduler, currentSeconds) {
        const markersToAdd = [];
        const markersToRemove = [];
        const activeBusIds = new Set();
        let reopenPopupAt = null;

        busesWithPositions.forEach(bus => activeBusIds.add(bus.tripId));

        Object.keys(this.busMarkers).forEach(busId => {
            if (!activeBusIds.has(busId)) {
                const markerData = this.busMarkers[busId];
                if (markerData.marker.isPopupOpen()) {
                    reopenPopupAt = markerData.marker.getLatLng();
                }
                markersToRemove.push(markerData.marker);
                delete this.busMarkers[busId];
            }
        });

        busesWithPositions.forEach(bus => {
            const busId = bus.tripId;
            if (!busId) return;
            
            const { lat, lon } = bus.position;
            
            if (this.busMarkers[busId]) {
                const markerData = this.busMarkers[busId];
                markerData.bus = bus; 
                markerData.marker.setLatLng([lat, lon]);
                
                const isWaiting = !bus.segment; 
                const iconElement = markerData.marker.getElement();
                if (iconElement) {
                    iconElement.classList.toggle('bus-icon-waiting', isWaiting);
                }
                
                if (markerData.marker.isPopupOpen()) {
                    const popup = markerData.marker.getPopup();
                    if (!popup.getElement()) {
                        // Popup en cours d'ouverture
                    } else {
                        const popupElement = popup.getElement();
                        const currentState = bus.segment ? 'moving' : 'stationary';
                        if (currentState === 'moving') {
                            this.updateMovingBusPopup(popupElement, bus, tripScheduler);
                        } else {
                            this.updateStationaryBusPopup(popupElement, bus, tripScheduler);
                        }
                        markerData.lastState = currentState;
                    }
                } else {
                    markerData.lastState = bus.segment ? 'moving' : 'stationary';
                }

            } else {
                const markerData = this.createBusMarker(bus, tripScheduler, busId);
                if (reopenPopupAt && markerData.marker.getLatLng().equals(reopenPopupAt, 0.0001)) {
                    markerData.marker.openPopup();
                    reopenPopupAt = null; 
                }
                this.busMarkers[busId] = markerData;
                markersToAdd.push(markerData.marker);
            }
        });

        if (markersToRemove.length > 0) this.clusterGroup.removeLayers(markersToRemove);
        if (markersToAdd.length > 0) this.clusterGroup.addLayers(markersToAdd);
    }

    updateMovingBusPopup(popupElement, bus, tripScheduler) {
        try {
            const stopTimes = tripScheduler.dataManager.stopTimesByTrip[bus.tripId];
            const destination = tripScheduler.getTripDestination(stopTimes);
            const nextStopName = bus.segment?.toStopInfo?.stop_name || 'Inconnu';
            const nextStopETA = tripScheduler.getNextStopETA(bus.segment, bus.currentSeconds);

            const stateText = `En Ligne (vers ${destination})`;
            const nextStopLabelText = "Prochain arrêt :";
            const nextStopText = nextStopName;
            const etaLabelText = "Arrivée :";
            const etaText = nextStopETA ? nextStopETA.formatted : '...';

            const stateEl = popupElement.querySelector('[data-update="state"]');
            const nextStopLabelEl = popupElement.querySelector('[data-update="next-stop-label"]');
            const nextStopEl = popupElement.querySelector('[data-update="next-stop-value"]');
            const etaLabelEl = popupElement.querySelector('[data-update="eta-label"]');
            const etaEl = popupElement.querySelector('[data-update="eta-value"]');

            if (stateEl && stateEl.textContent !== stateText) stateEl.textContent = stateText;
            if (nextStopLabelEl && nextStopLabelEl.textContent !== nextStopLabelText) nextStopLabelEl.textContent = nextStopLabelText;
            if (nextStopEl && nextStopEl.textContent !== nextStopText) nextStopEl.textContent = nextStopText;
            if (etaLabelEl && etaLabelEl.textContent !== etaLabelText) etaLabelEl.textContent = etaLabelText;
            if (etaEl && etaEl.textContent !== etaText) etaEl.textContent = etaText;
            
        } catch (e) {
             console.error("Erreur mise à jour popup 'moving':", e, bus);
        }
    }

    updateStationaryBusPopup(popupElement, bus, tripScheduler) {
        try {
            const stopName = bus.position.stopInfo.stop_name;
            const departureTime = bus.position.nextDepartureTime;
            const departureText = tripScheduler.dataManager.formatTime(departureTime).substring(0, 5); // Assurez-vous que formatTime existe
            
            const stateText = `À l'arrêt`;
            const nextStopLabelText = "Arrêt actuel :";
            const nextStopText = stopName;
            const etaLabelText = "Départ :";
            const etaText = departureText;

            const stateEl = popupElement.querySelector('[data-update="state"]');
            const nextStopLabelEl = popupElement.querySelector('[data-update="next-stop-label"]');
            const nextStopEl = popupElement.querySelector('[data-update="next-stop-value"]');
            const etaLabelEl = popupElement.querySelector('[data-update="eta-label"]');
            const etaEl = popupElement.querySelector('[data-update="eta-value"]');

            if (stateEl && stateEl.textContent !== stateText) stateEl.textContent = stateText;
            if (nextStopLabelEl && nextStopLabelEl.textContent !== nextStopLabelText) nextStopLabelEl.textContent = nextStopLabelText;
            if (nextStopEl && nextStopEl.textContent !== nextStopText) nextStopEl.textContent = nextStopText;
            if (etaLabelEl && etaLabelEl.textContent !== etaLabelText) etaLabelEl.textContent = etaLabelText;
            if (etaEl && etaEl.textContent !== etaText) etaEl.textContent = etaText;

        } catch (e) {
            console.error("Erreur mise à jour popup 'stationary':", e, bus);
        }
    }

    createBusPopupContent(bus, tripScheduler) {
        const route = bus.route;
        const routeShortName = route?.route_short_name || route?.route_id || '?';
        const routeColor = route?.route_color ? `#${route.route_color}` : '#3B82F6';
        const textColor = route?.route_text_color ? `#${route.route_text_color}` : '#ffffff';

        let stateText, nextStopLabelText, nextStopText, etaLabelText, etaText;

        const stopTimes = tripScheduler.dataManager.stopTimesByTrip[bus.tripId];
        const destination = tripScheduler.getTripDestination(stopTimes);

        if (bus.segment) {
            const nextStopName = bus.segment?.toStopInfo?.stop_name || 'Inconnu';
            const nextStopETA = tripScheduler.getNextStopETA(bus.segment, bus.currentSeconds);
            stateText = `En Ligne (vers ${destination})`;
            nextStopLabelText = "Prochain arrêt :";
            nextStopText = nextStopName;
            etaLabelText = "Arrivée :";
            etaText = nextStopETA ? nextStopETA.formatted : '...';
        } else {
            const stopName = bus.position.stopInfo.stop_name;
            const departureTime = bus.position.nextDepartureTime;
            const departureText = tripScheduler.dataManager.formatTime(departureTime).substring(0, 5); // Assurez-vous que formatTime existe
            stateText = `À l'arrêt`;
            nextStopLabelText = "Arrêt actuel :";
            nextStopText = stopName;
            etaLabelText = "Départ :";
            etaText = departureText;
        }

        const detailsHtml = `
            <p><strong>Statut:</strong> <span data-update="state">${stateText}</span></p>
            <p><strong data-update="next-stop-label">${nextStopLabelText}</strong> <span data-update="next-stop-value">${nextStopText}</span></p>
            <p><strong data-update="eta-label">${etaLabelText}</strong> <span data-update="eta-value">${etaText}</span></p>
            <p class="realtime-notice"><em>Mise à jour en temps réel</em></p>
        `;

        return `
            <div class="info-popup-content"> 
                <div class="info-popup-header" style="background: ${routeColor}; color: ${textColor};">
                    Ligne ${routeShortName}
                </div>
                <div class="info-popup-body bus-details">
                    ${detailsHtml}
                </div>
            </div>
        `;
    }

    createBusMarker(bus, tripScheduler, busId) {
        const { lat, lon } = bus.position;
        const route = bus.route;
        const routeShortName = route?.route_short_name || route?.route_id || '?';
        const routeColor = route?.route_color ? `#${route.route_color}` : '#FFC107';
        const textColor = route?.route_text_color ? `#${route.route_text_color}` : '#ffffff';

        const isWaiting = !bus.segment; 
        const iconClassName = isWaiting ? 'bus-icon-rect bus-icon-waiting' : 'bus-icon-rect';

        const icon = L.divIcon({
            className: iconClassName,
            html: `<div style="background-color: ${routeColor}; color: ${textColor}; width: 40px; height: 24px; border-radius: 6px; border: 2px solid white; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.85rem; box-shadow: 0 2px 10px rgba(0,0,0,0.4); text-shadow: 0 1px 2px rgba(0,0,0,0.3);">${routeShortName}</div>`,
            iconSize: [40, 24],
            iconAnchor: [20, 12],
            popupAnchor: [0, -12]
        });

        const marker = L.marker([lat, lon], { icon });
        marker.bindPopup("");

        marker.on('popupopen', (e) => {
            const markerData = this.busMarkers[busId];
            if (!markerData || !markerData.bus) {
                e.popup.setContent("Informations non disponibles.");
                return;
            }
            const freshBus = markerData.bus;
            const freshPopupContent = this.createBusPopupContent(freshBus, tripScheduler);
            e.popup.setContent(freshPopupContent);
            markerData.lastState = freshBus.segment ? 'moving' : 'stationary';
        });

        return {
            marker: marker,
            bus: bus,
            lastState: bus.segment ? 'moving' : 'stationary' 
        };
    }

    highlightRoute(routeId, state) {
        if (!this.routeLayersById || !this.routeLayersById[routeId]) return;
        const weight = state ? 6 : 4; 
        const opacity = state ? 1 : 0.85;
        this.routeLayersById[routeId].forEach(layer => {
            layer.setStyle({ weight: weight, opacity: opacity });
            if (state) layer.bringToFront(); 
        });
    }

    zoomToRoute(routeId) {
        if (!this.routeLayersById || !this.routeLayersById[routeId] || this.routeLayersById[routeId].length === 0) {
            console.warn(`Aucune couche trouvée pour zoomer sur la route ${routeId}`);
            return;
        }
        const routeGroup = L.featureGroup(this.routeLayersById[routeId]);
        const bounds = routeGroup.getBounds();
        if (bounds && bounds.isValid()) {
            this.map.fitBounds(bounds, { padding: [50, 50] });
        }
    }

    zoomToStop(stop) {
        const lat = parseFloat(stop.stop_lat);
        const lon = parseFloat(stop.stop_lon);
        if (isNaN(lat) || isNaN(lon)) return;
        this.map.setView([lat, lon], 17);
        if (this.tempStopMarker) {
            this.map.removeLayer(this.tempStopMarker);
        }
        const stopIcon = L.divIcon({
            className: 'stop-search-marker',
            html: `<div></div>`,
            iconSize: [12, 12],
            iconAnchor: [6, 6]
        });
        this.tempStopMarker = L.marker([lat, lon], { icon: stopIcon }).addTo(this.map);
        this.tempStopMarker.bindPopup(`<b>${stop.stop_name}</b>`).openPopup();
    }

    displayStops(minZoom = 13) { 
        this.clearStops(); // Utilise la nouvelle fonction
        const currentZoom = this.map.getZoom();
        if (currentZoom < minZoom) return; 
        const stopIcon = L.divIcon({
            className: 'stop-marker-icon',
            iconSize: [10, 10],
            iconAnchor: [5, 5]
        });
        const stopsToDisplay = [];
        this.dataManager.masterStops.forEach(stop => {
            const lat = parseFloat(stop.stop_lat);
            const lon = parseFloat(stop.stop_lon);
            if (isNaN(lat) || isNaN(lon)) return;
            const marker = L.marker([lat, lon], { icon: stopIcon, zIndexOffset: -100 });
            marker.on('click', () => this.onStopClick(stop));
            stopsToDisplay.push(marker);
        });
        stopsToDisplay.forEach(marker => this.stopLayer.addLayer(marker));
    }

    onStopClick(masterStop) {
        const currentSeconds = this.timeManager.getCurrentSeconds();
        const currentDate = this.timeManager.getCurrentDate();
        const associatedStopIds = this.dataManager.groupedStopMap[masterStop.stop_id] || [masterStop.stop_id];
        const departures = this.dataManager.getUpcomingDepartures(associatedStopIds, currentSeconds, currentDate, 5);
        const popupContent = this.createStopPopupContent(masterStop, departures, currentSeconds);
        const lat = parseFloat(masterStop.stop_lat);
        const lon = parseFloat(masterStop.stop_lon);
        L.popup()
            .setLatLng([lat, lon])
            .setContent(popupContent)
            .openOn(this.map);
    }

    createStopPopupContent(masterStop, departures, currentSeconds) {
        let html = `<div class="info-popup-content">`;
        html += `<div class="info-popup-header">${masterStop.stop_name}</div>`;
        html += `<div class="info-popup-body">`;
        if (departures.length === 0) {
            html += `<div class="departure-item empty">Aucun prochain passage trouvé.</div>`;
        } else {
            departures.forEach(dep => {
                const waitSeconds = dep.departureSeconds - currentSeconds;
                let waitTime = "";
                if (waitSeconds >= 0) {
                    const waitMinutes = Math.floor(waitSeconds / 60);
                    if (waitMinutes === 0) {
                        waitTime = `<span class="wait-time imminent">Imminent</span>`;
                    } else {
                        waitTime = `<span class="wait-time">${waitMinutes} min</span>`;
                    }
                }
                html += `
                    <div class="departure-item">
                        <div class="departure-info">
                            <span class="departure-badge" style="background-color: #${dep.routeColor}; color: #${dep.routeTextColor};">
                                ${dep.routeShortName}
                            </span>
                            <span class="departure-dest">${dep.destination}</span>
                        </div>
                        <div class="departure-time">
                            <strong>${dep.time.substring(0, 5)}</strong>
                            ${waitTime}
                        </div>
                    </div>
                `;
            });
        }
        html += `</div></div>`;
        return html;
    }

    // =============================================
    // NOUVEAU: Fonctions de nettoyage et de dessin
    // =============================================

    /**
     * Efface TOUS les tracés de lignes GTFS
     */
    clearAllRoutes() {
        if (this.routeLayer) {
            this.routeLayer.clearLayers();
        }
        this.routeLayersById = {};
    }

    /**
     * Cache les marqueurs de bus (sans les supprimer)
     */
    hideBusMarkers() {
        if (this.clusterGroup) {
            this.map.removeLayer(this.clusterGroup);
        }
    }
    
    /**
     * Ré-affiche les marqueurs de bus
     */
    showBusMarkers() {
        if (this.clusterGroup && !this.map.hasLayer(this.clusterGroup)) {
            this.map.addLayer(this.clusterGroup);
        }
    }

    /**
     * Efface les marqueurs d'arrêts
     */
    clearStops() {
        if (this.stopLayer) {
            this.stopLayer.clearLayers();
        }
    }

    /**
     * Efface le tracé d'itinéraire (A->B)
     */
    clearItinerary() {
        if (this.itineraryLayer) {
            this.itineraryLayer.clearLayers();
        }
    }

    /**
     * Dessine un itinéraire (simple polyligne) fourni par Google
     */
    drawItinerary(decodedCoords, leg) {
        this.clearItinerary(); // Efface l'ancien

        if (decodedCoords && decodedCoords.length > 0) {
            // Dessine le tracé global de l'itinéraire
            L.polyline(decodedCoords, {
                color: '#2563eb', // Couleur primaire
                weight: 6,
                opacity: 0.8,
                lineCap: 'round',
                lineJoin: 'round'
            }).addTo(this.itineraryLayer);

            // Ajoute marqueur Départ
            const startPoint = [leg.start_location.lat, leg.start_location.lng];
            L.marker(startPoint, { 
                icon: L.divIcon({ className: 'stop-search-marker', html: '<div></div>', iconSize: [12, 12] })
            })
            .addTo(this.itineraryLayer)
            .bindPopup(`<b>Départ:</b> ${leg.start_address}`);

            // Ajoute marqueur Arrivée
            const endPoint = [leg.end_location.lat, leg.end_location.lng];
             L.marker(endPoint, { 
                icon: L.divIcon({ className: 'stop-search-marker', html: '<div></div>', iconSize: [12, 12] })
            })
            .addTo(this.itineraryLayer)
            .bindPopup(`<b>Arrivée:</b> ${leg.end_address}`);

            // Zoomer sur l'ensemble de l'itinéraire
            const bounds = L.latLngBounds(decodedCoords);
            this.map.fitBounds(bounds, { padding: [50, 50] });
        }
    }
}
