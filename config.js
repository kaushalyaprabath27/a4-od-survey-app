// Settings for this deployment. Edit here, not in app.js.
window.A4_CONFIG = {
    // Google Apps Script Web App URL (Deploy > Manage deployments, ends in /exec).
    // Until this is set, interviews are kept safely on the device and are NOT sent.
    appsScriptUrl: 'https://script.google.com/macros/s/AKfycby-59ey8nmTd0EuS5ASO_VhR3tZuOAP5AeMsvjKf6TBpP-6GBd5gO5XTnk1oP8WcgmG/exec',

    projectName: 'A4 Godagama – Avissawella widening (feasibility study)',

    // Survey stations offered at the start of a shift (any other name can be typed).
    // From OD_Survey_Locations_Map.kmz.
    surveyLocations: ['OD 1', 'OD 2', 'OD 3', 'OD 4', 'OD 5', 'OD 6', 'OD 7'],

    // Direction of travel surveyed, offered at the start of a shift and when switching.
    directions: ['Towards Colombo', 'Towards Rathnapura'],

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
    surveyAreaCenter: { lat: 6.88, lon: 80.10 },

    // Daily target for ONE enumerator, per line of the sampling plan. Shown to the enumerator
    // in the app (the count button at the top) and on the dashboard. Each line lists the app's
    // vehicle types (and older names) counted in it.
    enumeratorLines: [
        ['Motor Cycles', ['Motorcycle']],
        ['Three Wheeler', ['3-wheeler']],
        ['Car/Jeep/SUV/Double Cab', ['Taxi', 'Car / Jeep']],
        ['Van', ['Passenger van', 'Office van', 'School van']],
        ['Medium Bus', ['Minibus']],
        ['Large bus', ['Large bus']],
        ['Light Truck (2 axles / 4 wheels)', ['Light truck (2 axles / 4 wheels)', 'Delivery van', 'Small lorry']],
        ['Medium Truck (2 axles / 6 wheels)', ['Medium truck (2 axles / 6 wheels)', 'Medium truck (2 axle)', 'Truck (2 axle)']],
        ['Large Truck (2 axles / 6 wheels)', ['Large truck (2 axles / 6 wheels)', 'Heavy truck (2 axle)']],
        ['Heavy Vehicle (3 axles / 10 wheels)', ['Heavy vehicle (3 axles / 10 wheels)']],
        ['Container with trailer (20 ft + 40 ft)', ['Container with trailer', 'Container (20 ft / 3 axle)', 'Multi-axle container (40 ft)']],
        ['Other freight', ['Other']]
    ],
    enumeratorTargets: {
        'OD 5': { enumerators: 18, byLine: {
            'Motor Cycles': 50, 'Three Wheeler': 23, 'Car/Jeep/SUV/Double Cab': 25, 'Van': 7, 'Medium Bus': 2,
            'Light Truck (2 axles / 4 wheels)': 8, 'Medium Truck (2 axles / 6 wheels)': 7, 'Large Truck (2 axles / 6 wheels)': 9,
            'Heavy Vehicle (3 axles / 10 wheels)': 2, 'Container with trailer (20 ft + 40 ft)': 2 } }
    }
};
