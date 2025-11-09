/**
 * main.js
 * Point d'entrée principal de l'application
 * Orchestre tous les modules et gère l'interface utilisateur
 *
 * VERSION AUTONOME:
 * 1. "Visualisation" (par défaut, bus en temps réel)
 * 2. "Planification" (calcul d'itinéraire 100% LOCAL)
 */

import { DataManager } from './dataManager.js';
import { TimeManager } from './timeManager.js';
import { TripScheduler } from './tripScheduler.js';
import { BusPositionCalculator } from './busPositionCalculator.js';
import { MapRenderer } from './mapRenderer.js';
// NOUVEAU: Import du calculateur d'itinéraire local
import { LocalPathfinder } from './localPathfinder.js';
import { PlannerPanel } from './plannerPanel.js';

let dataManager;
let timeManager;
let tripScheduler;
let busPositionCalculator;
let mapRenderer;
let visibleRoutes = new Set();

// NOUVEAU: Modules de planification LOCALE
let localPathfinder; // R.I.P. routingService
let plannerPanel;
let isPlannerMode = false; // Pour savoir si on est en mode itinéraire

// Catégories de lignes (inchangé)
const LINE_CATEGORIES = {
    'majeures': {
        name: 'Lignes majeures',
        lines: ['A', 'B', 'C', 'D'],
        color: '#2563eb'
    },
    'express': {
        name: 'Lignes express',
        lines: ['e1', 'e2', 'e4', 'e5', 'e6', 'e7'],
        color: '#dc2626'
    },
    'quartier': {
        name: 'Lignes de quartier',
        lines: ['K1A', 'K1B', 'K2', 'K3A', 'K3B', 'K4A', 'K4B', 'K5', 'K6'],
        color: '#059669'
    },
    'rabattement': {
        name: 'Lignes de rabattement',
        lines: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11', 'R12', 'R13', 'R14', 'R15'],
        color: '#7c3aed'
    },
    'navettes': {
        name: 'Navettes',
        lines: ['N', 'N1'],
        color: '#f59e0b'
    }
};

// Fonction getCategoryForRoute (inchangée)
function getCategoryForRoute(routeShortName) {
    for (const [categoryId, category] of Object.entries(LINE_CATEGORIES)) {
        if (category.lines.includes(routeShortName)) {
            return categoryId;
        }
    }
    return 'autres';
}

async function initializeApp() {
    dataManager = new DataManager();
    
    try {
        await dataManager.loadAllData();
        
        timeManager = new TimeManager();
        
        mapRenderer = new MapRenderer('map', dataManager, timeManager);
        mapRenderer.initializeMap();
        
        tripScheduler = new TripScheduler(dataManager);
        busPositionCalculator = new BusPositionCalculator(dataManager);
        
        // NOUVEAU: Initialisation du pathfinder local
        localPathfinder = new LocalPathfinder(dataManager);

        plannerPanel = new PlannerPanel(
            'planner-panel', 
            dataManager, 
            mapRenderer, 
            handleItineraryRequest // Je passe la NOUVELLE fonction de recherche
        );

        initializeRouteFilter();
        
        // Affiche les routes par défaut
        showDefaultMap();
        
        mapRenderer.displayStops();
        
        setupEventListeners();
        
        if (localStorage.getItem('gtfsInstructionsShown') !== 'true') {
            document.getElementById('instructions').classList.remove('hidden');
        }
        
        updateDataStatus('Données chargées', 'loaded');
        
        checkAndSetupTimeMode();
        
        updateData(); // Appel initial
        
    } catch (error) {
        console.error('Erreur lors de l\'initialisation:', error);
        updateDataStatus('Erreur de chargement', 'error');
    }
}

// Fonction checkAndSetupTimeMode (inchangée)
function checkAndSetupTimeMode() {
    timeManager.setMode('real');
    timeManager.play();
    console.log('⏰ Mode TEMPS RÉEL activé.');
}

// Fonctions showModeBanner / hideModeBanner (inchangées)
function showModeBanner(message) { /* ... */ }
function hideModeBanner() { /* ... */ }

