import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import bisync_state as state
spec = importlib.util.spec_from_file_location('helper', Path(__file__).resolve().parents[1] / 'scripts/bisync-helper.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class StateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.filters = self.root / 'filter.txt'
        self.filters.write_text('- /Tapo-Archive/**\n')

    def pair(self):
        for name in state.PAIR:
            (self.root / name).write_text('synthetic listing\n')

    def test_unrelated_files_or_old_pair_are_not_a_current_checkpoint(self):
        (self.root / 'unrelated.log').write_text('anything')
        for name in state.PAIR:
            (self.root / (name + '-old')).write_text('old')
        run = Mock()
        self.assertFalse(state.validate(self.root, self.filters, runner=run)['valid'])
        run.assert_not_called()

    def test_pair_requires_native_integrity_check_and_uses_a_copy(self):
        self.pair()
        def run(args, **kw):
            self.assertIn('--check-sync=only', args)
            self.assertEqual(kw['env']['RCLONE_CONFIG_GDRIVE_TYPE'], 'local')
            self.assertEqual(kw['env']['RCLONE_CONFIG_KOOFR_TYPE'], 'local')
            self.assertIn('--config', args)
            self.assertNotIn('--resync', args)
            workdir = Path(args[args.index('--workdir') + 1])
            self.assertNotEqual(workdir, self.root)
            (workdir / state.PAIR[0]).write_text('modified copy')
            return subprocess.CompletedProcess(args, 0, '', '')
        self.assertTrue(state.validate(self.root, self.filters, runner=run)['valid'])
        self.assertEqual((self.root / state.PAIR[0]).read_text(), 'synthetic listing\n')

    def test_mismatch_timeout_and_missing_binary_fail_closed(self):
        self.pair()
        for result in (subprocess.CompletedProcess([], 7, '', 'private filename'),):
            self.assertFalse(state.validate(self.root, self.filters, runner=Mock(return_value=result))['valid'])
        for exc in (FileNotFoundError(), subprocess.TimeoutExpired('rclone', 45)):
            self.assertFalse(state.validate(self.root, self.filters, runner=Mock(side_effect=exc))['valid'])

    def test_symlinks_rejected(self):
        self.pair()
        first = self.root / state.PAIR[0]
        first.unlink()
        first.symlink_to(self.root / state.PAIR[1])
        self.assertFalse(state.validate(self.root, self.filters)['valid'])

    def test_exit_124_is_not_automatically_a_safe_pause(self):
        self.assertFalse(state.eligible(124, 'Graceful shutdown failed.'))
        self.assertFalse(state.eligible(124, 'Interrupted without confirmation'))
        self.assertTrue(state.eligible(124, 'Graceful shutdown completed successfully.'))
        self.assertFalse(state.eligible(124, 'Graceful shutdown completed successfully.\nMust run --resync'))
        self.assertFalse(state.eligible(7, 'Graceful shutdown completed successfully.'))
        self.assertTrue(state.eligible(0, 'Bisync successful'))

    def test_global_state_errors_are_not_ignored_even_with_permission_errors(self):
        for marker in ('path1 and path2 are out of sync', 'Path1 file not found in Path2',
                       'Path2 file not found in Path1', 'Graceful shutdown failed',
                       'Bisync interrupted. Must run --resync to recover.'):
            with self.subTest(marker=marker):
                log = self.root / 'bisync.log'
                log.write_text('2026/11/01 01:00:00 ERROR : harmless.txt: Failed to copy: insufficientFilePermissions\n'
                               '2026/11/01 01:00:01 ERROR : \x1b[31m' + marker + '\x1b[0m\n')
                result = self.root / 'result'
                with contextlib.redirect_stdout(io.StringIO()):
                    helper.parse_log(log, self.root / 'ignored', self.root / 'report', result)
                self.assertIn('has_unignorable_errors=true', result.read_text())

    def test_ignorable_file_wrapper_still_does_not_force_global_failure(self):
        log = self.root / 'bisync.log'
        log.write_text('2026/11/01 01:00:00 ERROR : harmless.txt: Failed to copy: insufficientFilePermissions\n'
                       '2026/11/01 01:00:01 ERROR : Bisync critical error: failed copying\n')
        result = self.root / 'result'
        with contextlib.redirect_stdout(io.StringIO()):
            helper.parse_log(log, self.root / 'ignored', self.root / 'report', result)
        self.assertIn('has_unignorable_errors=false', result.read_text())

    def listing(self, name, rows):
        import json
        text = '# bisync listing v1 from 2026-10-30T00:00:00.000000000+0000\n'
        for path, size, digest in rows:
            text += f'- {size:8} {digest} - 2026-10-30T00:00:00.000000000+0000 {json.dumps(path, ensure_ascii=False)}\n'
        (self.root / name).write_text(text)

    def test_unicode_equivalence_checks_metadata_and_unique_names_without_rewriting(self):
        import unicodedata
        a = 'tài liệu.pdf'
        b = unicodedata.normalize('NFD', a)
        digest = 'md5:' + 'a' * 32
        self.listing(state.PAIR[0], [(a, 100, digest)])
        self.listing(state.PAIR[1], [(b, 100, digest)])
        before = (self.root / state.PAIR[1]).read_bytes()
        self.assertTrue(state.compare_unicode_pair(self.root)['equivalent'])
        self.assertEqual(before, (self.root / state.PAIR[1]).read_bytes())
        native = Mock(return_value=subprocess.CompletedProcess([], 7, '', 'path1 and path2 are out of sync'))
        self.assertTrue(state.validate(self.root, self.filters, runner=native)['valid'])
        native = Mock(return_value=subprocess.CompletedProcess([], 7, '', 'authentication failed'))
        self.assertFalse(state.validate(self.root, self.filters, runner=native)['valid'])
        self.listing(state.PAIR[1], [(b, 101, digest)])
        self.assertFalse(state.compare_unicode_pair(self.root)['equivalent'])
        self.listing(state.PAIR[1], [(b, 100, 'md5:' + 'b' * 32)])
        self.assertFalse(state.compare_unicode_pair(self.root)['equivalent'])
        self.listing(state.PAIR[1], [(a, 100, digest), (b, 100, digest)])
        self.assertTrue(state.compare_unicode_pair(self.root)['equivalent'])
        self.listing(state.PAIR[1], [(a, 100, digest), (b, 100, 'md5:' + 'b' * 32)])
        self.assertEqual(state.compare_unicode_pair(self.root)['reason'], 'unicode_collision')

    def test_unicode_comparison_rejects_unverifiable_or_malformed_listings(self):
        self.listing(state.PAIR[0], [('sample', 100, '-')])
        self.listing(state.PAIR[1], [('sample-other', 100, '-')])
        self.assertFalse(state.compare_unicode_pair(self.root)['equivalent'])
        (self.root / state.PAIR[0]).write_text('garbage')
        self.assertFalse(state.compare_unicode_pair(self.root)['equivalent'])

    def test_exact_names_keep_native_unknown_hash_semantics_but_aliases_require_hash(self):
        import unicodedata
        self.listing(state.PAIR[0], [('document', -1, '-')])
        self.listing(state.PAIR[1], [('document', -1, '-')])
        self.assertTrue(state.compare_unicode_pair(self.root)['equivalent'])
        self.listing(state.PAIR[0], [('tài liệu', -1, '-')])
        self.listing(state.PAIR[1], [(unicodedata.normalize('NFD', 'tài liệu'), -1, '-')])
        self.assertFalse(state.compare_unicode_pair(self.root)['equivalent'])
