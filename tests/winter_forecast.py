"""The forecast builder (scripts/build-winter-forecast.py) reads the rule the way the page does.
Standard library only: the grid part (numpy, pygrib) is not exercised here.
  python3 tests/winter_forecast.py"""
import importlib.util, json, os, subprocess, sys, unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
spec = importlib.util.spec_from_file_location('bwf', os.path.join(ROOT, 'scripts', 'build-winter-forecast.py'))
bwf = importlib.util.module_from_spec(spec); spec.loader.exec_module(bwf)
K = bwf.core_constants(os.path.join(ROOT, 'winter-core.js'))


def periods(day, temps, offset='-06:00', hours=range(24)):
    return [{'startTime': '%sT%02d:00:00%s' % (day, h, offset), 'temperature': temps(h), 'temperatureUnit': 'F'} for h in hours]


class Rule(unittest.TestCase):
    def low(self, per, day='2026-12-08'):
        return bwf.spell_temp(bwf.window_temps(per, day, K), K['cold_hours'])

    def test_constants_come_from_the_core(self):
        self.assertEqual((K['start'], K['end'], K['cold_hours']), (11, 18, 5))

    def test_five_hours_in_a_row(self):
        at = lambda hs, cold: (lambda h: cold if h in hs else 50)
        self.assertEqual(self.low(periods('2026-12-08', at([12, 13, 14, 15, 16], 30))), 30)
        self.assertEqual(self.low(periods('2026-12-08', at([12, 13, 14, 15], 20))), 50)        # 4 hours: no
        self.assertEqual(self.low(periods('2026-12-08', at([11, 12, 13, 17, 18], 20))), 50)    # not in a row: no
        self.assertEqual(self.low(periods('2026-12-08', lambda h: 10 if h < 11 or h > 18 else 40)), 40)  # outside the window: ignored

    def test_missing_hour_and_units(self):
        per = [p for p in periods('2026-12-08', lambda h: 50) if not p['startTime'].startswith('2026-12-08T15')]
        self.assertIsNone(self.low(per))
        c = [{**p, 'temperature': {'value': 0 if 12 <= int(p['startTime'][11:13]) <= 16 else 10, 'unitCode': 'wmoUnit:degC'}}
             for p in periods('2026-12-08', lambda h: 0)]
        self.assertEqual(self.low(c), 32)
        self.assertIsNone(bwf.to_f(float('nan'), 'F'))
        self.assertEqual(bwf.to_f(-0.5, 'C'), 31)   # Math.round, not Python's round-half-even

    def test_same_answers_as_the_page(self):
        """winter-core.js and this script on the same forecasts."""
        days = ['2026-12-08', '2026-12-09']
        cases = [periods('2026-12-08', lambda h: 20 + abs(h - 15) * 3) + periods('2026-12-09', lambda h: 35 - (h % 4)),
                 periods('2026-12-08', lambda h: 31 + (h % 3)) + periods('2026-12-09', lambda h: 33 if h == 14 else 29, offset='-08:00')]
        js = ("const C = require(process.argv[1]); const cases = JSON.parse(process.argv[2]);"
              "console.log(JSON.stringify(cases.map(p => C.coldSpells(p, %s))));" % json.dumps(days))
        out = subprocess.run(['node', '-e', js, os.path.join(ROOT, 'winter-core.js'), json.dumps(cases)], capture_output=True, text=True, check=True).stdout
        self.assertEqual(json.loads(out), [[self.low(p, d) for d in days] for p in cases])


class Requests(unittest.TestCase):
    def test_points_coordinates_have_no_trailing_zeros(self):
        self.assertEqual((bwf.coord(38.044), bwf.coord(-119.26), bwf.coord(40.0), bwf.coord(35.12346)), ('38.044', '-119.26', '40', '35.1235'))

    def test_out_of_time_means_no_request(self):
        old = bwf._deadline[0]
        try:
            bwf._deadline[0] = 0           # the API pass is over: no connection is even opened
            self.assertIsNone(bwf.fetch('https://api.weather.gov/gridpoints/XXX/1,1/forecast/hourly'))
        finally:
            bwf._deadline[0] = old


class Grid(unittest.TestCase):
    def test_hours_inside_a_3_hour_step_are_read_in_between(self):
        import datetime as dt
        t = lambda h: dt.datetime(2026, 12, 8, 0, tzinfo=dt.timezone.utc) + dt.timedelta(hours=h)
        grids = {t(0): [30.0], t(1): [33.0], t(4): [36.0], t(10): [40.0]}   # hourly, a 3-hour step, a 6-hour step
        at = bwf.grid_reader(grids)
        self.assertEqual(at(t(1), 0), 33.0)               # on the grid
        self.assertAlmostEqual(at(t(2), 0), 34.0)         # a third of the way from 33 to 36
        self.assertIsNone(at(t(6), 0))                    # inside a 6-hour step: not read
        self.assertIsNone(at(t(11), 0))                   # past the end
        self.assertIsNone(at(t(-1), 0))                   # before the start

    def test_an_area_goes_in_whole_or_not_at_all(self):
        zips = ['93501', '93502', '93601', '93602', '99501']
        inside = [True, True, True, True, False]           # the last one isn't on the grid (Alaska)
        vals = [[40, 41], [30, None], [50, 51], [52, 53], [None, None]]
        got = bwf.zip_readings(zips, inside, vals, ['d1', 'd2'])
        self.assertEqual(got['d1'], {'93501': 40, '93502': 30, '93601': 50, '93602': 52})
        self.assertEqual(got['d2'], {'93601': 51, '93602': 53})   # 935 is missing a ZIP that day: left out whole


if __name__ == '__main__':
    r = unittest.main(exit=False, verbosity=0).result
    sys.exit(0 if r.wasSuccessful() else 1)