// Fonction initializeRouteFilter (inchangée)
function initializeRouteFilter() {
    const routeCheckboxesContainer = document.getElementById('route-checkboxes');
    routeCheckboxesContainer.innerHTML = '';
    
    visibleRoutes.clear();
    
    const routesByCategory = {};
    Object.keys(LINE_CATEGORIES).forEach(cat => routesByCategory[cat] = []);
    routesByCategory['autres'] = [];
    
    dataManager.routes.forEach(route => {
        visibleRoutes.add(route.route_id);
        const category = getCategoryForRoute(route.route_short_name);
        routesByCategory[category].push(route);
    });

    Object.values(routesByCategory).forEach(routes => {
        routes.sort((a, b) => {
            const nameA = a.route_short_name;
            const nameB = b.route_short_name;
            const isRLineA = nameA.startsWith('R') && !isNaN(parseInt(nameA.substring(1)));
            const isRLineB = nameB.startsWith('R') && !isNaN(parseInt(nameB.substring(1)));
            if (isRLineA && isRLineB) return parseInt(nameA.substring(1)) - parseInt(nameB.substring(1));
            return nameA.localeCompare(nameB);
        });
    });
    
    Object.entries(LINE_CATEGORIES).forEach(([categoryId, categoryInfo]) => {
        const routes = routesByCategory[categoryId];
        if (routes.length === 0) return;
        
        const categoryHeader = document.createElement('div');
        categoryHeader.className = 'category-header';
        categoryHeader.innerHTML = `
            <div class="category-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="${categoryInfo.color}"><circle cx="12" cy="12" r="10"/></svg>
                <strong>${categoryInfo.name}</strong>
                <span class="category-count">(${routes.length})</span>
            </div>
            <div class="category-actions">
                <button class="btn-category-action" data-category="${categoryId}" data-action="select">Tous</button>
                <button class="btn-category-action" data-category="${categoryId}" data-action="deselect">Aucun</button>
            </div>
        `;
        routeCheckboxesContainer.appendChild(categoryHeader);
        
        const categoryContainer = document.createElement('div');
        categoryContainer.className = 'category-routes';
        categoryContainer.id = `category-${categoryId}`;
        
        routes.forEach(route => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'route-checkbox-item';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `route-${route.route_id}`;
            checkbox.checked = true;
            checkbox.dataset.category = categoryId;
            checkbox.addEventListener('change', () => handleRouteFilterChange());
            
            const routeColor = route.route_color ? `#${route.route_color}` : '#3388ff';
            const textColor = route.route_text_color ? `#${route.route_text_color}` : '#ffffff';
            
            const badge = document.createElement('div');
            badge.className = 'route-badge';
            badge.style.backgroundColor = routeColor;
            badge.style.color = textColor;
            badge.textContent = route.route_short_name || route.route_id;
            
            const label = document.createElement('span');
            label.className = 'route-name';
            label.textContent = route.route_long_name || route.route_short_name || route.route_id;
            
            itemDiv.appendChild(checkbox);
            itemDiv.appendChild(badge);
            itemDiv.appendChild(label);
            categoryContainer.appendChild(itemDiv);

            itemDiv.addEventListener('mouseenter', () => mapRenderer.highlightRoute(route.route_id, true));
            itemDiv.addEventListener('mouseleave', () => mapRenderer.highlightRoute(route.route_id, false));
            itemDiv.addEventListener('click', (e) => {
                if (e.target.type === 'checkbox') return;
                mapRenderer.zoomToRoute(route.route_id);
            });
        });
        
        routeCheckboxesContainer.appendChild(categoryContainer);
    });
    
    // ... (votre code pour la catégorie 'autres' reste identique) ...

    document.querySelectorAll('.btn-category-action').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const category = e.target.dataset.category;
            const action = e.target.dataset.action;
            handleCategoryAction(category, action);
        });
    });
}

// Fonction handleCategoryAction (inchangée)
function handleCategoryAction(category, action) {
    const checkboxes = document.querySelectorAll(`input[data-category="${category}"]`);
    checkboxes.forEach(checkbox => {
        checkbox.checked = (action === 'select');
    });
    handleRouteFilterChange();
}

// Fonction handleRouteFilterChange (inchangée)
function handleRouteFilterChange() {
    visibleRoutes.clear();
    
    dataManager.routes.forEach(route => {
        const checkbox = document.getElementById(`route-${route.route_id}`);
        if (checkbox && checkbox.checked) {
            visibleRoutes.add(route.route_id);
        }
    });
    
    if (isPlannerMode) {
        exitPlannerMode();
    } else if (dataManager.geoJson) {
        mapRenderer.displayMultiColorRoutes(dataManager.geoJson, dataManager, visibleRoutes);
    }
    
    updateData();
}

