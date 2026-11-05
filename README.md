# Houston Survival Map (offline)

An offline survival map for the whole Houston area, Texas (Phase 1). Download the map once while you
have internet. After that, the map, address search, directions, nearest help,
saved places, pins and the first-aid guide all work with **no internet, no
Wi-Fi, no cell signal and no account**. GPS and compass work offline too.

It is **not** a general city map app: there are no reviews, no ratings, and no
"live" anything. Offline, the app cannot know traffic, closures, whether a road
is flooded right now, or whether a place is open. It says so on screen.

---

## How it is built (short version)

| Part | What it uses | Where |
|---|---|---|
| Screen | A web app (PWA) you can "install" on a phone or laptop | `app/` |
| Map pictures | OpenStreetMap basemap from Protomaps, stored as one `basemap.pmtiles` file | `app/js/main.js` |
| Address search | SQLite full-text index built from OpenStreetMap addresses (runs on the device with sql.js) | `app/js/search.js` |
| Directions | Road network pre-built from OpenStreetMap, searched with the standard A* method in a background thread | `app/js/route-worker.js` |
| Flood warnings | FEMA National Flood Hazard Layer (floodplain maps) plus OpenStreetMap underpasses, bayou crossings and low-water crossings | `pipeline/fetch_fema.py` |
| Scouted places | Verified Houston survival locations from the Scouting Agent, merged in at build time | `pipeline/curated_pois.json` |
| Data builder | Python scripts that turn the raw data into the files above | `pipeline/` |

**Why not OSRM or Valhalla?** They are good routing engines, but they run as a
server program. A phone browser cannot run them, and in a blackout there is no
server to reach. So the road network is pre-built from the same OpenStreetMap
data and the app finds routes right on the device. Speeds are simple
speed-limit-based estimates (like OSRM's basic car profile).

---

## Get the Houston data (needs internet, once)

### Easiest: let GitHub build it for you
GitHub's computers run `.github/workflows/build-data.yml`. It downloads
OpenStreetMap (Texas), the Protomaps basemap and FEMA floodplains, builds the
Houston metro pack, then runs the airplane-mode tests on the real data.

1. On GitHub open the **Actions** tab → **Build Houston map data** → **Run workflow**
   (it also runs by itself when this code changes, and once a month).
2. When it finishes (about 20–40 min), open the run. The **Summary** shows the
   download sizes and the test results.
3. Under **Artifacts**, download **houston-survival-map** (a zip of the app with data).

**For phones (recommended):** after this code is merged into `main`, turn on
GitHub Pages once: repo **Settings → Pages → Source: GitHub Actions**. The
workflow then publishes the app at `https://<your-user>.github.io/fluffy-fortnight/`.
Open that link on your phone while online, tap **More → Map areas & storage →
Download**, then use your browser's **Add to Home Screen**. (GitHub Pages is
free for public repositories.)

