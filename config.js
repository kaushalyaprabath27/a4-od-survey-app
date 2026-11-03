// Settings for this deployment. Edit here, not in app.js.
window.A4_CONFIG = {
    // Google Apps Script Web App URL (Deploy > Manage deployments, ends in /exec).
    // Until this is set, interviews are kept safely on the device and are NOT sent.
    appsScriptUrl: 'https://script.google.com/macros/s/AKfycby-59ey8nmTd0EuS5ASO_VhR3tZuOAP5AeMsvjKf6TBpP-6GBd5gO5XTnk1oP8WcgmG/exec',

    projectName: 'A4 Godagama – Avissawella widening (feasibility study)',

    // Survey stations offered at the start of a shift (any other name can be typed).
    // From OD_Survey_Locations_Map.kmz.
    surveyLocations: [
        'OD 1 – A8 near Ingiriya junction (Ratnapura side)',
        'OD 2 – AB10 near Hanwella junction (west)',
        'OD 3 – A4 west of Meepe junction',
        'OD 4 – A4 between Kosgama and Puwakpitiya',
        'OD 5 – B240 between Padukka and Godagama',
        'OD 6 – A4 near Godagama junction (east)',
        'OD 7 – A7 near Talduwa junction (east)'
    ],

    // Direction of travel surveyed, offered at the start of a shift and when switching.
    directions: [
        'Towards Colombo / Godagama',
        'Towards Avissawella'
    ],

    // Optional. Leave empty to use free OpenStreetMap place suggestions.
    googlePlacesApiKey: '',

    // Place suggestions are limited to this box: [west, south, east, north] (Sri Lanka).
    placeSearchBbox: [79.4, 5.8, 82.0, 10.0],
    placeSearchCountry: 'lk',

    // Towns offered first as you type an origin or destination (tap an empty box to see all).
    presetLocations: [
        'Colombo', 'Maharagama', 'Homagama', 'Godagama', 'Meegoda', 'Kaduwela', 'Padukka', 'Hanwella',
        'Kosgama', 'Avissawella', 'Ingiriya', 'Horana', 'Kahathuduwa', 'Ruwanwella', 'Eheliyagoda',
        'Ratnapura', 'Kegalle', 'Yatiyantota', 'Karawanella', 'Deraniyagala', 'Kitulgala', 'Hatton'
    ],
    presetSub: 'A4 corridor / nearby town',

    // Place suggestions near this point rank first until the phone has a GPS fix (A4 corridor).
    surveyAreaCenter: { lat: 6.88, lon: 80.10 }
};
