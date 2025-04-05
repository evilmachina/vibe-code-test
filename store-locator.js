(async function() {
    // --- Configuration ---
    const rootElementId = 'store-locator-root';
    const URL_PARAM_NAME = 'storeCode'; // URL parameter for deep linking
    const LANDING_PAGE_URL = 'landingpage.html'; // Target page for the link
    const API_URL = "https://api.storelocator.hmgroup.tech/v2/brand/hm/stores/locale/sv_se/country/SE?_type=json&campaigns=true&departments=true&openinghours=true&maxnumberofstores=100";
    const LEAFLET_JS_CDN = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    const LEAFLET_CSS_CDN = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';

    // --- Fallback Reference Location (Malmö, Sweden) ---
    const FALLBACK_USER_LAT = 55.60498;
    const FALLBACK_USER_LON = 13.00382;

    // --- Application State ---
    let allStores = [];
    let filteredStores = [];
    let selectedStoreId = null; // This variable holds the storeCode
    let searchTerm = '';
    let isLoading = true;
    let error = null;
    let mapInstance = null;
    let mapMarkers = {}; // { storeCode: markerInstance }
    let initialStoreIdFromUrl = null; // Store ID (storeCode) from URL parameter
    let currentUserLat = FALLBACK_USER_LAT; // Use fallback initially
    let currentUserLon = FALLBACK_USER_LON;
    let locationStatusMessage = 'Distance from Malmö.'; // Default status

    // --- DOM Element References ---
    let rootElement = null;
    let searchInputElement = null;
    let listContainerElement = null;
    let mapContainerElement = null;
    let footerElement = null;

    // --- Dependency Loading Functions ---
    function loadScript(src, globalVarName) {
        return new Promise((resolve, reject) => {
            if (window[globalVarName]) { resolve(); return; }
            if (document.querySelector(`script[src="${src}"]`)) {
                const interval = setInterval(() => { if (window[globalVarName]) { clearInterval(interval); resolve(); } }, 100);
                setTimeout(() => { if (!window[globalVarName]) { clearInterval(interval); reject(new Error(`Timeout waiting for existing script ${src}`)); }}, 10000);
                return;
            }
            console.log(`Store Locator: Loading ${globalVarName}...`);
            const script = document.createElement('script');
            script.src = src;
            script.async = false;
            script.onload = () => { console.log(`Store Locator: ${globalVarName} loaded.`); resolve(); };
            script.onerror = () => { console.error(`Store Locator Error: Failed to load script: ${src}`); reject(new Error(`Script load error for ${src}`)); };
            document.head.appendChild(script);
        });
    }

    function loadCSS(href) {
         if (document.querySelector(`link[href="${href}"]`)) return;
         console.log(`Store Locator: Loading CSS ${href}...`);
        const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = href;
        link.onerror = () => console.error(`Store Locator Error: Failed to load CSS: ${href}`);
        document.head.appendChild(link);
    }

    // --- Geolocation Function ---
    function getUserLocation() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error("Geolocation is not supported by this browser."));
                return;
            }
            navigator.geolocation.getCurrentPosition(
                (position) => { // Success
                    console.log("Store Locator: Geolocation success.", position.coords);
                    resolve({
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude
                    });
                },
                (error) => { // Error
                    console.warn("Store Locator: Geolocation error.", error);
                    let reason;
                    switch(error.code) {
                        case error.PERMISSION_DENIED: reason = "Permission denied."; break;
                        case error.POSITION_UNAVAILABLE: reason = "Location unavailable."; break;
                        case error.TIMEOUT: reason = "Request timed out."; break;
                        default: reason = "Unknown error."; break;
                    }
                    reject(new Error(`Geolocation failed: ${reason}`));
                },
                { // Options
                    enableHighAccuracy: false,
                    timeout: 10000, // 10 seconds
                    maximumAge: 60000 // Allow cached location up to 1 minute old
                }
            );
        });
    }


    // --- Helper Functions ---
    function formatAddress(addr) { if (!addr) return 'Address not available'; const s = addr.streetName1||'', n=addr.streetNumber||''; return [s,n].filter(p=>p!=null&&String(p).trim()!=='').join(' ').trim()||'Address details missing'; }
    function formatOpeningHours(a) { if (!a || !Array.isArray(a) || a.length === 0) return 'Not available'; const n=new Date(), i=n.getDay(), d=(i===0)?7:i; let h=a.find(o=>{if(o.day==null)return false;const c=parseInt(o.day,10);return !isNaN(c)&&c===d}); if(h){if(h.opens&&h.closes){return `${h.opens} - ${h.closes}`}else{return 'Closed today'}}else{return "Hours unavailable for today"}} // Refined fallback
    function cleanPhoneNumber(phone) { if (!phone) return ''; return phone.replace(/[\s\-()]/g, ''); }

    // --- Haversine Distance Calculation ---
    function calculateDistance(lat1, lon1, lat2, lon2) {
        function toRad(value) { return value * Math.PI / 180; }
        const R = 6371; // Earth radius in kilometers
        try {
            lat1 = parseFloat(lat1); lon1 = parseFloat(lon1); lat2 = parseFloat(lat2); lon2 = parseFloat(lon2);
            if (isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) return null;
            const dLat = toRad(lat2 - lat1); const dLon = toRad(lon2 - lon1);
            const rLat1 = toRad(lat1); const rLat2 = toRad(lat2);
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(rLat1) * Math.cos(rLat2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c; // Distance in km
        } catch (e) { console.error("Error calculating distance:", e); return null; }
    }


    // --- URL Update Function ---
    function updateUrlWithSelection() {
        const currentUrl = new URL(window.location.href);
        const searchParams = currentUrl.searchParams;
        if (selectedStoreId) { searchParams.set(URL_PARAM_NAME, selectedStoreId); } else { searchParams.delete(URL_PARAM_NAME); }
        let newRelativeUrl = window.location.pathname;
        const searchString = searchParams.toString();
        if (searchString) { newRelativeUrl += '?' + searchString; }
        if (newRelativeUrl !== (window.location.pathname + window.location.search)) {
             console.log(`SL: Updating URL to: ${newRelativeUrl}`);
             history.pushState({ storeCode: selectedStoreId }, '', newRelativeUrl);
        }
    }

    // --- DOM Manipulation / Rendering Functions ---

    function injectCustomCSS() {
         // Basic CSS + Link Styling + Zero Margin Paragraphs in List
         const customCSS = `
            :root { /* CSS Variables */
                --sl-text-primary: #111827; --sl-text-secondary: #4b5563; --sl-text-muted: #6b7280; --sl-bg-primary: #ffffff; --sl-bg-secondary: #f9fafb; --sl-border-color: #e5e7eb; --sl-panel-border-color: #e5e7eb; --sl-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1); --sl-highlight-bg: rgba(59, 130, 246, 0.1); --sl-input-border: #d1d5db; --sl-input-bg: #ffffff; --sl-map-bg: #e5e7eb; --sl-link-color: #2563eb; /* blue-600 */
            }
            html.dark { /* Basic Dark Mode */
                --sl-text-primary: #f9fafb; --sl-text-secondary: #d1d5db; --sl-text-muted: #9ca3af; --sl-bg-primary: #1f2937; --sl-bg-secondary: #111827; --sl-border-color: #374151; --sl-panel-border-color: #374151; --sl-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.2), 0 1px 2px -1px rgb(0 0 0 / 0.1); --sl-highlight-bg: rgba(59, 130, 246, 0.2); --sl-input-border: #4b5563; --sl-input-bg: #374151; --sl-map-bg: #374151; --sl-link-color: #60a5fa; /* blue-400 */
            }
            /* Root element */
             #${rootElementId} { height: 100vh; max-height: 800px; width: 100%; overflow: hidden; font-family: Inter, sans-serif; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; color: var(--sl-text-primary); background-color: var(--sl-bg-secondary); display: flex; flex-direction: column; }
             @media (min-width: 768px) { #${rootElementId} { flex-direction: row; } }
             body { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
            /* Panels */
            .sl-left-panel { background-color: var(--sl-bg-primary); border-right: 1px solid var(--sl-panel-border-color); box-shadow: var(--sl-shadow); display: flex; flex-direction: column; height: 100%; width: 100%; flex-shrink: 0; }
             @media (min-width: 768px) { .sl-left-panel { width: 350px; } }
             @media (min-width: 1024px) { .sl-left-panel { width: 400px; } }
            .sl-right-panel { flex-grow: 1; min-width: 0; height: 100%; }

            /* Header, Search, Footer */
            .sl-header, .sl-search-area, .sl-footer {
                padding: 0.75rem 0.5rem; /* Vertical 0.75, Horizontal 0.5 */
                flex-shrink: 0;
                border-color: var(--sl-border-color);
            }
            .sl-header { border-bottom-width: 1px; text-align: center; } .sl-header h1 { font-size: 1.125rem; font-weight: 600; color: var(--sl-text-primary); }
            .sl-footer { border-top-width: 1px; text-align: center; font-size: 0.75rem; color: var(--sl-text-muted); padding-top: 0.5rem; padding-bottom: 0.5rem; }
            .sl-search-area { padding-top: 0.75rem; padding-bottom: 0.75rem; }

            /* Search Input */
            .sl-search-input { display: flex; height: 2.5rem; width: 100%; border-radius: 0.375rem; border: 1px solid var(--sl-input-border); background-color: var(--sl-input-bg); padding: 0.5rem 0.75rem; font-size: 0.875rem; color: var(--sl-text-primary); }
            .sl-search-input::placeholder { color: var(--sl-text-muted); } .sl-search-input:focus { outline: none; } .sl-search-input:disabled { cursor: not-allowed; opacity: 0.5; }
            /* List Container */
            .sl-list-container { flex-grow: 1; overflow-y: auto; min-height: 0; padding: 0 0.5rem 0.5rem 0.5rem; } /* Horizontal padding is 0.5rem */

            /* --- List Item Zero Margin Adjustments --- */
            .store-list-item { margin-bottom: 0.125rem; border-radius: 0.375rem; border: 1px solid var(--sl-border-color); box-shadow: var(--sl-shadow); cursor: pointer; transition: background-color 0.15s ease-in-out; background-color: var(--sl-bg-primary); }
            .store-list-item:hover { background-color: var(--sl-bg-secondary); }
            .store-list-item > div.store-list-item-header { padding: 0.25rem 0.75rem; }
            .store-list-item > div.store-list-item-header h3 { font-size: 0.875rem; font-weight: 600; line-height: 1.25; color: var(--sl-text-primary); margin: 0; }
            .store-list-item > div.store-list-item-content { padding: 0.125rem 0.75rem 0.25rem 0.75rem; font-size: 0.75rem; }
            .store-list-item > div.store-list-item-content p { margin: 0; color: var(--sl-text-secondary); line-height: 1.3; }
            .store-list-item > div.store-list-item-content span { font-weight: 500; }
            /* ------------------------------------ */

            /* Map Container */
            .sl-map-container { height: 100%; width: 100%; background-color: var(--sl-map-bg); border-radius: 0.5rem; box-shadow: var(--sl-shadow); }
             .leaflet-container { height: 100%; width: 100%; border-radius: 0.5rem; }
             /* Selected list item highlight */
             .store-list-item.selected { background-color: var(--sl-highlight-bg); }
             /* Loader */
            .loader { border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; width: 30px; height: 30px; animation: spin 1s linear infinite; margin: 20px auto; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            /* Utilities */
            .sl-error-text { text-align: center; color: #dc2626; margin-top: 1rem; padding: 0 0.5rem; } html.dark .sl-error-text { color: #f87171; }
            .sl-muted-text { text-align: center; color: var(--sl-text-muted); margin-top: 1rem; padding: 0 0.5rem; }

            /* --- Link Styles --- */
            .sl-item-links { /* Container for the links */
                 margin-top: 0.25rem; /* Space above links */
                 display: flex;
                 flex-wrap: wrap; /* Allow links to wrap */
                 gap: 0.75rem; /* Space between links */
            }
            .sl-details-link, .sl-directions-link {
                color: var(--sl-link-color);
                text-decoration: none;
                font-weight: 500;
                font-size: 0.75rem;
            }
            .sl-details-link:hover, .sl-directions-link:hover { text-decoration: underline; }
            /* ------------------- */

            /* --- Added Phone Link Style --- */
            .sl-phone-link { color: inherit; text-decoration: none; }
            .sl-phone-link:hover { text-decoration: underline; }
        `;
        try {
            const styleElement = document.createElement('style');
            styleElement.type = 'text/css'; styleElement.innerHTML = customCSS; document.head.appendChild(styleElement);
            console.log('Store Locator: Custom CSS injected.');
        } catch (e) { console.error('Store Locator Error: Failed to inject CSS.', e); }
    }

    function ensureRootElement() {
        rootElement = document.getElementById(rootElementId);
        if (!rootElement) {
            console.log(`Store Locator: Root element #${rootElementId} not found. Creating...`);
            rootElement = document.createElement('div'); rootElement.id = rootElementId; document.body.appendChild(rootElement);
        } else { console.log(`Store Locator: Found root element #${rootElementId}.`); }
        rootElement.innerHTML = ''; // Clear previous content
    }

    function renderLayout() {
        // Assign semantic classes
        rootElement.className = ""; // Clear previous potentially conflicting classes
        rootElement.style.fontFamily = "Inter, sans-serif"; // Ensure font

        const leftPanel = document.createElement('div'); leftPanel.className = "sl-left-panel";
        const header = document.createElement('header'); header.className = "sl-header"; header.innerHTML = `<h1>H&M Store Locator (SE)</h1>`;
        const searchArea = document.createElement('div'); searchArea.className = "sl-search-area"; // Class applies padding
        searchInputElement = document.createElement('input'); searchInputElement.type = "text"; searchInputElement.placeholder = "Search by name, city, zip..."; searchInputElement.setAttribute("aria-label", "Search for stores"); searchInputElement.className = "sl-search-input"; // Input takes full width of parent padding box
        searchInputElement.disabled = isLoading; // Set initial state based on isLoading
        searchInputElement.addEventListener('input', handleSearchInput);
        searchArea.appendChild(searchInputElement);
        listContainerElement = document.createElement('div'); listContainerElement.className = "sl-list-container"; listContainerElement.id = "store-list-container";
        footerElement = document.createElement('footer'); footerElement.className = "sl-footer"; updateFooter();
        leftPanel.append(header, searchArea, listContainerElement, footerElement);

        const rightPanel = document.createElement('div'); rightPanel.className = "sl-right-panel";
        mapContainerElement = document.createElement('div'); mapContainerElement.className = "sl-map-container"; mapContainerElement.id = "map-container";
        rightPanel.appendChild(mapContainerElement);

        rootElement.append(leftPanel, rightPanel); // Use append for multiple elements
        console.log("Store Locator: Initial layout rendered (Basic CSS).");
    }

    function renderStoreList() {
        if (!listContainerElement) return;
        listContainerElement.innerHTML = ''; // Clear previous list

        if (isLoading) { listContainerElement.innerHTML = '<div class="loader"></div>'; return; }
        if (error) { listContainerElement.innerHTML = `<p class="sl-error-text">Error loading stores: ${error}</p>`; return; }
        if (!filteredStores || filteredStores.length === 0) { listContainerElement.innerHTML = `<p class="sl-muted-text">No stores found.</p>`; return; }

        const listFragment = document.createDocumentFragment();
        filteredStores.forEach(store => {
            const isSelected = store.id === selectedStoreId;
            const itemDiv = document.createElement('div');
            itemDiv.id = `store-item-${store.id}`;
            itemDiv.className = `store-list-item ${isSelected ? 'selected' : ''}`;

            const detailsLinkUrl = `${LANDING_PAGE_URL}?${URL_PARAM_NAME}=${encodeURIComponent(store.id)}`;

            // Create Directions Link (if lat/lng exist)
            let directionsLinkHtml = '';
            if (store.lat != null && store.lng != null) {
                const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${store.lat},${store.lng}`;
                directionsLinkHtml = `
                   <a href="${directionsUrl}" target="_blank" rel="noopener noreferrer" class="sl-directions-link">
                       Get Directions »
                   </a>`;
            }

            // Create Phone HTML (Link or N/A)
            let phoneHtml;
            const rawPhone = store.phone;
            if (rawPhone && rawPhone !== 'N/A') {
                const cleanedPhone = cleanPhoneNumber(rawPhone);
                phoneHtml = `<a href="tel:${cleanedPhone}" class="sl-phone-link">${rawPhone}</a>`;
            } else {
                phoneHtml = 'N/A';
            }

            // Create Combined Address Line
            const addressParts = [];
            const streetAddress = store.address;
            if (streetAddress && streetAddress !== 'Address unavailable' && streetAddress !== 'Address details missing') {
                 addressParts.push(streetAddress);
            }
            if (store.city) {
                 addressParts.push(store.city);
            }
            let addressCityString = addressParts.join(', ');
            if (store.zip) {
                 addressCityString += (addressCityString ? `, ${store.zip}` : store.zip);
            }
            if (!addressCityString) {
                 addressCityString = 'Address not available';
            }

            // Create Distance HTML
            let distanceHtml = '';
            if (store.distance != null) { // Check if distance was calculated
                distanceHtml = `<p><span>Distance:</span> ${store.distance.toFixed(1)} km</p>`;
            } else {
                // Don't show distance line if it couldn't be calculated
                // distanceHtml = `<p><span>Distance:</span> N/A</p>`;
            }

            // UPDATED innerHTML with Distance and Links container
            itemDiv.innerHTML = `
                <div class="store-list-item-header">
                    <h3>${store.name || 'Store Name Unavailable'}</h3>
                </div>
                <div class="store-list-item-content">
                   <p>${addressCityString}</p>
                   ${distanceHtml} 
                   <p><span>Phone:</span> ${phoneHtml}</p>
                   <p><span>Today's Hours:</span> ${store.hours || 'Not available'}</p>
                   <div class="sl-item-links">
                       <a href="${detailsLinkUrl}" target="_blank" rel="noopener noreferrer" class="sl-details-link">
                           Store Details »
                       </a>
                       ${directionsLinkHtml}
                   </div>
                </div>
            `;
            itemDiv.addEventListener('click', (event) => {
                // Prevent selection if clicking any link inside the item
                if (event.target.closest('a')) {
                    return;
                }
                handleSelection(store.id);
            });
            listFragment.appendChild(itemDiv);
        });
        listContainerElement.appendChild(listFragment);
        updateFooter();
        // Scroll only if the selection was potentially set from URL initially AND the list was just rendered
        if (initialStoreIdFromUrl && selectedStoreId === initialStoreIdFromUrl) {
             scrollListIfNeeded();
        }
    }

    // --- Other functions (updateFooter, scrollListIfNeeded, Map functions, Event Handlers, Fetch logic) ---
    function updateFooter() {
        if (!footerElement) return;
        const baseText = !isLoading && !error ? `${filteredStores.length} store(s) found.` : (isLoading ? 'Loading...' : ' ');
        // Append location status message
        footerElement.textContent = `${baseText} ${locationStatusMessage}`;
    }
    function scrollListIfNeeded() { if (selectedStoreId && listContainerElement) { const e = document.getElementById(`store-item-${selectedStoreId}`); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }); } }
    // Map Functions (Identical logic, keys/IDs are now storeCode)
    function initializeMap() { if (!mapContainerElement || mapInstance || typeof L === 'undefined') { return; } try { console.log("SL: Init Map"); mapInstance = L.map(mapContainerElement).setView([62.0, 15.0], 5); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OSM', maxZoom: 18 }).addTo(mapInstance); console.log("SL: Map OK"); } catch (e) { console.error("SL: MapInit Err", e); mapContainerElement.innerHTML = `<p class="sl-error-text">Error initializing map.</p>`; } }
    function updateMapMarkers() { if (!mapInstance || typeof L === 'undefined') return; console.log(`SL: Update ${filteredStores.length} markers`); Object.values(mapMarkers).forEach(m => mapInstance.removeLayer(m)); mapMarkers = {}; let a = 0; filteredStores.forEach(s => { const lt = s?.lat; const lg = s?.lng; if (lt != null && lg != null) { try { const pLt = parseFloat(lt); const pLg = parseFloat(lg); if (!isNaN(pLt) && !isNaN(pLg)) { const k = L.marker([pLt, pLg]).addTo(mapInstance).bindPopup(`<b>${s.name || 'Store'}</b><br>${s.address || 'Address unavailable'}`); k.on('click', () => handleSelection(s.id)); mapMarkers[s.id] = k; a++; } else { console.warn(`SL: Invalid coords ${s.id}`); } } catch (e) { console.error(`SL: MarkerErr ${s.id}`, e); } } }); console.log(`SL: ${a} markers added.`); if (!selectedStoreId && a > 0) { try { const g = L.featureGroup(Object.values(mapMarkers)); mapInstance.fitBounds(g.getBounds().pad(0.3)); } catch (e) { console.error("SL: BoundsErr", e); mapInstance.setView([62.0, 15.0], 5); } } else if (a === 0) { mapInstance.setView([62.0, 15.0], 5); } }
    function handleMapSelection() { if (!mapInstance || typeof L === 'undefined' || !selectedStoreId) { if (mapInstance) mapInstance.closePopup(); return; } const m = mapMarkers[selectedStoreId]; if (m) { try { const l = m.getLatLng(); mapInstance.flyTo(l, 14, { animate: true, duration: 0.8 }); setTimeout(() => { if (m && mapInstance.hasLayer(m)) { m.openPopup(); } }, 850); } catch (e) { console.error("SL: FlyToErr", e); } } else { console.warn(`SL: Marker not found ${selectedStoreId}`); } }

    // Event Handlers & State Logic
    function handleSearchInput(event) {
        searchTerm = event.target.value;
        selectedStoreId = null; // Deselect on new search
        filterStores();
        renderStoreList();
        updateMapMarkers();
        updateUrlWithSelection(); // Remove storeCode from URL on search change
    }
    function filterStores() { const t = searchTerm.trim().toLowerCase(); if (!t) { filteredStores = [...allStores]; } else { filteredStores = allStores.filter(s => (s.name && s.name.toLowerCase().includes(t)) || (s.city && s.city.toLowerCase().includes(t)) || (s.zip && s.zip.includes(t))); } if (selectedStoreId && !filteredStores.some(s => s.id === selectedStoreId)) { selectedStoreId = null; } }
    // handleSelection now also updates URL
    function handleSelection(storeCode) {
        console.log(`SL: Select ${storeCode}`);
        const previouslySelected = selectedStoreId;
        selectedStoreId = (selectedStoreId === storeCode) ? null : storeCode; // Toggle selection

        // Update list item classes for highlight
        if (previouslySelected) { document.getElementById(`store-item-${previouslySelected}`)?.classList.remove('selected'); }
        if (selectedStoreId) { document.getElementById(`store-item-${selectedStoreId}`)?.classList.add('selected'); }

        handleMapSelection(); // Fly map
        scrollListIfNeeded(); // Scroll list
        updateUrlWithSelection(); // Update URL
    }
    // --- UPDATED fetchAndProcessStores signature ---
    async function fetchAndProcessStores(currentLat, currentLon) {
        isLoading = true;
        error = null;
        // Update UI immediately to show loading state
        if(searchInputElement) searchInputElement.disabled = true;
        renderStoreList(); // Show loader in list
        updateFooter();
        console.log("SL: Fetching...");
        try {
            const r = await fetch(API_URL);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const d = await r.json();
            if (!d || !Array.isArray(d.stores)) throw new Error("API Format");
            allStores = d.stores.map((s, i) => {
                const latitude = s.latitude ?? s.lat ?? s.location?.latitude;
                const longitude = s.longitude ?? s.lng ?? s.location?.longitude;
                const storeIdentifier = s.storeCode || s.storeId || s.id || `gen-${i}`;
                // --- Calculate distance using provided coords ---
                let distanceKm = null;
                if (latitude != null && longitude != null && currentLat != null && currentLon != null) {
                     distanceKm = calculateDistance(currentLat, currentLon, latitude, longitude);
                }
                // ---------------------------------------------
                return {
                    id: storeIdentifier,
                    name: s.name || 'N/A',
                    address: formatAddress(s.address),
                    city: s.city || '',
                    zip: s.address?.postalCode || '',
                    phone: s.phoneNumber || s.phone || s.address?.phoneNumber || s.telephone || 'N/A',
                    hours: formatOpeningHours(s.openingHours),
                    lat: latitude,
                    lng: longitude,
                    distance: distanceKm // Add distance property
                 };
            });
             // --- Sort stores by distance ---
             allStores.sort((a, b) => {
                 if (a.distance === null) return 1;
                 if (b.distance === null) return -1;
                 return a.distance - b.distance;
             });
            console.log(`SL: Processed and sorted ${allStores.length} stores.`);
            filterStores(); // Apply initial filter (shows all sorted stores)
        } catch (err) {
            console.error("SL: FetchErr", err);
            error = err.message;
            allStores = [];
            filteredStores = [];
        } finally {
            isLoading = false;
            // Re-enable search input AFTER loading finishes
            if (searchInputElement) {
                searchInputElement.disabled = false;
            }
             updateFooter(); // Update footer after loading state changes
        }
    }

    // --- Initialization ---
    async function initializeApp() {
        try {
            console.log('Store Locator: Initializing App (Vanilla JS)...');

            // --- Get User Location or Use Fallback ---
            let userLat = FALLBACK_USER_LAT;
            let userLon = FALLBACK_USER_LON;
            locationStatusMessage = 'Distance from Malmö.'; // Default message

            try {
                console.log('Store Locator: Requesting user location...');
                const coords = await getUserLocation(); // Attempt to get real location
                userLat = coords.latitude;
                userLon = coords.longitude;
                currentUserLat = userLat; // Update global state for potential future use
                currentUserLon = userLon;
                locationStatusMessage = 'Distance from your location.'; // Update status
                console.log(`Store Locator: ${locationStatusMessage}`);
            } catch (geoError) {
                console.warn(`Store Locator: Geolocation failed - ${geoError.message}. ${locationStatusMessage}`);
                // Keep default Malmö coordinates (already set in currentUserLat/Lon)
            }
            // -----------------------------------------

            const urlParams = new URLSearchParams(window.location.search);
            initialStoreIdFromUrl = urlParams.get(URL_PARAM_NAME);
            let applyInitialSelection = false;
            if (initialStoreIdFromUrl) {
                console.log(`Store Locator: Found initial store code from URL: ${initialStoreIdFromUrl}`);
                selectedStoreId = initialStoreIdFromUrl; // Set initial state
            }

            loadCSS(LEAFLET_CSS_CDN);
            await loadScript(LEAFLET_JS_CDN, 'L');
            if (typeof L === 'undefined') throw new Error("Leaflet JS failed to load.");

            injectCustomCSS();
            ensureRootElement();
            renderLayout(); // Renders layout, search input is disabled initially because isLoading=true
            initializeMap();
            // --- Pass user location to fetch function ---
            await fetchAndProcessStores(userLat, userLon);

            if (selectedStoreId) { // Validate initial ID after fetch
                const storeExists = allStores.some(store => store.id === selectedStoreId);
                if (storeExists) {
                    console.log(`Store Locator: Initial store code ${selectedStoreId} is valid.`);
                    applyInitialSelection = true;
                } else {
                    console.warn(`Store Locator: Initial store code ${selectedStoreId} not found.`);
                    selectedStoreId = null; initialStoreIdFromUrl = null; updateUrlWithSelection();
                }
            }

            renderStoreList(); // Render list (applies initial highlight class if needed)
            updateMapMarkers(); // Render markers

            if (applyInitialSelection) { // Apply map actions after markers exist
                 console.log(`Store Locator: Applying initial map selection for ${selectedStoreId}`);
                 handleMapSelection();
                 scrollListIfNeeded(); // Scroll after list is rendered
            }

            console.log('Store Locator: Initialization complete.');

        } catch (initError) {
            console.error("Store Locator Error: Failed to initialize.", initError);
            const displayError = (msg) => {
                const targetElement = document.getElementById(rootElementId) || document.body;
                targetElement.innerHTML = `<p style="color: red; background-color: white; border: 1px solid red; padding: 1em; font-family: sans-serif; margin: 1em;">Error: Store locator could not be loaded. ${msg}. Check console for details.</p>`;
            };
             displayError(initError.message || "Unknown error");
        }
    }

    // --- Start the application ---
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeApp);
    } else {
        initializeApp(); // Already loaded
    }

})(); // End of IIFE