// Fonction setupEventListeners (inchangée)
function setupEventListeners() {
    
    document.getElementById('close-instructions').addEventListener('click', () => {
        document.getElementById('instructions').classList.add('hidden');
        localStorage.setItem('gtfsInstructionsShown', 'true');
    });
    
    document.getElementById('btn-toggle-filter').addEventListener('click', () => {
        document.getElementById('route-filter-panel').classList.toggle('hidden');
        document.getElementById('planner-panel').classList.add('hidden');
        if (isPlannerMode) exitPlannerMode();
    });
    
    document.getElementById('close-filter').addEventListener('click', () => {
        document.getElementById('route-filter-panel').classList.add('hidden');
    });

    document.getElementById('btn-toggle-planner').addEventListener('click', () => {
        document.getElementById('planner-panel').classList.toggle('hidden');
        document.getElementById('route-filter-panel').classList.add('hidden');
    });
    document.getElementById('close-planner').addEventListener('click', () => {
        document.getElementById('planner-panel').classList.add('hidden');
        if (isPlannerMode) {
            exitPlannerMode();
        }
    });
    
    document.getElementById('select-all-routes').addEventListener('click', () => {
        dataManager.routes.forEach(route => {
            const checkbox = document.getElementById(`route-${route.route_id}`);
            if (checkbox) checkbox.checked = true;
        });
        handleRouteFilterChange();
    });
    
    document.getElementById('deselect-all-routes').addEventListener('click', () => {
        dataManager.routes.forEach(route => {
            const checkbox = document.getElementById(`route-${route.route_id}`);
            if (checkbox) checkbox.checked = false;
        });
        handleRouteFilterChange();
    });
    
    timeManager.addListener(updateData);

    const searchBar = document.getElementById('search-bar');
    const searchResultsContainer = document.getElementById('search-results');

    searchBar.addEventListener('input', handleSearchInput);
    searchBar.addEventListener('focus', handleSearchInput); 
    
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-container')) {
            searchResultsContainer.classList.add('hidden');
        }
    });

    if (mapRenderer && mapRenderer.map) {
        mapRenderer.map.on('zoomend', () => {
            if (dataManager && !isPlannerMode) { 
                mapRenderer.displayStops();
            }
        });
    }
}

// Fonctions handleSearchInput, displaySearchResults, onSearchResultClick (inchangées)
function handleSearchInput(e) {
    const query = e.target.value.toLowerCase();
    const searchResultsContainer = document.getElementById('search-results');
    if (query.length < 2) {
        searchResultsContainer.classList.add('hidden');
        searchResultsContainer.innerHTML = '';
        return;
    }
    const matches = dataManager.masterStops
        .filter(stop => stop.stop_name.toLowerCase().includes(query))
        .slice(0, 10); 
    displaySearchResults(matches, query);
}
function displaySearchResults(stops, query) {
    const searchResultsContainer = document.getElementById('search-results');
    searchResultsContainer.innerHTML = '';
    if (stops.length === 0) {
        searchResultsContainer.innerHTML = `<div class="search-result-item">Aucun arrêt trouvé.</div>`;
        searchResultsContainer.classList.remove('hidden');
        return;
    }
    stops.forEach(stop => {
        const item = document.createElement('div');
        item.className = 'search-result-item';
        const regex = new RegExp(`(${query})`, 'gi');
        item.innerHTML = stop.stop_name.replace(regex, '<strong>$1</strong>');
        item.addEventListener('click', () => onSearchResultClick(stop));
        searchResultsContainer.appendChild(item);
    });
    searchResultsContainer.classList.remove('hidden');
}
function onSearchResultClick(stop) {
    mapRenderer.zoomToStop(stop);
    document.getElementById('search-bar').value = stop.stop_name;
    document.getElementById('search-results').classList.add('hidden');
}


// =============================================
// GESTION DE L'ITINÉRAIRE (MODIFIÉE)
// =============================================

// Fonction showDefaultMap (inchangée)
function showDefaultMap() {
    isPlannerMode = false;
    if (dataManager.geoJson) {
        mapRenderer.displayMultiColorRoutes(dataManager.geoJson, dataManager, visibleRoutes);
    }
    mapRenderer.showBusMarkers();
    mapRenderer.displayStops();
}

