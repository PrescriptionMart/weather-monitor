// Builds the static data files the Winter Pack page reads:
//
//   data/winter-checkpoints.json  where the page checks the weather: one row per
//                                 checkpoint [state, zip3, lat, lon, elev ft, gridpoint, x, y]
//   data/us-states.json           state outlines, already projected for the map, with
//                                 where each state's abbreviation goes:
//                                 [code, path, [labelX, labelY], [lineFromX, lineFromY] | null]
//   data/zip-centroids.txt        every US ZIP's centre (public Census data), for
//                                 the "check a ZIP" box
//
// The page then needs no map library and no /points lookups: each checkpoint
// carries its NWS gridpoint and its map position.
//
// Inputs (none of them are committed):
//   --points <file>   JSON [{state, zip3, lat, lon, elev, g}] — the checkpoint list.
//                     It is built from shipment history outside the repo; only
//                     the coordinates and 3-digit ZIP areas reach this file, never
//                     a patient ZIP, name or count.
//   --zcta <file>     Census ZCTA gazetteer (2024_Gaz_zcta_national.txt)
//   --zcta-county <file>  Census ZCTA-to-county relationships
//                     (rel2020/zcta520/tab20_zcta520_county20_natl.txt): gives
//                     each 3-digit ZIP area its state, so a checkpoint is always
//                     filed under the state a packer sees on the label
//   --modules <dir>   a node_modules folder with d3-geo@3.1.1,
//                     topojson-client@3.1.0 and us-atlas@3.0.1
//
//   node scripts/build-winter-data.mjs --points pts.json --zcta gaz.txt --zcta-county rel.txt --modules /tmp/x/node_modules
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? a.concat([[v.slice(2), all[i + 1]]]) : a), []));
for (const k of ['points', 'zcta', 'zcta-county', 'modules']) if (!args[k]) { console.error(`missing --${k}`); process.exit(1); }
const require = createRequire(path.join(path.resolve(args.modules), 'x.js'));
const d3 = require('d3-geo');
const topojson = require('topojson-client');
const atlas = require('us-atlas/states-albers-10m.json');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const STATES = {
  '01': ['AL', 'Alabama'], '02': ['AK', 'Alaska'], '04': ['AZ', 'Arizona'], '05': ['AR', 'Arkansas'], '06': ['CA', 'California'],
  '08': ['CO', 'Colorado'], '09': ['CT', 'Connecticut'], '10': ['DE', 'Delaware'], '11': ['DC', 'District of Columbia'],
  '12': ['FL', 'Florida'], '13': ['GA', 'Georgia'], '15': ['HI', 'Hawaii'], '16': ['ID', 'Idaho'], '17': ['IL', 'Illinois'],
  '18': ['IN', 'Indiana'], '19': ['IA', 'Iowa'], '20': ['KS', 'Kansas'], '21': ['KY', 'Kentucky'], '22': ['LA', 'Louisiana'],
  '23': ['ME', 'Maine'], '24': ['MD', 'Maryland'], '25': ['MA', 'Massachusetts'], '26': ['MI', 'Michigan'], '27': ['MN', 'Minnesota'],
  '28': ['MS', 'Mississippi'], '29': ['MO', 'Missouri'], '30': ['MT', 'Montana'], '31': ['NE', 'Nebraska'], '32': ['NV', 'Nevada'],
  '33': ['NH', 'New Hampshire'], '34': ['NJ', 'New Jersey'], '35': ['NM', 'New Mexico'], '36': ['NY', 'New York'],
  '37': ['NC', 'North Carolina'], '38': ['ND', 'North Dakota'], '39': ['OH', 'Ohio'], '40': ['OK', 'Oklahoma'], '41': ['OR', 'Oregon'],
  '42': ['PA', 'Pennsylvania'], '44': ['RI', 'Rhode Island'], '45': ['SC', 'South Carolina'], '46': ['SD', 'South Dakota'],
  '47': ['TN', 'Tennessee'], '48': ['TX', 'Texas'], '49': ['UT', 'Utah'], '50': ['VT', 'Vermont'], '51': ['VA', 'Virginia'],
  '53': ['WA', 'Washington'], '54': ['WV', 'West Virginia'], '55': ['WI', 'Wisconsin'], '56': ['WY', 'Wyoming'],
};
const CODES = new Set(Object.values(STATES).map(s => s[0]));

// ---- state outlines ------------------------------------------------------------------
// us-atlas's albers file is already projected to a 975x610 frame (Alaska and
// Hawaii as insets); geoPath with no projection just writes the SVG path.
const round = (s) => s.replace(/-?\d+\.\d+/g, (n) => (+n).toFixed(1).replace(/\.0$/, ''));
const shapes = topojson.feature(atlas, atlas.objects.states).features
  .filter(f => STATES[String(f.id).padStart(2, '0')])
  .map(f => {
    const [code, name] = STATES[String(f.id).padStart(2, '0')];
    const c = d3.geoPath().centroid(f).map(v => +v.toFixed(1));
    return { code, name, d: round(d3.geoPath()(f)), centroid: c };
  })
  .sort((a, b) => a.name.localeCompare(b.name));
if (shapes.length !== 51) throw new Error('expected 51 state shapes, got ' + shapes.length);

