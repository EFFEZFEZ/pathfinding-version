/**
 * Fichier : /js/plannerPanel.js
 *
 * Gère le panneau latéral et affiche les résultats
 * de l'API Google Directions.
 *
 * CORRECTIONS :
 * 1. Suggestions (Autocomplete) limitées STRICTEMENT à la zone.
 * 2. Garde le nom du lieu dans le champ après sélection
 * (ne remplace plus par des coordonnées).
 */
export class PlannerPanel {
    constructor(panelId, dataManager, mapRenderer, searchCallback) {
        this.panel = document.getElementById(panelId);
        this.dataManager = dataManager;
        this.mapRenderer = mapRenderer;
        this.searchCallback = searchCallback; // La fonction de main.js

        // Éléments...
        this.fromInput = document.getElementById('planner-from');
        this.toInput = document.getElementById('planner-to');
        this.searchButton = document.getElementById('btn-search-itinerary');
        this.locateButton = document.getElementById('btn-use-location');
        this.loadingSpinner = document.getElementById('planner-loading');
        this.summaryContainer = document.getElementById('itinerary-summary');
        this.stepsContainer = document.getElementById('itinerary-steps');

        // Stocke les coordonnées si une suggestion est cliquée
        this.fromCoords = null;
        this.toCoords = null;

        this.bindEvents();
        
        // Initialiser l'autocomplétion
        window.initMap = () => {
            console.log("Google Maps JS est prêt, initialisation de l'autocomplete.");
            this.initAutocomplete(); 
        };
        if (typeof google !== 'undefined' && typeof google.maps !== 'undefined') {
            this.initAutocomplete();
        }
    }
    
    initAutocomplete() {
        if (typeof google === 'undefined' || !google.maps.places) {
            console.warn("Google Places API n'est pas chargée. Les suggestions ne fonctionneront pas.");
            return;
        }

        const center = { lat: 45.1833, lng: 0.7167 }; // Périgueux
        const defaultBounds = {
            north: center.lat + 0.3,
            south: center.lat - 0.3,
            east: center.lng + 0.3,
            west: center.lng - 0.3,
        };
        
        const options = {
            bounds: defaultBounds,
            componentRestrictions: { country: "fr" },
            // --- CORRECTION "UNIQUEMENT DORDOGNE" ---
            strictBounds: true, // Force les résultats à être dans cette zone
            fields: ["name", "formatted_address", "geometry"],
        };
        
        const fromAutocomplete = new google.maps.places.Autocomplete(this.fromInput, options);
        const toAutocomplete = new google.maps.places.Autocomplete(this.toInput, options);

        // --- CORRECTION "GARDER LES NOMS" ---
        fromAutocomplete.addListener('place_changed', () => {
            const place = fromAutocomplete.getPlace();
            if (place.geometry) {
                const loc = place.geometry.location;
                // On stocke les coordonnées pour la recherche
                this.fromCoords = `${loc.lat()},${loc.lng()}`;
                // Mais on affiche le nom dans le champ
                this.fromInput.value = place.name;
            }
        });
        
        toAutocomplete.addListener('place_changed', () => {
             const place = toAutocomplete.getPlace();
             if (place.geometry) {
                const loc = place.geometry.location;
                this.toCoords = `${loc.lat()},${loc.lng()}`;
                this.toInput.value = place.name;
            }
        });

        // Si l'utilisateur tape sans choisir, on efface les coordonnées stockées
        this.fromInput.addEventListener('input', () => { this.fromCoords = null; });
        this.toInput.addEventListener('input', () => { this.toCoords = null; });
    }

    bindEvents() {
        this.searchButton.addEventListener('click', () => {
            // S'il y a des coordonnées stockées (clic sur suggestion), on les utilise
            // Sinon, on utilise le texte tapé (ex: "marsac")
            const from = this.fromCoords || this.fromInput.value;
            const to = this.toCoords || this.toInput.value;

            if (from && to) {
                this.showLoading();
                this.searchCallback(from, to); // Appelle main.js
            }
            // Réinitialiser après la recherche
            this.fromCoords = null;
            this.toCoords = null;
        });

        this.locateButton.addEventListener('click', () => {
            this.mapRenderer.map.locate({ setView: true, maxZoom: 16 })
                .on('locationfound', (e) => {
                    const coords = `${e.latlng.lat.toFixed(5)},${e.latlng.lng.toFixed(5)}`;
                    this.fromInput.value = "Ma position"; // Affiche "Ma position"
                    this.fromCoords = coords; // Stocke les coordonnées
                })
                .on('locationerror', (e) => {
                    alert("Impossible de vous localiser.");
                });
        });
    }