// Fonction exitPlannerMode (inchangée)
function exitPlannerMode() {
    isPlannerMode = false;
    mapRenderer.clearItinerary(); 
    showDefaultMap(); 
    document.getElementById('planner-panel').classList.add('hidden');
}

/**
 * ===================================================================
 * FONCTION TOTALEMENT RÉÉCRITE pour utiliser LocalPathfinder
 * ===================================================================
 * @param {string} fromPlace - Coordonnées "lat,lon" OU nom d'un lieu
 * @param {string} toPlace - Coordonnées "lat,lon" OU nom d'un lieu
 */
async function handleItineraryRequest(fromPlace, toPlace) {
    console.log(`Demande d'itinéraire LOCAL de ${fromPlace} à ${toPlace}`);
    isPlannerMode = true;

    // --- Fonctions utilitaires pour trouver les coordonnées ---
    const isCoordinates = (input) => {
        if (typeof input !== 'string') return false;
        const parts = input.split(',');
        if (parts.length !== 2) return false;
        return !isNaN(parts[0]) && !isNaN(parts[1]);
    };

    const getCoordsForPlace = (place) => {
        if (isCoordinates(place)) {
            const [lat, lon] = place.split(',').map(Number);
            return { lat, lon };
        }
        // Sinon, chercher un arrêt par nom
        // (NOTE: ceci suppose que `plannerPanel.js` a été modifié pour ne plus 
        // utiliser Google Autocomplete, ou qu'il renvoie le nom exact de l'arrêt)
        const stop = dataManager.masterStops.find(s => s.stop_name.toLowerCase() === place.toLowerCase());
        if (stop) {
            return { lat: parseFloat(stop.stop_lat), lon: parseFloat(stop.stop_lon) };
        }
        return null;
    };
    // --- Fin des fonctions utilitaires ---

    const startCoords = getCoordsForPlace(fromPlace);
    const endCoords = getCoordsForPlace(toPlace);

    if (!startCoords || !endCoords) {
        let errorMsg = "Adresse invalide.";
        if (!startCoords) errorMsg = "Point de départ non trouvé. Veuillez choisir un arrêt ou utiliser votre localisation.";
        if (!endCoords) errorMsg = "Point d'arrivée non trouvé. Veuillez choisir un arrêt.";
        plannerPanel.showError(errorMsg);
        isPlannerMode = false;
        return;
    }

    // 2. Préparer et lancer la recherche
    const departureDate = timeManager.getCurrentDate(); // Utilise la date/heure actuelle
    
    try {
        const itineraryData = await localPathfinder.findItinerary(startCoords, endCoords, departureDate);

        if (itineraryData.status !== 'OK') {
            let errorMsg = "Aucun itinéraire trouvé.";
            if (itineraryData.status === 'NO_SERVICE') errorMsg = "Aucun service de bus ne circule à cette date.";
            if (itineraryData.status === 'NO_START_STOPS') errorMsg = "Aucun arrêt accessible à pied depuis votre point de départ.";
            if (itineraryData.status === 'NO_END_STOPS') errorMsg = "Aucun arrêt ne permet de rejoindre votre destination à pied.";
            plannerPanel.showError(errorMsg);
            isPlannerMode = false;
            return;
        }

        const legs = itineraryData.path;

        // 3. Nettoyer la carte
        mapRenderer.clearAllRoutes(); 
        mapRenderer.hideBusMarkers(); 
        mapRenderer.clearStops();     
        mapRenderer.clearItinerary();
        
        // 4. DESSINER LE NOUVEAU TRACÉ (logique locale)
        const allCoords = [];
        
        legs.forEach(leg => {
            let style = {};
            let legCoords = [];

            // Obtenir les coords de départ et de fin du "leg"
            const fromLatLon = leg.fromCoords || { lat: dataManager.getStop(leg.fromStopId).stop_lat, lon: dataManager.getStop(leg.fromStopId).stop_lon };
            const toLatLon = leg.toCoords || { lat: dataManager.getStop(leg.toStopId).stop_lat, lon: dataManager.getStop(leg.toStopId).stop_lon };

            legCoords = [
                [parseFloat(fromLatLon.lat), parseFloat(fromLatLon.lon)],
                [parseFloat(toLatLon.lat), parseFloat(toLatLon.lon)]
            ];

            if (leg.type === 'WALK') {
                style = {
                    color: '#6c757d',
                    weight: 4,
                    opacity: 0.8,
                    dashArray: '5, 10'
                };
            } else if (leg.type === 'BUS') {
                // AMÉLIORATION V2: On pourrait utiliser le GeoJSON de la route
                // pour dessiner le vrai tracé du bus au lieu d'une ligne droite.
                const transitColor = leg.route.route_color ? `#${leg.route.route_color}` : '#2563eb';
                style = {
                    color: transitColor,
                    weight: 6,
                    opacity: 0.9
                };
            }

            if (legCoords.length > 0) {
                allCoords.push(...legCoords);
                L.polyline(legCoords, style).addTo(mapRenderer.itineraryLayer);
            }
        });

        // 5. AJOUTER LES MARQUEURS DÉPART/ARRIVÉE
        L.marker([startCoords.lat, startCoords.lon], { 
            icon: L.divIcon({ className: 'stop-search-marker', html: '<div></div>', iconSize: [12, 12] })
        })
        .addTo(mapRenderer.itineraryLayer)
        .bindPopup(`<b>Départ</b>`);

        L.marker([endCoords.lat, endCoords.lon], { 
            icon: L.divIcon({ className: 'stop-search-marker', html: '<div></div>', iconSize: [12, 12] })
        })
        .addTo(mapRenderer.itineraryLayer)
        .bindPopup(`<b>Arrivée</b>`);

        // 6. ZOOMER SUR L'ENSEMBLE DU TRAJET
        if (allCoords.length > 0) {
            const bounds = L.latLngBounds(allCoords);
            mapRenderer.map.fitBounds(bounds, { padding: [50, 50] });
        }

        // 7. Afficher les instructions
        // (NOTE: plannerPanel.js doit aussi être mis à jour pour lire ce format local)
        plannerPanel.displayItinerary(itineraryData);

    } catch (error) {
        console.error("Erreur lors de la recherche d'itinéraire local:", error);
        plannerPanel.showError(error.message || "Erreur interne du calculateur d'itinéraire.");
        isPlannerMode = false;
    }
}
/**
 * ===================================================================
 * FIN DES MODIFICATIONS
 * ===================================================================
 */

