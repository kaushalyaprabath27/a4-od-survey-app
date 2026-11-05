# A4 Roadside O-D Survey

Offline-first web app (PWA) for the roadside origin–destination survey of the
**Feasibility Study for Widening of the Godagama – Avissawella Road (A4) into 4 lanes**.
It follows the project's paper forms (passenger and freight vehicles), with origin and
destination districts and the Value of Time (VOT) data for the economic analysis.
One form per vehicle stopped.

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
| 2 | Vehicle type: Motorcycle, 3-wheeler, Taxi, Car / Jeep, Passenger van, Office van, School van, Minibus, Large bus | Vehicle type: Delivery van, Small lorry, Medium truck (2 axle), Heavy truck (2 axle), Container (20 ft / 3 axle), Multi-axle container (40 ft), Other (type it) |
| 3 | Occupancy 1–5, or 6+ then the exact number | same |
| 4 / 4a | Origin village / town + district | same |
| 5 | Type of origin: Home, Work, School / Education, Business, Health, Shopping / Social, Tourism / Leisure, Other | – |
| | Destination village / town + district, type of destination | destination + district |
| | Trip frequency: Daily, Several days a week, About once a week, Once in 2 weeks, Monthly, Less frequently, First time, Other (type) | same |
| | Trip purpose | Commodity: Empty, Vegetables / Fruits, Essential food items, Building materials, Industrial products, Other — with the goods typed in (e.g. potatoes); load: Empty, 1/4, 1/2, 3/4, Full, Overloaded |
| | In future, would you use the Kahathuduwa – Ingiriya Expressway on this route? Yes / No / Not sure | same |
| last | **Value of time:** is the respondent the vehicle owner? If yes, monthly household income (8 bands from < Rs. 30,000 to > Rs. 500,000, or prefer not to say) | **Value of time:** approximate value of the goods carried (Rs.) and approximate load with its unit (tonnes, kg, bags, units, litres, cubes, other), each with Not known; not asked for empty vehicles |
| last | **Vehicle number** in two parts: letters (ABC), SRI or the old number (200, 19 SRI), then the number (1234); or Not noted | same |

Question numbers follow the questions shown, so each form is numbered 1, 2, 3 …
An "Other" answer counts only once its text is typed.

## Admin dashboard

`admin.html` (also linked from the app's first screen; the same page is in the bus app)
shows both surveys live: logs in with the admin password, then by station and date:

- **Vehicle O-D:** progress against the sampling targets per vehicle class (total to be
  surveyed, surveyed, remaining, %), passenger / freight totals with the number needed
  per hour, interviews per hour, recorders, and the answers (direction, districts, trip
  purpose, frequency, expressway use, commodity, load, income).
- **Bus survey:** buses per hour and per route, To / From Colombo, operator, size and
  passenger bands.
- Targets live in the sheet's **Targets** tab (one row per station: survey hours and a
  target per class; OD 2 is filled in from the sampling plan). Edit them there or with
  **Edit targets** on the dashboard (pick one station first).
- App vehicle types are counted in the plan's classes as listed in `VEHICLE_CLASSES`
  in the backend (e.g. Taxi + Car / Jeep → Car/Jeep/SUV/Double Cab).
- **Password:** not stored in the code. In each Apps Script project: Project Settings
  (gear) → Script properties → Add script property → `ADMIN_PASSWORD`. After 10 wrong
  tries the login is locked for 10 minutes.

## Setting up

1. **Backend:** follow the steps at the top of `backend/a4_od_apps_script.js`
   (new Google Sheet → Extensions → Apps Script → paste → run `setup` → deploy as a Web
   app, *Execute as: Me*, *Who has access: Anyone*). Copy the `/exec` URL.
2. Put that URL in `config.js` → `appsScriptUrl`. Until then the app keeps everything on
   the phone and shows "Not linked to sheet".
3. Edit `config.js` for the station names, directions and the towns offered first.
4. Every time app files change, bump `CACHE_NAME` in `sw.js` so phones pick up the update.

## In the Google Sheet

- `Targets`: sampling targets per station and vehicle class (for the dashboard).
- `a4-roadside-od`: one row per vehicle (Form No, recorder, station, direction, GPS,
  vehicle, origin / destination with district, trip details, expressway, VOT data).
- Menu **A4 O-D Survey → Build / refresh summary** writes:
  - `Summary`: every answer counted, overall and per survey date;
  - `OD Matrix (District)`: origin district × destination district for all vehicles,
    passenger vehicles and freight vehicles.

## Files

`index.html`, `style.css`, `app.js`, `admin.html` / `admin.js` / `admin.css` (questionnaire in the `FORM` list), `config.js`,
`sw.js`, `manifest.json`, `icons/`,
`backend/a4_od_apps_script.js`.
