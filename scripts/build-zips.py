#!/usr/bin/env python3
"""Build data/zips.txt from GeoNames (https://www.geonames.org/, CC BY 4.0).

Usage: python3 scripts/build-zips.py

Downloads the US postal code export and cities500 (for IANA time zones),
assigns each ZIP the time zone of a matching or nearby place, and writes a
compact delta-encoded text file. See js/location.js for the decoder.

Output format (UTF-8, one ZIP per line, sorted by ZIP):
    # comment lines
    #tz Zone/A|Zone/B|...
    dzip<TAB>dlat<TAB>dlon<TAB>place<TAB>state<TAB>tzIndex
dzip/dlat/dlon are differences from the previous row (lat/lon as integers x100);
place, state and tzIndex are empty when unchanged, and trailing empty fields
are dropped.
"""

import csv
import io
import math
import os
import sys
import tempfile
import urllib.request
import zipfile
from collections import defaultdict

POSTAL_URL = 'https://download.geonames.org/export/zip/US.zip'
CITIES_URL = 'https://download.geonames.org/export/dump/cities500.zip'
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'zips.txt')

CHECK = {
    '80005': 'America/Denver',
    '85001': 'America/Phoenix',
    '79901': 'America/Denver',
    '32501': 'America/Chicago',
    '46401': 'America/Chicago',
    '46201': 'America/Indiana/Indianapolis',
    '83814': 'America/Los_Angeles',
    '96813': 'Pacific/Honolulu',
    '99723': 'America/Anchorage',
    '10001': 'America/New_York',
}


def download_rows(url, member, tmp):
    path = os.path.join(tmp, os.path.basename(url))
    print(f'downloading {url}', file=sys.stderr)
    urllib.request.urlretrieve(url, path)
    with zipfile.ZipFile(path) as zf, zf.open(member) as f:
        text = io.TextIOWrapper(f, encoding='utf-8')
        return list(csv.reader(text, delimiter='\t', quoting=csv.QUOTE_NONE))


# Countries whose places can lend a time zone to a US ZIP: the US, its
# territories and the freely associated states that use US ZIP codes.
COUNTRIES = {'US', 'PR', 'VI', 'GU', 'MP', 'AS', 'MH', 'FM', 'PW'}


def load_places(rows):
    """Places from cities500: (name, state, lat, lon, tz)."""
    places = []
    for r in rows:
        # 1 name, 4 lat, 5 lon, 8 country, 10 admin1 (state), 17 timezone
        if r[8] in COUNTRIES and r[17]:
            state = r[10] if r[8] == 'US' else r[8]
            places.append((r[1], state, float(r[4]), float(r[5]), r[17]))
    return places


def make_tz_lookup(places):
    """Time zone for a ZIP: a same-named place in the state, else the nearest
    place in the same state (time zone lines mostly follow state lines), else
    the nearest place anywhere."""
    by_name = {}
    grids = defaultdict(lambda: defaultdict(list))  # state (None = all) -> 1° cell -> places
    for name, state, lat, lon, tz in places:
        by_name.setdefault((name.lower(), state), tz)
        cell = (math.floor(lat), math.floor(lon))
        grids[state][cell].append((lat, lon, tz))
        grids[None][cell].append((lat, lon, tz))

    def nearest(lat, lon, grid):
        best, best_d = None, float('inf')
        for radius in range(0, 6):
            cy, cx = math.floor(lat), math.floor(lon)
            for gy in range(cy - radius, cy + radius + 1):
                for gx in range(cx - radius, cx + radius + 1):
                    if max(abs(gy - cy), abs(gx - cx)) != radius:
                        continue
                    for plat, plon, tz in grid.get((gy, gx), ()):
                        dx = (plon - lon) * math.cos(math.radians(lat))
                        d = dx * dx + (plat - lat) ** 2
                        if d < best_d:
                            best, best_d = tz, d
            # Anything in a further ring is at least `radius` degrees away.
            if best is not None and math.sqrt(best_d) <= radius:
                return best
        return best

    def nearest_anywhere(lat, lon):
        found = nearest(lat, lon, grids[None])
        if found:
            return found
        # Remote ZIP: fall back to scanning every place.
        return min(places, key=lambda p: ((p[3] - lon) * math.cos(math.radians(lat))) ** 2
                   + (p[2] - lat) ** 2)[4]

    def lookup(name, state, lat, lon):
        return (by_name.get((name.lower(), state))
                or (state in grids and nearest(lat, lon, grids[state]))
                or nearest_anywhere(lat, lon))

    return lookup


def main():
    with tempfile.TemporaryDirectory() as tmp:
        postal = download_rows(POSTAL_URL, 'US.txt', tmp)
        places = load_places(download_rows(CITIES_URL, 'cities500.txt', tmp))
    tz_of = make_tz_lookup(places)

    # 1 zip, 2 place, 4 state code, 9 lat, 10 lon
    zips = {}
    for r in postal:
        # Military APO/FPO/DPO ZIPs carry mail-hub coordinates, not real locations.
        if r[2].startswith(('APO ', 'FPO ', 'DPO ')):
            continue
        zips.setdefault(r[1], (r[2], r[4], float(r[9]), float(r[10])))

    zones = []
    zone_index = {}
    lines = []
    prev = {'zip': 0, 'lat': 0, 'lon': 0, 'place': None, 'state': None, 'tz': None}
    assigned = {}
    for z in sorted(zips):
        place, state, lat, lon = zips[z]
        tz = tz_of(place, state, lat, lon)
        assigned[z] = tz
        if tz not in zone_index:
            zone_index[tz] = len(zones)
            zones.append(tz)
        la, lo = round(lat * 100), round(lon * 100)
        fields = [
            str(int(z) - prev['zip']),
            str(la - prev['lat']),
            str(lo - prev['lon']),
            '' if place == prev['place'] else place,
            '' if state == prev['state'] else state,
            '' if tz == prev['tz'] else str(zone_index[tz]),
        ]
        while fields[-1] == '':
            fields.pop()
        lines.append('\t'.join(fields))
        prev = {'zip': int(z), 'lat': la, 'lon': lo, 'place': place, 'state': state, 'tz': tz}

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write('# US ZIP code data (c) GeoNames, https://www.geonames.org/, '
                'CC BY 4.0. Generated by scripts/build-zips.py\n')
        f.write('#tz ' + '|'.join(zones) + '\n')
        f.write('\n'.join(lines) + '\n')

    print(f'{len(lines)} ZIPs, {len(zones)} time zones, '
          f'{os.path.getsize(OUT) / 1024:.0f} KB -> {os.path.normpath(OUT)}')
    bad = 0
    for z, want in CHECK.items():
        got = assigned.get(z)
        ok = got == want
        bad += not ok
        print(f'  {"ok " if ok else "BAD"} {z} {zips.get(z, ("?",))[0]}: {got}'
              + ('' if ok else f' (expected {want})'))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