// Labels sit on each state's centroid, except where the centroid falls in a
// lake or crowds a neighbour (LABEL_AT), and for states too small to hold
// their abbreviation, which get it out in the Atlantic with a short line
// back to the state (CALLOUT). The line starts at the centroid, or at
// LINE_FROM where a line from the centroid would cross another state
// (MD's over Delaware, RI's over Massachusetts) or start on top of DC's.
// Coordinates are in the 975x610 map frame.
const LABEL_AT = { MI: [694, 198], FL: [790, 532], LA: [566, 470], HI: [300, 586], ID: [196, 160], VT: [872, 128], NH: [894, 146], KY: [700, 318] };
const CALLOUT = { MA: [932, 170], RI: [932, 188], CT: [932, 206], NJ: [904, 236], DE: [904, 256], MD: [904, 274], DC: [904, 292] };
const LINE_FROM = { MD: [848, 276], RI: [904, 192] };
for (const s of shapes) {
  if (CALLOUT[s.code]) { s.label = CALLOUT[s.code]; s.from = LINE_FROM[s.code] || s.centroid; }
  else { s.label = LABEL_AT[s.code] || s.centroid; s.from = null; }
}

// ---- each 3-digit ZIP area's state ----------------------------------------------------------
// A ZIP's state is the one holding most of its land; a ZIP area's state is the
// one most of its ZIPs are in (15 areas have one border ZIP across a line).
const FIPS_CODE = Object.fromEntries(Object.entries(STATES).map(([f, [c]]) => [f, c]));
const zipLand = {};
fs.readFileSync(args['zcta-county'], 'utf8').replace(/^\uFEFF/, '').split('\n').slice(1).forEach(line => {
  const p = line.split('|');
  const st = FIPS_CODE[(p[9] || '').slice(0, 2)];
  if (!p[1] || !st) return;
  (zipLand[p[1]] ||= {})[st] = ((zipLand[p[1]] || {})[st] || 0) + (+p[16] || 0);
});
const areaVotes = {};
for (const [zip, land] of Object.entries(zipLand)) {
  const st = Object.entries(land).sort((a, b) => b[1] - a[1])[0][0];
  ((areaVotes[zip.slice(0, 3)] ||= {})[st] = ((areaVotes[zip.slice(0, 3)] || {})[st] || 0) + 1);
}
const AREA_STATE = Object.fromEntries(Object.entries(areaVotes).map(([z3, v]) => [z3, Object.entries(v).sort((a, b) => b[1] - a[1])[0][0]]));

// ---- checkpoints --------------------------------------------------------------------------
// the projection us-atlas used, so dots land on the right spot (insets included)
const proj = d3.geoAlbersUsa().scale(1300).translate([487.5, 305]);
const pts = JSON.parse(fs.readFileSync(args.points, 'utf8'));
const rows = [];
let offMap = 0, refiled = 0;
for (const p of pts) {
  if (!/^\d{3}$/.test(p.zip3)) throw new Error('bad ZIP area ' + p.zip3);
  const state = AREA_STATE[p.zip3];
  if (!state) throw new Error('ZIP area with no state: ' + p.zip3);
  if (state !== p.state) refiled++;
  if (!CODES.has(state)) throw new Error('unknown state ' + state);
  if (!/^[A-Z]{3}\/\d+,\d+$/.test(p.g)) throw new Error('bad gridpoint ' + p.g);
  const xy = proj([p.lon, p.lat]);
  if (!xy) offMap++;
  const elev = typeof p.elev === 'number' ? Math.round(p.elev / 10) * 10 : null;
  rows.push([state, p.zip3, +p.lat.toFixed(4), +p.lon.toFixed(4), elev, p.g, xy ? +xy[0].toFixed(1) : null, xy ? +xy[1].toFixed(1) : null]);
}
// north first: the states most likely to need a winter pack finish loading first
rows.sort((a, b) => (b[2] - a[2]));
const states = shapes.map(s => [s.code, s.name]);
const missing = states.filter(([c]) => !rows.some(r => r[0] === c));
if (missing.length) throw new Error('states with no checkpoint: ' + missing.map(s => s[0]).join(', '));

// the page ties its saved forecast to this, so a rebuild never mixes lists
const version = crypto.createHash('sha1').update(JSON.stringify(rows)).digest('hex').slice(0, 12);
fs.writeFileSync(path.join(ROOT, 'data', 'winter-checkpoints.json'),
  '{"version":"' + version + '",\n"columns":["state","zip3","lat","lon","elev_ft","gridpoint","x","y"],\n"states":' + JSON.stringify(states) + ',\n"points":[\n' +
  rows.map(r => JSON.stringify(r)).join(',\n') + '\n]}\n');
fs.writeFileSync(path.join(ROOT, 'data', 'us-states.json'), JSON.stringify(shapes.map(s => [s.code, s.d, s.label, s.from])) + '\n');

// ---- ZIP centres for the check box ----------------------------------------------------------
// Census ZCTA internal points, two decimals (~1 km). Territories are left out.
const zipLines = [];
for (const line of fs.readFileSync(args.zcta, 'utf8').split('\n')) {
  const p = line.split('\t');
  if (p[0] === 'GEOID' || p.length < 7) continue;
  if (/^(00[6-9]|969|96799)/.test(p[0])) continue;   // PR, VI, Guam/N. Marianas, American Samoa
  zipLines.push(`${p[0]},${(+p[5]).toFixed(2)},${(+p[6].trim()).toFixed(2)}`);
}
zipLines.sort();
fs.writeFileSync(path.join(ROOT, 'data', 'zip-centroids.txt'), zipLines.join('\n') + '\n');

const zip3s = new Set(rows.map(r => r[1]));
console.log(`checkpoints: ${rows.length} (${offMap} off the map projection, ${refiled} refiled under their ZIP area's state) in ${zip3s.size} ZIP areas, version ${version}`);
console.log(`state outlines: ${shapes.length}, ZIP centres: ${zipLines.length}`);
for (const f of ['winter-checkpoints.json', 'us-states.json', 'zip-centroids.txt']) {
  console.log(`  data/${f}: ${(fs.statSync(path.join(ROOT, 'data', f)).size / 1024).toFixed(0)} KB`);
}
