# A4 Roadside O-D Survey

Offline-first web app (PWA) for the roadside origin–destination survey of the
**Feasibility Study for Widening of the Godagama – Avissawella Road (A4) into 4 lanes**.
It follows the project's paper forms (passenger and freight vehicles) and adds the
Google Form's DS Division list and parking questions. One form per vehicle stopped.

## What the recorder does

1. **Shift setup** (once per shift): recorder name, survey location (station) and the
   direction of travel surveyed. The direction can be switched during the shift by
   tapping it in the top bar.
2. **One form per vehicle.** Date, time, Form No. (e.g. `KW-20261102-003`) and the
   phone's GPS position are saved automatically.
3. Tap **Save interview**. It is stored on the phone first and sent to the Google Sheet
   in batches whenever there is internet (every 15 s and on reconnect). **Undo** deletes
   the last interview if it has not been sent yet; **Export** downloads a JSON backup.

## Questions

| # | Passenger vehicles | Freight vehicles |
|---|---|---|
| 1 | Vehicle category | Vehicle category |
| 2 | Vehicle type: Motorcycle, 3-wheeler / Taxi, Car / Jeep, Passenger van, Office van, School van | Vehicle type: Delivery van, Small lorry, Truck (2 axle), Container, Multi-axle, Other |
| 3 | Occupancy (1–5, 6+) | Occupancy |
| 4 / 4a | Origin village / town + DS Division (district saved with it) | same |
| | Type of origin, parking at origin | – |
| | Destination village / town + DS Division | same |
| | Type of destination, parking at destination | – |
| | Vehicle ownership: Government, Semi-government, Private, Hired | Commodity (20 types), Load: Empty, 1/4, 1/2, 3/4, Full, Overloaded |
| last | Willingness to use the Kahathuduwa – Ingiriya Expressway: Yes / No / Not sure | same |

Question numbers follow the questions shown, so each form is numbered 1, 2, 3 …

## Setting up

1. **Backend:** follow the steps at the top of `backend/a4_od_apps_script.js`
   (new Google Sheet → Extensions → Apps Script → paste → run `setup` → deploy as a Web
   app, *Execute as: Me*, *Who has access: Anyone*). Copy the `/exec` URL.
2. Put that URL in `config.js` → `appsScriptUrl`. Until then the app keeps everything on
   the phone and shows "Not linked to sheet".
3. Edit `config.js` for the station names, directions and the towns offered first.
4. Every time app files change, bump `CACHE_NAME` in `sw.js` so phones pick up the update.

## In the Google Sheet

- `a4-roadside-od`: one row per vehicle (Form No, recorder, station, direction, GPS,
  vehicle, origin / destination with DSD and district, trip details, expressway).
- Menu **A4 O-D Survey → Build / refresh summary** writes:
  - `Summary`: every answer counted, overall and per survey date;
  - `OD Matrix (District)`: origin district × destination district for all vehicles,
    passenger vehicles and freight vehicles.

## Files

`index.html`, `style.css`, `app.js` (questionnaire in the `FORM` list), `config.js`,
`dsd.js` (331 DS Divisions with their districts), `sw.js`, `manifest.json`, `icons/`,
`backend/a4_od_apps_script.js`.
