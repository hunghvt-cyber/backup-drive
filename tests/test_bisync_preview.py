import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from bisync_preview_summary import summarize


class PreviewTests(unittest.TestCase):
    def test_counts_do_not_expose_paths_and_timeout_is_incomplete(self):
        log = ('INFO : - Path2 Queue copy to Path1 - PRIVATE.txt\n'
               'INFO : - Path1 Queue copy to Path2 - PRIVATE.txt\n'
               'INFO : - Do queued deletes on Path1\n'
               'INFO : - Path1 Queue delete - PRIVATE.txt\n'
               'INFO : - Path2 Queue delete - PRIVATE.txt\n'
               'INFO : Bisync successful\n')
        result = summarize(log, 0)
        self.assertEqual(result['queue_copy_to_drive'], 1)
        self.assertEqual(result['queue_copy_to_koofr'], 1)
        self.assertEqual(result['queue_delete_drive'], 1)
        self.assertEqual(result['queue_delete_koofr'], 1)
        self.assertTrue(result['complete'])
        self.assertNotIn('PRIVATE', str(result))
        self.assertFalse(summarize(log, 124)['complete'])
