# Transfer metrics parser correction — 20 October 2026

Real bisync run 39337249732, job 118349704067, completed successfully.
Its final aggregate line at 2026/10/19 22:53:39 is:
```
1.896 MiB / 1.896 MiB, 100%, 3.314 KiB/s, ETA 0s
```
The previous parser required Transferred: and omitted B/KiB transfer units.
The workflow already supplies --stats 30s --stats-one-line; no new engine flags,
scans, backup executions, schedules or media/state changes are required.

Shared report_metrics.parse_metrics now handles prefixed standard output and
one-line aggregates, ANSI, B through PiB, known zeros and absent values.
It selects the last aggregate and preserves precision in GiB/MiB per second.
It rejects copied filenames, shell source, file counts and malformed numbers.
Both normal summary and report-only recovery use the same parser.
15 publisher/recovery/parser tests pass; the numeric fixture matches real logs.
Speed is the last rclone-reported speed, not a separately computed whole-run rate.

The existing committed GAS report for run 39337249732 has null metrics.
Its run identity/hash is immutable: republishing different content for the
same run_number/run_attempt would correctly cause REPORT_CONFLICT.
Do not reset HEAD, fake a new attempt, or rerun backup solely to fill these cells.
The next ordinary scheduled run will publish parsed metrics automatically.
Current real historical values are 1.896 MiB and 3.314 KiB/s as above.
