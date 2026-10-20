import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from report_metrics import parse_metrics

class MetricTests(unittest.TestCase):
    def test_actual_one_line_final_overrides_progress(self):
        log='2026/10/19 22:52:08 INFO  :   581.492 KiB / 1.706 MiB, 33%, 15.885 KiB/s, ETA 1m13s (xfr#4/68)\n2026/10/19 22:53:39 INFO  :     1.896 MiB / 1.896 MiB, 100%, 3.314 KiB/s, ETA 0s'
        amount,speed=parse_metrics(log)
        self.assertAlmostEqual(amount,1.896/1024)
        self.assertAlmostEqual(speed,3.314/1024)
    def test_zero_is_known_and_missing_is_unknown(self):
        self.assertEqual(parse_metrics('0 B / 0 B, -, 0 B/s, ETA -'),(0,0))
        self.assertEqual(parse_metrics('file: Copied (new)'),(None,None))
    def test_standard_prefix_units_and_ansi(self):
        self.assertEqual(parse_metrics('Transferred: 2 GiB / 2 GiB, 100%, 4 MiB/s, ETA 0s'),(2,4))
        self.assertEqual(parse_metrics('\x1b[32m2026-10-19T22:53:39Z 2026/10/19 22:53:39 INFO : 512 B / 512 B, 100%, 256 B/s, ETA 0s\x1b[0m'),(512/1024**3,256/1024**2))
    def test_does_not_extract_from_filenames_script_or_file_counts(self):
        for text in ('private/Transferred: 2 GiB / 2 GiB, 100%, 4 MiB/s, ETA 0s: Copied (new)',
                     'echo "2 GiB / 2 GiB, 100%, 4 MiB/s, ETA 0s"',
                     'Transferred: 68 / 68, 100%',
                     '2 MiB / 2 MiB, 100%, NaN B/s, ETA 0s'):
            self.assertEqual(parse_metrics(text),(None,None))
