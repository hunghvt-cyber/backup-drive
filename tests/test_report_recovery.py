import copy
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from recover_bisync_report import reconstruct,REPO
class RecoveryTests(unittest.TestCase):
    def fixture(self):
        run={'id':101,'repository':{'full_name':REPO},'path':'.github/workflows/bisync.yml','head_branch':'main','event':'schedule','status':'completed','run_attempt':1,'run_started_at':'2026-10-19T22:46:17Z','updated_at':'2026-10-19T22:53:48Z'}
        jobs={'jobs':[{'name':'run-bisync','run_id':101,'steps':[{'name':n,'conclusion':'success','completed_at':'2026-10-19T22:53:41Z'} for n in ('Run Bisync','Final Status','Upload Bisync Report')]}]}
        log='2026-10-19T22:53:41.0000000Z Initial rclone exit code: 0\n'
        return run,jobs,log
    def test_real_timestamp_and_no_invented_missing_metrics(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp,'bisync.log').write_text('Transferred: 512 MiB / 512 MiB, 100%, 2 MiB/s\nBisync successful\n')
            report=reconstruct(*self.fixture(),tmp)
            self.assertEqual(report['finished_at'],'2026-10-19T22:53:41Z')
            self.assertEqual(report['metrics']['transferred_gib'],0.5)
            self.assertIsNone(report['metrics']['ignored_count'])
    def test_rejects_unverified_sources_terminal_failure_and_missing_artifact(self):
        run,jobs,log=self.fixture()
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp,'bisync.log').write_text('Bisync successful\n')
            for patch in ({'path':'.github/workflows/other.yml'},{'event':'pull_request'},{'head_branch':'test'},{'run_attempt':2}):
                with self.assertRaises(ValueError):reconstruct({**run,**patch},jobs,log,tmp)
            for badlog in (log.replace(': 0',': 1'),'echo "Initial rclone exit code: 0"'):
                with self.assertRaises(ValueError):reconstruct(run,jobs,badlog,tmp)
            broken=copy.deepcopy(jobs);broken['jobs'][0]['steps'][1]['conclusion']='failure'
            with self.assertRaises(ValueError):reconstruct(run,broken,log,tmp)
            Path(tmp,'bisync.log').unlink()
            with self.assertRaises(ValueError):reconstruct(run,jobs,log,tmp)

    def test_signed_log_redirect_does_not_forward_github_bearer(self):
        from recover_bisync_report import SafeGitHubRedirect
        from urllib.request import Request
        req=Request('https://api.github.com/repos/example/actions/jobs/1/logs',headers={'Authorization':'Bearer synthetic-only'})
        redirect=SafeGitHubRedirect().redirect_request(req,None,302,'Found',{},'https://example.blob.core.windows.net/signed-log')
        self.assertIsNone(redirect.get_header('Authorization'))
        with self.assertRaises(ValueError):SafeGitHubRedirect().redirect_request(req,None,302,'Found',{},'http://example.test/log')