    showLoading() {
        this.loadingSpinner.classList.remove('hidden');
        this.summaryContainer.innerHTML = '';
        this.stepsContainer.innerHTML = '';
    }

    hideLoading() {
        this.loadingSpinner.classList.add('hidden');
    }

    showError(message) {
        this.hideLoading();
        this.summaryContainer.innerHTML = `<p style="color: red; padding: 0 1.5rem;">${message}</p>`;
    }

    /**
     * Affiche l'itinéraire (réponse Google) dans le panneau
     */
    displayItinerary(itineraryData) {
        this.hideLoading();
        this.stepsContainer.innerHTML = '';

        if (!itineraryData.routes || itineraryData.routes.length === 0) {
            this.showError("Aucun itinéraire trouvé.");
            return;
        }

        const route = itineraryData.routes[0];
        const leg = route.legs[0]; 

        const duration = this.dataManager.formatDuration(leg.duration.value);
        const departureText = leg.departure_time?.text;
        const arrivalText = leg.arrival_time?.text;

        this.summaryContainer.innerHTML = `
            <h4>Le plus rapide : ${duration}</h4>
            ${ (departureText && arrivalText) ?
                `<p>${departureText} &ndash; ${arrivalText}</p>` :
                '' 
            }
        `;

        leg.steps.forEach(step => {
            this.stepsContainer.appendChild(this.createLegStep(step));
        });
    }

    /** Crée une étape de trajet (Marche ou Bus) */
    createLegStep(step) {
        const el = document.createElement('div');
        el.className = 'itinerary-leg';
        el.dataset.mode = step.travel_mode;

        const legDuration = step.duration.text;
        const startTime = step.departure_time?.text || '';

        let icon, details;

        if (step.travel_mode === 'WALKING') {
            icon = 'directions_walk';
            details = `
                <strong>${step.html_instructions}</strong>
                <div class="leg-time-info">${legDuration} (${step.distance.text})</div>
            `;
        } else if (step.travel_mode === 'TRANSIT') {
            icon = 'directions_bus';
            const transit = step.transit_details;
            const line = transit.line;
            // Utilise la couleur du badge fournie par l'API
            const routeColor = line.color || '#333';
            const textColor = line.text_color || this.getContrastColor(routeColor);

            details = `
                <div class="leg-time-info">${startTime} - Prendre à <strong>${transit.departure_stop.name}</strong></div>
                <div class="leg-route">
                    <span class="leg-badge" style="background-color: ${routeColor}; color: ${textColor};">
                        ${line.short_name || line.name}
                    </span>
                    <strong>Direction ${transit.headsign}</strong>
                </div>
                <div class="leg-time-info">
                    ${transit.num_stops} arrêt(s) (${legDuration})
                </div>
                <div class="leg-time-info" style="margin-top: 5px;">
                    Descendre à <strong>${transit.arrival_stop.name}</strong>
                </div>
            `;
        } else {
            icon = 'help';
            details = `<strong>${step.html_instructions}</strong>`;
        }

        el.innerHTML = `
            <div class="leg-icon">
                <span class="material-icons">${icon}</span>
                <div class="leg-line"></div>
            </div>
            <div class="leg-details">
                ${details}
            </div>
        `;
        return el;
    }

    /** Calcule si le texte doit être blanc ou noir sur une couleur de fond */
    getContrastColor(hexcolor) {
        if (!hexcolor) return '#000000';
        hexcolor = hexcolor.replace("#", "");
        if (hexcolor.length === 3) {
            hexcolor = hexcolor.split('').map(c => c + c).join('');
        }
        if (hexcolor.length !== 6) return '#000000';
        
        const r = parseInt(hexcolor.substr(0, 2), 16);
        const g = parseInt(hexcolor.substr(2, 2), 16);
        const b = parseInt(hexcolor.substr(4, 2), 16);
        const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
        return (yiq >= 128) ? '#000000' : '#FFFFFF';
    }
}
