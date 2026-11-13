"""Conservation and three-stream enrichment regression checks (stdlib only).

Run from any directory. Requires Git history containing the audited source commit.
Optional --native-directory reads next-release output from the real Release Please
Changelog updater exercised by scripts/verify-native-changelog.mjs.
"""
from __future__ import annotations

import argparse
import collections
import contextlib
import hashlib
import importlib.util
import json
import re
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
AUDIT = json.loads((ROOT / 'docs/deployment/changelog-history-audit.json').read_text())
SPEC = importlib.util.spec_from_file_location('enrichment', ROOT / '.github/scripts/enrich_release_notes.py')
assert SPEC is not None and SPEC.loader is not None
ENRICH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ENRICH)
NATIVE_DIRECTORY = None
REPOSITORY = 'quokkify/marketdesk'


def source_pr(note: str) -> dict[str, str]:
    return {'title': 'feat(release): scoped fixture', 'body': '## Release note\n' + note}


def release_notes(number: int, note: str) -> str:
    return ENRICH.render_notes([ENRICH.make_entry(number, source_pr(note))], [], ENRICH.pull_link(REPOSITORY))


def release_heading(component: str) -> str:
    return f'## [0.22.0](https://github.com/{REPOSITORY}/compare/{component}-v0.21.0...{component}-v0.22.0) (2026-10-04)'


def git(*args: str) -> str:
    return subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout


def digest(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def read_histories() -> dict[str, str]:
    return {component: (ROOT / path).read_text() for component, path in AUDIT['targets'].items()}


def verify_baseline(text: str, corrected: str) -> str:
    """Ignore only newer release blocks before the exact frozen baseline."""
    header, baseline = corrected.split('\n\n', 1)
    baseline = baseline.rstrip()
    heading = baseline.splitlines()[0]
    assert text.startswith(header + '\n\n'), 'document header'
    assert text.splitlines().count(heading) == 1, 'baseline heading'
    start = text.index('\n' + heading) + 1
    inherited = text.index('\n\n## Inherited legacy history', start)
    assert text[start:inherited] == baseline, 'baseline content'
    prefix = text[len(header) + 2:start]
    headings = re.findall(r'(?m)^## .+$', prefix)
    assert not prefix or (headings and prefix.startswith(headings[0] + '\n')), 'unexpected prefix'
    versions = []
    for release_heading in headings:
        match = re.fullmatch(r'## \[(\d+\.\d+\.\d+)\]\(https?://[^\s)]+\) \(\d{4}-\d{2}-\d{2}\)', release_heading)
        assert match is not None, 'prepended release heading'
        versions.append(tuple(map(int, match[1].split('.'))))
    baseline_match = re.match(r'## \[(\d+\.\d+\.\d+)\]', heading)
    assert baseline_match is not None, 'frozen baseline heading'
    baseline_version = baseline_match[1]
    versions.append(tuple(map(int, baseline_version.split('.'))))
    assert all(new > old for new, old in zip(versions, versions[1:])), 'release order'

    return '.'.join(map(str, versions[0]))


def verify_conservation(histories: dict[str, str]) -> None:
    assert set(histories) == set(AUDIT['targets']), 'component streams'
    expected = {component: [] for component in histories}
    for entry in AUDIT['entries']:
        for component in entry['components']:
            expected[component].append(entry['id'])
    for component, text in histories.items():
        ids = [int(value) for value in re.findall(r'<!-- legacy-entry:(\d+) -->', text)]
        assert collections.Counter(ids) == collections.Counter(expected[component]), component
        for entry_id in ids:
            entry = AUDIT['entries'][entry_id]
            marker = f"<!-- legacy-entry:{entry_id} -->"
            tail = text.split(marker, 1)[1].split('<!-- legacy-entry:', 1)[0]
            assert entry['text'] in tail, entry_id
            assert digest(entry['text']) == entry['content_sha256'], entry_id
            if entry['shared_only']:
                assert '_Shared/legacy provenance (archived here, not backend-only):_' in tail
        source_bullets = [e['text'] for e in AUDIT['entries'] if component in e['components']]
        legacy = text.split('## Inherited legacy history', 1)[1]
        assert collections.Counter(re.findall(r'(?m)^\* .+$', legacy)) == collections.Counter(source_bullets)
        for section in AUDIT['sections']:
            selected = [e for e in AUDIT['entries'] if e['section'] == section['id'] and component in e['components']]
            has_rich = section['id'] == 0 and component in AUDIT['rich_assignments']
            heading = section['heading'].replace('## ', '## Legacy ', 1)
            assert (heading in text) == bool(selected or has_rich), heading
            if selected:
                block = text.split(heading, 1)[1].split('\n## ', 1)[0]
                for entry in selected:
                    assert entry['text'] in block
                    assert entry['category'] in block
        for block in AUDIT['rich_blocks']:
            assert text.count(block) == int(component in AUDIT['rich_assignments'])


class HistoryChecks(unittest.TestCase):
    def test_source_inventory_is_complete(self):
        source = git('show', f"{AUDIT['source_commit']}:{AUDIT['source_path']}")
        self.assertEqual(digest(source), AUDIT['source_sha256'])
        self.assertEqual(len(source.encode()), AUDIT['source_bytes'])
        self.assertEqual(re.findall(r'(?m)^## .+$', source), [s['heading'] for s in AUDIT['sections']])
        self.assertEqual(re.findall(r'(?m)^\* .+$', source), [e['text'] for e in AUDIT['entries']])
        # Account for every non-whitespace source block, not only bullets.
        remainder = source
        for block in AUDIT['rich_blocks']:
            remainder = remainder.replace(block, '')
        remainder = re.sub(r'(?m)^#{1,3} .+$|^\* .+$', '', remainder)
        self.assertEqual(remainder.strip(), '')
        self.assertEqual(len(AUDIT['entries']), 282)
        commits = {sha for entry in AUDIT['entries'] for sha in entry['commits']}
        self.assertEqual(len(commits), 168)
        seen = {}
        overlaps = 0
        for entry in AUDIT['entries']:
            key = tuple(entry['commits'])
            self.assertEqual(entry['duplicate_of'], seen.get(key))
            overlaps += key in seen
            seen.setdefault(key, entry['id'])
        self.assertEqual(overlaps, 114)

    def test_history_conservation(self):
        verify_conservation(read_histories())

    def test_conservation_rejects_missing_or_wrong_component(self):
        histories = read_histories()
        histories['frontend'] = histories['frontend'].replace('<!-- legacy-entry:1 -->', '', 1)
        with self.assertRaises(AssertionError):
            verify_conservation(histories)
        histories = read_histories()
        histories['assets'] += '\n<!-- legacy-entry:1 -->\n' + AUDIT['entries'][1]['text']
        with self.assertRaises(AssertionError):
            verify_conservation(histories)

    def test_assignment_evidence(self):
        verified = {}
        for entry in AUDIT['entries']:
            sha = entry['commits'][0]
            if sha not in verified:
                verified[sha] = sorted(set(git('show', '--format=', '--name-only', sha).splitlines()) - {''})
            self.assertEqual(entry['paths'], verified[sha])
            direct = {c for c, prefix in [('backend', 'src/backend/'), ('frontend', 'src/frontend/'), ('assets', 'public/')] if any(p.startswith(prefix) for p in entry['paths'])}
            for evidence in entry['dependency_evidence']:
                path, dependency = evidence['importer'], evidence['dependency']
                content = git('show', f'{sha}:{path}')
                self.assertTrue("'" + dependency in content or '"' + dependency in content)
                before = json.loads(git('show', f'{sha}^:package.json'))['dependencies']
                after = json.loads(git('show', f'{sha}:package.json'))['dependencies']
                self.assertNotEqual(before.get(dependency), after.get(dependency))
                direct.add('backend' if path.startswith('src/backend/') else 'frontend')
            self.assertEqual(entry['components'], sorted(direct or {'backend'}))
            self.assertEqual(entry['shared_only'], not direct)

    def test_current_release_and_versions_stable(self):
        manifest = json.loads((ROOT / '.github/release-please/manifest.json').read_text())
        self.assertEqual(set(manifest), {'src/backend', 'src/frontend', 'public'})
        for component, text in read_histories().items():
            original = git('show', f"{AUDIT['source_commit']}:{AUDIT['targets'][component]}")
            self.assertEqual(digest(original), AUDIT['current_sha256'][component])
            corrected = original.replace(f'{component}-v0.20.0...', 'marketdesk-v0.20.0...')
            self.assertEqual(digest(corrected), AUDIT['migrated_current_sha256'][component])
            # Future release prepends are allowed; the actual 0.21.0 remains intact.
            self.assertEqual(verify_baseline(text, corrected), manifest[str(Path(AUDIT['targets'][component]).parent)])
        for version in manifest.values():
            self.assertGreaterEqual(tuple(map(int, version.split('.'))), (0, 21, 0))

    def test_baseline_rejects_corruption_after_prepends(self):
        for component, text in read_histories().items():
            original = git('show', f"{AUDIT['source_commit']}:{AUDIT['targets'][component]}")
            corrected = original.replace(f'{component}-v0.20.0...', 'marketdesk-v0.20.0...')
            baseline = corrected.split('\n\n', 1)[1].rstrip()
            text = text.replace('# Changelog\n\n', '# Changelog\n\n## [0.99.0](https://github.com/quokkify/marketdesk/releases/tag/next) (2026-10-04)\n\n* new release\n\n', 1)
            heading = baseline.splitlines()[0]
            bullet = next(line for line in baseline.splitlines() if line.startswith('* '))
            for old, new in [(heading, ''), (heading, heading.replace('0.21.0', '0.21.9')),
                             ('2026-10-03', '2026-10-02'), (bullet, ''), (bullet, bullet + ' altered'),
                             ('marketdesk-v0.20.0', 'missing-tag'), ('/issues/', '/pull/'),
                             ('/commit/', '/commits/'), ('### ✨ Features', '### Changed')]:
                with self.subTest(component=component, corruption=old):
                    damaged = text.replace(baseline, baseline.replace(old, new, 1), 1)
                    self.assertNotEqual(damaged, text)
                    with self.assertRaises(AssertionError):
                        verify_baseline(damaged, corrected)
            with self.assertRaises(AssertionError):
                verify_baseline(text.replace(baseline, baseline + '\n\n' + baseline, 1), corrected)

    def test_release_prepend_scenarios_and_metadata(self):
        histories = read_histories()
        baseline_histories = {c: '# Changelog\n\n' + text[text.index('## [0.21.0]'):]
                              for c, text in histories.items()}
        manifest = {str(Path(p).parent): '0.21.0' for p in AUDIT['targets'].values()}
        for active, versions in [(set(), []), (set(histories), ['0.21.1']),
                                 (set(histories), ['0.21.1', '0.22.0']),
                                 ({'backend'}, ['0.21.1']), ({'frontend', 'assets'}, ['0.21.1'])]:
            with self.subTest(active=active, versions=versions):
                scenario = dict(baseline_histories)
                metadata = dict(manifest)
                for c in active:
                    for version in versions:
                        entry = f'## [{version}](https://github.com/quokkify/marketdesk/releases/tag/{c}-v{version}) (2026-10-04)\n\n* next release\n\n'
                        scenario[c] = scenario[c].replace('# Changelog\n\n', '# Changelog\n\n' + entry, 1)
                    metadata[str(Path(AUDIT['targets'][c]).parent)] = versions[-1]
                with mock.patch(__name__ + '.read_histories', return_value=scenario), mock.patch.object(Path, 'read_text', return_value=json.dumps(metadata)):
                    self.test_current_release_and_versions_stable()
                    verify_conservation(scenario)
                    broken = dict(metadata)
                    broken['src/backend'] = '0.99.0'
                    with mock.patch.object(Path, 'read_text', return_value=json.dumps(broken)), self.assertRaises(AssertionError):
                        self.test_current_release_and_versions_stable()
                    broken.pop('public')
                    with mock.patch.object(Path, 'read_text', return_value=json.dumps(broken)), self.assertRaises(AssertionError):
                        self.test_current_release_and_versions_stable()

    def test_inherited_corruption_and_missing_stream_fail(self):
        histories = read_histories()
        for component in histories:
            damaged = dict(histories)
            del damaged[component]
            with self.subTest(component=component), self.assertRaises(AssertionError):
                verify_conservation(damaged)
        entry = AUDIT['entries'][0]
        component = entry['components'][0]
        for old, new in [(entry['text'], ''), (entry['text'], entry['text'] + ' altered'),
                         (AUDIT['sections'][entry['section']]['heading'].replace('## ', '## Legacy ', 1), '## Legacy corrupted')]:
            damaged = dict(histories)
            damaged[component] = damaged[component].replace(old, new, 1)
            with self.subTest(corruption=old), self.assertRaises(AssertionError):
                verify_conservation(damaged)

    def test_chronology_links_and_no_fake_legacy_components(self):
        dates = [s['date'] for s in AUDIT['sections']]
        self.assertEqual(dates, sorted(dates, reverse=True))
        for text in read_histories().values():
            self.assertNotRegex(text, r'(?:backend|frontend|assets)-v0\.20\.0')
            for link in re.findall(r'\]\(([^)]+)\)', text):
                if not re.match(r'https?://|#', link):
                    component = next(c for c, value in read_histories().items() if value == text)
                    self.assertTrue(((ROOT / AUDIT['targets'][component]).parent / link).is_file(), link)
        for section in AUDIT['sections']:
            self.assertEqual(section['release_url'], 'https://github.com/quokkify/marketdesk/releases/tag/' + section['tag'])
        self.assertIn('v1.0.0', [s['tag'] for s in AUDIT['sections']])

    def test_three_stream_config_and_source_boundaries(self):
        targets = ENRICH.discover_release_targets(mode='manifest', package_path='.', config_file=ROOT / '.github/release-please/config.json', manifest_file=ROOT / '.github/release-please/manifest.json', config_backed_single=False)
        self.assertEqual({c: p.as_posix() for c, p in targets}, AUDIT['targets'])
        for component, text in read_histories().items():
            text = '# Changelog\n\n' + text[text.index('## [0.21.0]'):]
            number = 339 if component == 'backend' else 341
            self.assertEqual(ENRICH.source_pr_numbers(text, REPOSITORY), [number])
            legacy = text[text.index('## Inherited legacy history'):]
            sources = {number: source_pr('Current stream only.')}
            if component in AUDIT['rich_assignments']:
                sources[311] = source_pr('Do not resurrect inherited highlights.')
            updated, notes = ENRICH.render_changelog(text, REPOSITORY, sources)
            self.assertIn('Current stream only.', notes)
            self.assertIn(notes, updated)
            self.assertTrue(updated.endswith(legacy))
            # A rendered top section is a fixed point that no longer consults source PRs.
            self.assertEqual((updated, notes), ENRICH.render_changelog(updated, REPOSITORY, {}))
            self.assertNotIn('Do not resurrect', updated)

    def test_multi_component_lifecycle_and_inactive_stream(self):
        numbers = {'backend': 901, 'frontend': 902, 'assets': 903}
        header = 'Release Please generated header\n\n'
        body = header + '\n'.join(f'<details><summary>{c}: 0.22.0</summary>\n\n{release_heading(c)}\n\n### Features\n\nGenerated {c} notes.\n</details>' for c in numbers)
        notes = {c: (release_heading(c), release_notes(n, c + ' only.')) for c, n in numbers.items()}
        updated = ENRICH.replace_component_notes(body, notes)
        self.assertEqual(updated, ENRICH.replace_component_notes(updated, notes))
        self.assertTrue(updated.startswith(header))
        for c in numbers:
            block = updated.split(f'<details><summary>{c}:', 1)[1].split('</details>', 1)[0]
            self.assertIn(release_heading(c), block)
            self.assertIn(c + ' only.', block)
            self.assertNotIn(f'Generated {c} notes.', block)
            for other in set(numbers) - {c}:
                self.assertNotIn(other + ' only.', block)
        # A stream without rendered notes keeps what Release Please generated for it.
        partial = ENRICH.replace_component_notes(body, {'backend': notes['backend']})
        self.assertIn('backend only.', partial)
        for inactive in ['frontend', 'assets']:
            self.assertIn(f'Generated {inactive} notes.', partial)
        backend_only = f'<details><summary>backend: 0.22.0</summary>\n\n{release_heading("backend")}\n</details>'
        self.assertEqual(ENRICH.release_body_components(backend_only), {'backend'})
        with self.assertRaises(ENRICH.EnrichmentError):
            ENRICH.replace_component_notes(backend_only, notes)
        with self.assertRaises(ENRICH.EnrichmentError):
            ENRICH.replace_component_notes(backend_only, {'backend': (release_heading('frontend'), notes['backend'][1])})

    def test_separator_and_plain_notes_are_idempotent(self):
        """Retain the Release Please header and footer through repeated enrichments."""
        heading = release_heading('backend')
        notes = release_notes(901, 'Backend context.')
        for generated in ['### Features\n\n* Generated notes.\n', '* Generated notes.', 'Generated notes without headings.\n', '']:
            with self.subTest(generated=generated):
                single = f'Header.\n---\n\n\n{heading}\n\n{generated}\n---\nFooter.\n'
                first = ENRICH.replace_body_notes(single, heading, notes)
                for _ in range(3):
                    self.assertEqual(first, ENRICH.replace_body_notes(first, heading, notes))
                component = f'Header.\n---\n<details><summary>backend: 0.22.0</summary>\n\n{heading}\n\n{generated}\n</details>\n\n---\nFooter.\n'
                first_component = ENRICH.replace_component_notes(component, {'backend': (heading, notes)})
                for _ in range(3):
                    self.assertEqual(first_component, ENRICH.replace_component_notes(first_component, {'backend': (heading, notes)}))
                for body in [first, first_component]:
                    self.assertTrue(body.startswith('Header.\n---\n'))
                    self.assertTrue(body.endswith('\n---\nFooter.\n'))
                    self.assertEqual(body.count(heading), 1)
                    self.assertIn('Backend context.', body)
                    self.assertNotIn('Generated notes', body)
        for broken in [f'{heading}\n\nNo delimiter.\n', f'Header.\n---\n{heading}\n\nNo footer.\n',
                       f'Header.\n---\n{release_heading("frontend")}\n\n---\nFooter.\n']:
            with self.subTest(broken=broken), self.assertRaises(ENRICH.EnrichmentError):
                ENRICH.replace_body_notes(broken, heading, notes)

    def test_native_next_release_preserves_inherited_history(self):
        if NATIVE_DIRECTORY is None:
            self.skipTest('pass --native-directory after running the actual Release Please updater')
        for component, original in read_histories().items():
            next_release = (NATIVE_DIRECTORY / (component + '.md')).read_text()
            frozen = git('show', f"{AUDIT['source_commit']}:{AUDIT['targets'][component]}")
            corrected = frozen.replace(f'{component}-v0.20.0...', 'marketdesk-v0.20.0...')
            self.assertEqual(verify_baseline(next_release, corrected), '0.22.0')
            multiple = (NATIVE_DIRECTORY / (component + '-multiple.md')).read_text()
            self.assertEqual(verify_baseline(multiple, corrected), '0.23.0')
            for candidate in [next_release, multiple]:
                histories = read_histories()
                histories[component] = candidate
                verify_conservation(histories)
                baseline = corrected.split('\n\n', 1)[1].rstrip()
                bullet = next(line for line in baseline.splitlines() if line.startswith('* '))
                with self.assertRaises(AssertionError):
                    verify_baseline(candidate.replace(bullet, '', 1), corrected)
            self.assertIn(original[original.index('## [0.21.0]'):].rstrip(), next_release)
            self.assertEqual(ENRICH.source_pr_numbers(next_release, REPOSITORY), [901])
            sources = {901: source_pr('Next native release.')}
            updated, notes = ENRICH.render_changelog(next_release, REPOSITORY, sources)
            self.assertIn('Next native release.', notes)
            self.assertIn(notes, updated)
            # A rendered top section is a fixed point that no longer consults source PRs.
            self.assertEqual((updated, notes), ENRICH.render_changelog(updated, REPOSITORY, {}))
            self.assertTrue(updated.endswith(original[original.index('## [0.21.0]'):]))

    def test_prepare_workflow_respects_active_component_paths(self):
        # Unit-level GitHub transport mock; execute the real workflow preparer
        # against complete migrated files, not a second implementation.
        repository = REPOSITORY
        repo_payload = {'repo': {'full_name': repository}}
        for active in [set(AUDIT['targets']), {'backend'}]:
            with self.subTest(active=active), tempfile.TemporaryDirectory() as directory:
                checkout = Path(directory)
                for component, path in AUDIT['targets'].items():
                    target = checkout / path
                    target.parent.mkdir(parents=True, exist_ok=True)
                    history = read_histories()[component]
                    target.write_text('# Changelog\n\n' + history[history.index('## [0.21.0]'):])
                for path in ['.github/release-please/config.json', '.github/release-please/manifest.json']:
                    target = checkout / path
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text((ROOT / path).read_text())
                prs_file = checkout / 'prs.json'
                prs_file.write_text('[{"number": 900}]')
                before = {c: (checkout / p).read_text() for c, p in AUDIT['targets'].items()}
                headings = {c: ENRICH.top_section(text)[2].split('\n', 1)[0] for c, text in before.items()}
                body = '\n'.join(f'<details><summary>{c}: 0.21.0</summary>\n\n{headings[c]}\n\n### Features\nGenerated notes.\n</details>' for c in sorted(active))
                release = {'number': 900, 'state': 'open', 'head': {**repo_payload, 'ref': 'release-please--branches--main'}, 'base': {**repo_payload, 'ref': 'main', 'sha': 'b' * 40}, 'body': body}
                requested = []

                def gh_json(arguments):
                    number = int(arguments[-1].rsplit('/', 1)[1])
                    requested.append(number)
                    if number == 900:
                        return release
                    return {'number': number, 'head': repo_payload, 'base': repo_payload, 'state': 'closed', 'merged_at': '2026-10-03T00:00:00Z', 'title': 'feat(release): split streams', 'labels': [], 'body': '## Release note\nSource-specific release context.', 'merge_commit_sha': 'a' * 40}

                def run_git(arguments):
                    # The scratch checkout has no Git history: resolve the previous tag
                    # and report no hidden-type commits after it.
                    return 'c' * 40 + '\n' if arguments[0] == 'rev-parse' else ''

                with contextlib.chdir(checkout), mock.patch.object(ENRICH, '_gh_json', side_effect=gh_json), mock.patch.object(ENRICH, '_run_gh'), mock.patch.object(ENRICH, '_run_git', side_effect=run_git) as git_calls:
                    kwargs = dict(repository=repository, release_prs_file=prs_file, mode='manifest', package_path='.', config_file=Path('.github/release-please/config.json'), manifest_file=Path('.github/release-please/manifest.json'), config_backed_single=False, output_directory=checkout / 'output')
                    first = ENRICH.prepare_release_enrichment(**kwargs)
                    first_files = {c: (checkout / p).read_text() for c, p in AUDIT['targets'].items()}
                    first_requested, requested[:] = set(requested), []
                    first_body = json.loads((checkout / 'output/release-body.json').read_text())['body']
                    release['body'] = first_body
                    second = ENRICH.prepare_release_enrichment(**kwargs)
                    second_body = json.loads((checkout / 'output/release-body.json').read_text())['body']
                sources = [339, 341] if len(active) == 3 else [339]
                self.assertEqual(first, {'skipped': False, 'release_pr': 900, 'changelogs': sorted(AUDIT['targets'][c] for c in active), 'source_prs': sources, 'hidden_prs': [], 'body_changed': True})
                # Rendered changelogs are a fixed point: the rerun reads no source PR and changes nothing.
                self.assertEqual(second, {**first, 'source_prs': [], 'body_changed': False})
                self.assertEqual(first_body, second_body)
                self.assertEqual(first_requested, {900, *sources})
                self.assertEqual(set(requested), {900})
                # Hidden commits are looked up per package path, never across streams.
                scopes = sorted(call.args[0][-1] for call in git_calls.call_args_list if call.args[0][0] == 'log')
                self.assertEqual(scopes, sorted(str(Path(AUDIT['targets'][c]).parent) for c in active))
                self.assertFalse((checkout / 'CHANGELOG.md').exists())
                for c, path in AUDIT['targets'].items():
                    self.assertEqual((checkout / path).read_text(), first_files[c])
                    if c not in active:
                        self.assertEqual(first_files[c], before[c])
                    else:
                        self.assertIn('Source-specific release context.', first_files[c])
                        block = first_body.split(f'<details><summary>{c}:', 1)[1].split('</details>', 1)[0]
                        self.assertIn('Source-specific release context.', block)
                        self.assertNotIn('Generated notes.', block)
                    legacy = before[c][before[c].index('## Inherited legacy history'):]
                    self.assertTrue(first_files[c].endswith(legacy))

    def test_root_removed(self):
        self.assertFalse((ROOT / 'CHANGELOG.md').exists())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--native-directory', type=Path)
    options = parser.parse_args()
    NATIVE_DIRECTORY = options.native_directory
    unittest.main(argv=[sys.argv[0]], verbosity=2)