**For a laptop:** unzip the artifact and follow `START-HERE.txt`
(`node scripts/serve.mjs 8080 app`, then open http://localhost:8080).

### Advanced: build it on your own computer (Linux / macOS / WSL)
```bash
sudo apt install osmium-tool            # or: brew install osmium-tool
pip install osmium shapely numpy
npm install && npm run vendor
npm run build-data                      # builds the Houston metro pack
npm start                               # open http://localhost:8080
```

### Updating the data
Run the workflow again (or `npm run build-data`), then in the app open
**More → Map areas & storage** while online and tap **Update**. The old copy
keeps working until the new one has fully downloaded. The app never needs an
update to open or to work offline.

---

## Map packs and storage

Packs are listed in `pipeline/areas.json`. **Phase 1 has exactly one pack:**

| Pack | Covers | Basemap detail |
|---|---|---|
| `houston-metro` | All of Houston — downtown, northwest (home: 77088), southwest, southeast, northeast — plus Harris County and nearby suburbs (Katy, Sugar Land, Pearland, Pasadena, Baytown, Kingwood, Spring) | zoom 14 |

No Texas state pack and no US pack are built (Phase 2 / Phase 3). The system is
ready for them: each pack is its own entry in `areas.json` with a `kind`
(`metro` or `state`) and `region`, built and downloaded separately, so new
packs can be added later without changing the app.

In the app: **More → Map areas & storage** shows the pack's size, the space
used on the device, and buttons to **Download**, **Update**, **Use** and **Delete**.

**Download size (real build, 2026-11-05): about 173 MB in total** for the
whole Houston metro pack:

| File | Size | What it is |
|---|---|---|
| `graph.bin` | 79.5 MB | road network for directions (1.2 million junctions, 1.6 million road pieces) |
| `basemap.pmtiles` | 44.1 MB | map pictures |
| `search.sqlite` | 38.1 MB | search index: 136,873 addresses, 24,873 places, street names, 221 ZIP codes |
| `flood.geojson` | 10.1 MB | FEMA floodplains (18,304 shapes) |
| `pois.json` | 0.9 MB | 7,000+ survival places (123 hospitals, 635 clinics, 497 pharmacies, 357 fire stations, 132 police, 2,257 groceries, 2,362 gas stations, 249 water points, 227 community centers, 8 food banks, 4 shelters) |

The workflow prints these numbers again on every run (Actions → run → Summary).

### Scouted survival places
`pipeline/curated_pois.json` holds the Houston locations from the Scouting
Agent (hospitals, urgent care, pharmacies, police/fire, shelters, food banks,
H-E-B and other groceries, gas). Rules the builder follows:
- Places with coordinates are used as given.
- Places without coordinates are placed **only** by an exact address (or exact
  name) match in the OpenStreetMap data. If there is no match, the place is
  left out and listed under `scouted.notFound` in the pack's `meta.json` —
  it is never guessed.
- Opening hours are **not** stored or shown (the app must never suggest a
  place is open or closed).
- Left out on purpose: PVE Pharmacy and Unique Drugs (listed temporarily
  closed), Foodarama and Aldi (scout said verify first).
- Duplicates of the same place from OpenStreetMap are removed.
- Real build result: 51 of 56 scouted places added (5 of them placed by
  matching their address in OpenStreetMap). **Not found, so left out:**
  Baylor St. Luke's Medical Center (1101 Bates Ave), St. Joseph Medical Center
  (1401 St Joseph Pkwy), The Harris Center NeuroPsychiatric Center
  (1502 Taub Loop), Salvation Army Center of Hope (1500 Austin St) and
  Anderson Food Pantry (1508 Gregg St). Adding verified coordinates for these
  to `curated_pois.json` will include them on the next build.
- Known gap (from the scout): no large overnight shelter inside 77088; the
  nearest day shelter is 1960 Hope Center (77090), the big overnight
  shelters are downtown. No standalone public water source was verified in
  77088, so "Water" falls back to the nearest grocery, clearly labeled.

---

## Test it in airplane mode

**Automatic** (what the workflow runs; needs Node and Playwright):
```bash
node tests/offline.test.mjs tests/cases.houston-metro.json app/data
```
It downloads the pack while online, then turns the network **off** in the
browser and runs the 13 Phase 1 checks:
1. opens offline; 2. address search with house numbers — City Hall
(901 Bagby St) plus real addresses picked at random from the index in 77088
(NW), 77002 (downtown), 77036 (SW), 77087 (SE) and 77016 (NE);
3. place-name search + route; 4. GPS → address, driving; 5. walking (and
biking); 6. nearest hospital; 7. place toggles on/off for all 7 kinds;
8. saved Home after closing the app; 9. a route stop (waypoint) and a
breadcrumb trail that records movement and routes back; 10. GPS & compass
dashboard (coordinates, compass, distance, battery %, ETA); 11. battery saver;
12. no reviews or "live" claims (and no opening hours in the data);
13. only the Houston metro pack exists. Extra checks: closest-match warning,
scouted places searchable, "No route" when walking can't get there, flood
warning, and **zero** internet requests.

`tests/make_fixture.py` + `tests/cases.testville.json` do the same on a tiny
made-up town so the tools can be tested without downloading Houston.

**By hand on a phone:**
1. Open the app online and download the Houston metro pack (More → Map areas).
2. Turn on airplane mode (Wi-Fi and data off). GPS still works.
3. Close the app fully, open it again from the home screen.
4. Search `901 Bagby St` (City Hall) and an address on your street in 77088.
5. Tap **Directions**, try **Drive**, **Walk** and **Bike**. Tap **+ Add stop**.
6. Tap **Hospital**, then **Directions**.
7. Save **Home**, close the app, reopen, **Saved → Go**.
8. Route across a bayou (for example 77088 → downtown) and look for the
   yellow flood-warning dots.
9. Tap the place toggles under the search bar (Hospital, Shelter, Water, Food, Gas, Pharmacy, Police / Fire).
10. **More → Breadcrumb trail → Start**, walk a block, **Stop**, then **Back**.
11. Tap 🧭 for the GPS & compass dashboard.
12. **More → Battery saver**, then search and route again.

---

## What works

- Map of Houston offline (dark mode for low light and battery saver).
- Search bar with suggestions as you type: house number + street, place names,
  street names, neighborhoods and ZIP codes. Street shortcuts like `W`, `Rd`,
  `Dr`, `Blvd` are understood. If a house number is not found, it shows the
  **closest numbers on that street with a warning** — it never jumps silently.
- Tap a result (or anywhere on the map) → pin + card with a big **Directions** button.
- Directions from your GPS location, a typed address, a saved place, a pin or
  the map center. Drive / Walk / Bike, each with its own "about N min" ETA,
  miles, arrival time and a turn-by-turn list. Clear "No route" message when a
  mode cannot get there (for example walking onto a freeway).
- Place toggles on the map: Hospital, Shelter, Water, Food, Gas, Pharmacy,
  Police / Fire — tap to show or hide each kind.
- Stops / waypoints on a route (**+ Add stop**), and a breadcrumb trail that
  records where you walk or drive and routes you back to its start. Mark your
  vehicle or a waypoint with one tap.
- GPS & compass dashboard (🧭 button): coordinates, accuracy, speed, compass
  direction, distance to destination, ETA left on the route, battery %, and
  distance + direction to the nearest hospital, shelter and water.
- Nearest essentials: hospital, clinic/urgent care, pharmacy, police, fire,
  shelter, drinking water, grocery, gas — one tap, distance and direction, then route.
- Saved places (Home, Family, Shelter, Meeting point) — tap **Go** to route right away.
- Flood awareness: FEMA floodplain layer on the map; routes that pass
  floodplains, underpasses, bayou crossings or low-water crossings are
  flagged, and a safer route is chosen when one exists that is not much longer.
- Own pins with notes: safe route, hazard, blocked road (routes avoid these), water source.
- Help nearby: distance and compass direction to the nearest hospital, shelter and water.
- Battery saver: dark map, GPS every 2 minutes, compass off, lighter drawing.
- First-aid & survival guide (first aid, flood, heat, power outage) and a
  tick-off storm/blackout checklist — fixed text from Red Cross, AHA, CDC,
  NWS, FEMA/Ready.gov and FoodSafety.gov, with a "not a replacement for
  professional medical help" note.
- Everything you add stays on the device (browser storage). No account.

## What is missing or limited

**Not built yet (by plan):**
- **Phase 2:** Texas state pack; Texas-wide place scouting; CPR metronome and
  patient log. (The flood layer and the text first-aid guide were already
  built in the first round for Houston and are kept.)
- **Phase 3:** SOS button (flashlight Morse, siren, SMS with location),
  extra offline guides / on-device AI, US state packs.

**Limits:**
- Breadcrumb trails only record while the app is open on screen (phones pause
  web apps in the background). The app keeps the screen awake while recording
  when the phone allows it. In battery saver, points are added every 2 minutes.
- Battery % works on Android/Chrome and desktop Chrome; iPhone Safari does not
  share it, and the dashboard says so.
- Compass needs a phone with a compass sensor (iPhone asks for permission).

- **Street photos (Mapillary)** — not built (optional, low priority).
- **Address coverage depends on OpenStreetMap.** If an address is not in OSM it
  cannot be found; the closest numbers on the street are shown instead. The
  workflow summary prints how many addresses each area has. Adding Harris County
  address points (for example from OpenAddresses) would improve this.
- **Shelters:** official emergency shelters open per event and are rarely in
  OSM. The Shelter button also lists community centers, clearly labeled as
  "often used as shelters — not confirmed open".
- **Flood warnings** come from floodplain maps and road shape, not live data.
  Underpasses are found from OSM tags and roads passing under rail bridges;
  some real underpasses will be missed.
- **ETA** uses speed limits (or road-type defaults) only; no traffic lights
  model beyond a simple slowdown, no live traffic.
- **Turn-by-turn** is a list, not spoken, and does not re-route automatically
  as you move.
- **Laptops** usually have no GPS chip, so "My location" may not work offline
  on a laptop. Phones are fine.
- Routes only work inside one downloaded area at a time.
- iPhone: Safari may clear website data for apps not added to the Home
  Screen. Add it to the Home Screen so the downloaded map is kept.

## Data sources and licenses

- Map data © OpenStreetMap contributors (ODbL).
- Basemap tiles: Protomaps (built from OpenStreetMap); fonts and icons from
  `protomaps/basemaps-assets` (Noto fonts under the SIL Open Font License).
- Floodplains: FEMA National Flood Hazard Layer (public domain).
- Libraries: MapLibre GL JS, PMTiles, sql.js, @protomaps/basemaps.
