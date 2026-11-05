# Houston Survival Map (offline)

An offline survival map for Houston, Texas. Download the map once while you
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
OpenStreetMap (Texas), the Protomaps basemap and FEMA floodplains, builds both
map areas, then runs the airplane-mode tests on the real data.

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
npm run build-data                      # all areas; or: bash pipeline/build_all.sh nw-houston
npm start                               # open http://localhost:8080
```

### Updating the data
Run the workflow again (or `npm run build-data`), then in the app open
**More → Map areas & storage** while online and tap **Update**. The old copy
keeps working until the new one has fully downloaded. The app never needs an
update to open or to work offline.

---

## Map areas and storage

Areas are set in `pipeline/areas.json`:

| Area | Covers | Basemap detail |
|---|---|---|
| `nw-houston` (home) | NW Houston / 77088 down to Downtown and the Medical Center | zoom 15 |
| `houston-metro` | Harris County and around | zoom 14 |

In the app: **More → Map areas & storage** shows each area's size, the space
used on the device, and buttons to **Download**, **Update**, **Use** and
**Delete**. You only need one area; the metro one includes the home area.

**Download size:** see the latest workflow run's **Summary** (it prints exact
sizes for every file). This container could not reach the map data sites, so
the real sizes were measured on GitHub — see the run linked in the pull
request / commit notes. Each area is: `basemap.pmtiles` (map pictures, the
biggest part), `search.sqlite` (addresses), `graph.bin` (roads),
`pois.json` (essentials) and `flood.geojson` (floodplains).

---

## Test it in airplane mode

**Automatic** (what the workflow runs; needs Node and Playwright):
```bash
node tests/offline.test.mjs tests/cases.nw-houston.json app/data
```
It downloads the area while online, then turns the network **off** in the
browser and checks the 10 required things: opens offline, address search with
house numbers (including real addresses picked at random from 77088 and
downtown 77002), place-name search, driving and walking routes with ETA,
nearest hospital, saved Home after closing the app, flood warning, battery
saver, and that no reviews or "live" claims appear. It also checks that the
app makes **zero** internet requests.

`tests/make_fixture.py` + `tests/cases.testville.json` do the same on a tiny
made-up town so the tools can be tested without downloading Houston.

**By hand on a phone:**
1. Open the app online and download the home area (More → Map areas).
2. Turn on airplane mode (Wi-Fi and data off). GPS still works.
3. Close the app fully, open it again from the home screen.
4. Search `901 Bagby St` (City Hall) and an address on your street in 77088.
5. Tap **Directions**, try **Drive**, **Walk** and **Bike**.
6. Tap **Hospital**, then **Directions**.
7. Save **Home**, close the app, reopen, **Saved → Go**.
8. Route across a bayou (for example 77088 → downtown) and look for the
   yellow flood-warning dots.
9. **More → Battery saver**, then search and route again.

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
