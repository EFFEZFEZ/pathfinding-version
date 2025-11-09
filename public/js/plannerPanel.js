/**
 * Fichier : /js/plannerPanel.js
 *
 * VERSION AUTONOME (Refonte V2)
 * Gère le panneau latéral et affiche les résultats
 * de notre propre 'localPathfinder.js'.
 *
 * SUPPRIMÉ :
 * - Toute dépendance à l'API Google Maps Places (initAutocomplete).
 *
 * MODIFIÉ :
 * - displayItinerary() et createLegStep() pour lire le format
 * de réponse de notre 'localPathfinder'.
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

        // Divs pour les résultats de recherche (remplace Google Autocomplete)
        this.fromResults = this.createResultsContainer(this.fromInput);
        this.toResults = this.createResultsContainer(this.toInput);

        // Stocke les coordonnées ou le nom de l'arrêt
        this.fromValue = null;
        this.toValue = null;

        this.bindEvents();
        
        // Cacher les résultats si on clique ailleurs
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.input-group')) {
                 this.fromResults.classList.add('hidden');
                 this.toResults.classList.add('hidden');
            }
        });
    }

    /**
     * Crée un conteneur de résultats sous un champ de saisie
     */
    createResultsContainer(inputElement) {
        const container = document.createElement('div');
        container.className = 'planner-search-results hidden';
        inputElement.parentNode.insertBefore(container, inputElement.nextSibling);
        return container;
    }

    /**
     * Remplace l'autocomplétion Google par une recherche locale
     */
    handleLocalSearch(e, resultsContainer, valueTarget) {
        const query = e.target.value.toLowerCase();
        resultsContainer.innerHTML = '';
        
        if (query.length < 2) {
            resultsContainer.classList.add('hidden');
            return;
        }

        const matches = this.dataManager.masterStops
            .filter(stop => stop.stop_name.toLowerCase().includes(query))
            .slice(0, 5); // 5 résultats max

        if (matches.length === 0) {
            resultsContainer.classList.add('hidden');
            return;
        }

        matches.forEach(stop => {
            const item = document.createElement('div');
            item.className = 'planner-result-item';
            const regex = new RegExp(`(${query})`, 'gi');
            item.innerHTML = stop.stop_name.replace(regex, '<strong>$1</strong>');
            
            item.addEventListener('click', () => {
                e.target.value = stop.stop_name; // Affiche le nom
                this[valueTarget] = stop.stop_name; // Stocke le nom pour la recherche
                resultsContainer.classList.add('hidden');
            });
            resultsContainer.appendChild(item);
        });
        resultsContainer.classList.remove('hidden');
    }

    bindEvents() {
        // Recherche locale pour le champ "Départ"
        this.fromInput.addEventListener('input', (e) => {
            this.handleLocalSearch(e, this.fromResults, 'fromValue');
            this.fromValue = e.target.value; // Au cas où ils tapent une coord
        });
        // Garde les résultats ouverts si on clique dans le champ
        this.fromInput.addEventListener('focus', (e) => {
            this.handleLocalSearch(e, this.fromResults, 'fromValue');
        });
        
        // Recherche locale pour le champ "Arrivée"
        this.toInput.addEventListener('input', (e) => {
            this.handleLocalSearch(e, this.toResults, 'toValue');
            this.toValue = e.target.value; // Au cas où ils tapent une coord
        });
        // Garde les résultats ouverts si on clique dans le champ
        this.toInput.addEventListener('focus', (e) => {
            this.handleLocalSearch(e, this.toResults, 'toValue');
        });

        // Bouton de recherche
        this.searchButton.addEventListener('click', () => {
            // Utilise la valeur stockée (nom d'arrêt ou coord)
            const from = this.fromValue || this.fromInput.value;
            const to = this.toValue || this.toInput.value;

            if (from && to) {
                this.showLoading();
                this.searchCallback(from, to); // Appelle main.js
            }
        });

        // Bouton "Ma Position"
        this.locateButton.addEventListener('click', () => {
            this.mapRenderer.map.locate({ setView: false, maxZoom: 16 })
                .on('locationfound', (e) => {
                    const coords = `${e.latlng.lat.toFixed(5)},${e.latlng.lng.toFixed(5)}`;
                    this.fromInput.value = "Ma position"; // Affiche "Ma position"
                    this.fromValue = coords; // Stocke les coordonnées
                    this.fromResults.classList.add('hidden'); // Cache les suggestions
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
     * Affiche l'itinéraire (réponse de localPathfinder) dans le panneau
     */
    displayItinerary(itineraryData) {
        this.hideLoading();
        this.stepsContainer.innerHTML = '';

        if (itineraryData.status !== 'OK' || !itineraryData.path || itineraryData.path.length === 0) {
            this.showError("Aucun itinéraire trouvé.");
            return;
        }

        const legs = itineraryData.path;
        const totalDuration = itineraryData.stats.duration;
        
        const firstLeg = legs[0];
        const lastLeg = legs[legs.length - 1];

        // Formater les heures de départ et d'arrivée
        const departureTime = this.dataManager.formatTime(firstLeg.startTime).substring(0, 5);
        const arrivalTime = this.dataManager.formatTime(lastLeg.endTime).substring(0, 5);

        this.summaryContainer.innerHTML = `
            <h4>Le plus rapide : ${this.dataManager.formatDuration(totalDuration)}</h4>
            <p>${departureTime} &ndash; ${arrivalTime}</p>
        `;

        legs.forEach(leg => {
            this.stepsContainer.appendChild(this.createLegStep(leg));
        });
    }

    /** Crée une étape de trajet (Marche ou Bus) à partir de notre format local */
    createLegStep(leg) {
        const el = document.createElement('div');
        el.className = 'itinerary-leg';
        el.dataset.mode = leg.type;

        const legDuration = this.dataManager.formatDuration(leg.duration);
        const startTime = this.dataManager.formatTime(leg.startTime).substring(0, 5);

        let icon, details;

        if (leg.type === 'WALK') {
            icon = 'directions_walk';
            const distance = leg.distance > 1000 
                ? `${(leg.distance / 1000).toFixed(1)} km`
                : `${Math.round(leg.distance)} m`;
            
            let instruction = "Marcher";
            if (leg.fromStopName) {
                instruction = `Marcher de <strong>${leg.fromStopName}</strong>`;
            } else if (leg.fromCoords) {
                instruction = `Marcher de <strong>votre point de départ</strong>`;
            }
            
            if (leg.toStopName) {
                instruction += ` à <strong>${leg.toStopName}</strong>`;
            } else if (leg.toCoords) {
                instruction += ` à <strong>votre destination</strong>`;
            }

            details = `
                <strong>${instruction}</strong>
                <div class="leg-time-info">${legDuration} (${distance})</div>
            `;
        } else if (leg.type === 'BUS') {
            icon = 'directions_bus';
            const transit = leg;
            const line = transit.route;
            
            const routeColor = line.route_color ? `#${line.route_color}` : '#333';
            const textColor = line.route_text_color ? `#${line.route_text_color}` : this.getContrastColor(routeColor);

            details = `
                <div class="leg-time-info">${startTime} - Prendre à <strong>${transit.fromStopName}</strong></div>
                <div class="leg-route">
                    <span class="leg-badge" style="background-color: ${routeColor}; color: ${textColor};">
                        ${line.route_short_name || line.route_id}
                    </span>
                    <strong>Direction ${transit.headsign}</strong>
                </div>
                <div class="leg-time-info">
                    ${legDuration}
                </div>
                <div class="leg-time-info" style="margin-top: 5px;">
                    Descendre à <strong>${transit.toStopName}</strong>
                </div>
            `;
        } else {
            icon = 'help';
            details = `<strong>Étape inconnue</strong>`;
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
