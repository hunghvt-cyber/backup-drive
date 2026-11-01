import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from drive_copy import command, summary


class CopyPolicyTests(unittest.TestCase):
    def test_fixed_direction_non_deleting_and_versioned(self):
        args = command('123', '2', 'filters', 'combined')
        self.assertEqual(args[:4], ['rclone', 'copy', 'gdrive:', 'koofr:GoogleBackup'])
        self.assertEqual(args[args.index('--backup-dir')+1], 'koofr:GoogleBackup-Versions/123-2')
        for forbidden in ('sync', 'bisync', '--delete-excluded', '--inplace', '--resync', '--delete-before', '--delete-after'):
            self.assertNotIn(forbidden, args)
        self.assertIn('--dry-run', command('123', '2', 'filters', 'combined', dry_run=True))
        for identity in ('../unsafe', '0', '1;touch something'):
            with self.assertRaises(ValueError):
                command(identity, '1', 'filters', 'combined')

    def test_sanitized_report_and_incomplete_scope(self):
        result = summary('Error 429\nPRIVATE-PATH.pdf: copied', '= SECRET\n+ SECRET\n- SECRET\n* SECRET\n! SECRET', 124, True, '2026-11-01T00:00:00Z')
        self.assertFalse(result['complete'])
        self.assertFalse(result['comparison_counts_complete'])
        self.assertTrue(result['error_categories']['rate_limit'])
        self.assertNotIn('SECRET', json.dumps(result))
        self.assertNotIn('PRIVATE-PATH', json.dumps(result))
        self.assertEqual(list(result['comparison_counts'].values()), [1]*5)


@unittest.skipUnless(shutil.which('rclone'), 'native rclone integration runs in CI')
class NativeCopyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.drive = self.root/'drive'
        self.koofr = self.root/'koofr'
        self.dest = self.koofr/'GoogleBackup'
        self.drive.mkdir()
        self.dest.mkdir(parents=True)
        self.filters = self.root/'filter'
        self.filters.write_text('- /Tapo-Archive/**\n- /Tapo-Archive/\n')
        self.config = self.root/'rclone.conf'
        self.config.write_text(f'[gdrive]\ntype = alias\nremote = {self.drive}\n[koofr]\ntype = alias\nremote = {self.koofr}\n')
        self.env = {k:v for k,v in os.environ.items() if not k.startswith('RCLONE_')}
        self.env['RCLONE_CONFIG'] = str(self.config)

    def run_copy(self, dry_run=False):
        args = command('123', '1', self.filters, self.root/'combined', dry_run=dry_run)
        p = subprocess.run(args, env=self.env, capture_output=True, text=True, timeout=30)
        self.assertEqual(p.returncode, 0, p.stderr[-2500:])

    def test_source_unchanged_extras_retained_and_replaced_version_preserved(self):
        (self.drive/'changed.txt').write_text('source version')
        (self.drive/'new.txt').write_text('new source file')
        (self.dest/'changed.txt').write_text('old destination version')
        (self.dest/'only-koofr.txt').write_text('keep me')
        for root in (self.drive, self.dest):
            (root/'Tapo-Archive').mkdir()
        (self.drive/'Tapo-Archive'/'camera.mp4').write_text('source camera')
        (self.dest/'Tapo-Archive'/'camera.mp4').write_text('keep destination camera')
        before = {str(p.relative_to(self.drive)):hashlib.sha256(p.read_bytes()).hexdigest() for p in self.drive.rglob('*') if p.is_file()}
        self.run_copy()
        self.assertEqual((self.dest/'changed.txt').read_text(), 'source version')
        self.assertEqual((self.dest/'new.txt').read_text(), 'new source file')
        self.assertEqual((self.dest/'only-koofr.txt').read_text(), 'keep me')
        self.assertFalse((self.drive/'only-koofr.txt').exists())
        self.assertEqual((self.koofr/'GoogleBackup-Versions'/'123-1'/'changed.txt').read_text(), 'old destination version')
        self.assertEqual((self.dest/'Tapo-Archive'/'camera.mp4').read_text(), 'keep destination camera')
        after = {str(p.relative_to(self.drive)):hashlib.sha256(p.read_bytes()).hexdigest() for p in self.drive.rglob('*') if p.is_file()}
        self.assertEqual(before, after)
        self.run_copy()  # Idempotent: does not overwrite the preserved old version.
        self.assertEqual((self.koofr/'GoogleBackup-Versions'/'123-1'/'changed.txt').read_text(), 'old destination version')

    def test_preview_makes_no_data_changes(self):
        (self.drive/'changed.txt').write_text('new')
        (self.dest/'changed.txt').write_text('old')
        (self.dest/'only-koofr.txt').write_text('keep')
        self.run_copy(dry_run=True)
        self.assertEqual((self.dest/'changed.txt').read_text(), 'old')
        self.assertEqual((self.dest/'only-koofr.txt').read_text(), 'keep')
        self.assertFalse((self.koofr/'GoogleBackup-Versions').exists())

class CopyReportTests(unittest.TestCase):
    def test_real_result_controls_status_and_preview_is_rejected(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location('backup_summary', Path(__file__).resolve().parents[1]/'scripts/backup-summary.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        env = {'GITHUB_RUN_ID':'123','GITHUB_REPOSITORY':'hunghvt-cyber/backup-drive','RCLONE_RC':'0','RETRY_RC':'0'}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            result = summary('', '', 1, False, '2026-11-01T00:00:00Z')
            (root/'copy-result.json').write_text(json.dumps(result))
            self.assertEqual(module.build_report(env, root)['status'], 'failure')
            result['exit_code'] = 124
            (root/'copy-result.json').write_text(json.dumps(result))
            self.assertEqual(module.build_report(env, root)['status'], 'paused')
            result['dry_run'] = True
            (root/'copy-result.json').write_text(json.dumps(result))
            with self.assertRaises(ValueError):
                module.build_report(env, root)