/**
 * MODIFIÉ: Fonction de mise à jour principale
 */
function updateData(timeInfo) {
    if (isPlannerMode) {
        const currentSeconds = timeInfo ? timeInfo.seconds : timeManager.getCurrentSeconds();
        updateClock(currentSeconds);
        return; 
    }

    const currentSeconds = timeInfo ? timeInfo.seconds : timeManager.getCurrentSeconds();
    const currentDate = timeInfo ? timeInfo.date : new Date(); 
    
    updateClock(currentSeconds);
    
    const activeBuses = tripScheduler.getActiveTrips(currentSeconds, currentDate);
    
    const busesWithPositions = busPositionCalculator.calculateAllPositions(activeBuses)
        .filter(bus => bus !== null)
        .filter(bus => bus.route && visibleRoutes.has(bus.route.route_id)); 
    
    mapRenderer.updateBusMarkers(busesWithPositions, tripScheduler, currentSeconds);
    
    const visibleBusCount = busesWithPositions.length;
    const totalBusCount = visibleBusCount;
    updateBusCount(visibleBusCount, totalBusCount);
}

// Fonctions updateClock, updateBusCount, updateDataStatus (inchangées)
function updateClock(seconds) {
    const hours = Math.floor(seconds / 3600) % 24;
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    const timeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    document.getElementById('current-time').textContent = timeString;
    
    const now = new Date();
    const dateString = now.toLocaleDateString('fr-FR', { 
        weekday: 'short', 
        day: 'numeric', 
        month: 'short' 
    });
    document.getElementById('date-indicator').textContent = dateString;
}
function updateBusCount(visible, total) {
    const busCountElement = document.getElementById('bus-count');
    busCountElement.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="10"/>
        </svg>
        ${visible} bus
    `;
}
function updateDataStatus(message, status = '') {
    const statusElement = document.getElementById('data-status');
    statusElement.className = status;
    statusElement.textContent = message;
}

initializeApp();
