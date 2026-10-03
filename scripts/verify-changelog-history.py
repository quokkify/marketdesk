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


def git(*args: str) -> str:
    return subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout


def digest(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def read_histories() -> dict[str, str]:
    return {component: (ROOT / path).read_text() for component, path in AUDIT['targets'].items()}


def verify_conservation(histories: dict[str, str]) -> None:
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
        for component, text in read_histories().items():
            original = git('show', f"{AUDIT['source_commit']}:{AUDIT['targets'][component]}")
            self.assertEqual(digest(original), AUDIT['current_sha256'][component])
            corrected = original.replace(f'{component}-v0.20.0...', 'marketdesk-v0.20.0...')
            self.assertEqual(digest(corrected), AUDIT['migrated_current_sha256'][component])
            # Future release prepends are allowed; the actual 0.21.0 remains intact.
            self.assertIn(corrected.rstrip() + '\n\n## Inherited legacy history', text)
        manifest = json.loads((ROOT / '.github/release-please/manifest.json').read_text())
        self.assertEqual(set(manifest), {'src/backend', 'src/frontend', 'public'})
        for version in manifest.values():
            self.assertGreaterEqual(tuple(map(int, version.split('.'))), (0, 21, 0))

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
            self.assertEqual(ENRICH.source_pr_numbers(text, 'quokkify/marketdesk'), [339] if component == 'backend' else [341])
            legacy = text[text.index('## Inherited legacy history'):]
            prs = [{'number': 311, 'body': '## Highlight\nDo not resurrect inherited highlights.'}] if component in AUDIT['rich_assignments'] else []
            prs.append({'number': 341, 'body': '## Highlight\nCurrent stream only.'})
            updated = ENRICH.enrich_changelog(text, prs)
            self.assertTrue(updated.endswith(legacy))
            self.assertEqual(updated, ENRICH.enrich_changelog(updated, prs))
            self.assertNotIn('Do not resurrect', updated)

    def test_multi_component_lifecycle_and_inactive_stream(self):
        prs = {c: [{'number': n, 'body': '## Highlight\n' + c + ' only.'}] for c, n in [('backend', 901), ('frontend', 902), ('assets', 903)]}
        body = 'Release Please generated header\n\n' + '\n'.join(f'<details><summary>{c}: 0.22.0</summary>\n\n### Features\n\nGenerated {c} notes.\n</details>' for c in prs)
        rich = {c: ENRICH._render_entries(p, set()) for c, p in prs.items()}
        updated = ENRICH.enrich_component_release_body(body, rich)
        self.assertEqual(updated, ENRICH.enrich_component_release_body(updated, rich))
        for c in prs:
            notes = updated.split(f'<details><summary>{c}:', 1)[1].split('</details>', 1)[0]
            self.assertIn(c + ' only.', notes)
            for other in set(prs) - {c}:
                self.assertNotIn(other + ' only.', notes)
        self.assertEqual(ENRICH.release_body_components('<details><summary>backend: 0.22.0</summary>\n</details>'), {'backend'})

    def test_native_next_release_preserves_inherited_history(self):
        if NATIVE_DIRECTORY is None:
            self.skipTest('pass --native-directory after running the actual Release Please updater')
        for component, original in read_histories().items():
            next_release = (NATIVE_DIRECTORY / (component + '.md')).read_text()
            self.assertIn(original[original.index('## [0.21.0]'):].rstrip(), next_release)
            self.assertEqual(ENRICH.source_pr_numbers(next_release, 'quokkify/marketdesk'), [901])
            updated = ENRICH.enrich_changelog(next_release, [{'number': 901, 'body': '## Highlight\nNext native release.'}])
            self.assertIn('Next native release.', updated)
            self.assertEqual(updated, ENRICH.enrich_changelog(updated, [{'number': 901, 'body': '## Highlight\nNext native release.'}]))
            self.assertTrue(updated.endswith(original[original.index('## [0.21.0]'):]))

    def test_prepare_workflow_respects_active_component_paths(self):
        # Unit-level GitHub transport mock; execute the real workflow preparer
        # against complete migrated files, not a second implementation.
        repository = 'quokkify/marketdesk'
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
                body = '\n'.join(f'<details><summary>{c}: 0.21.0</summary>\n\n### Features\nGenerated notes.\n</details>' for c in sorted(active))
                release = {'number': 900, 'head': repo_payload, 'base': repo_payload, 'body': body}
                requested = []

                def gh_json(arguments):
                    number = int(arguments[-1].rsplit('/', 1)[1])
                    requested.append(number)
                    if number == 900:
                        return release
                    return {'number': number, 'head': repo_payload, 'base': repo_payload, 'state': 'closed', 'merged_at': '2026-10-03T00:00:00Z', 'body': '## Highlight\nSource-specific release context.', 'merge_commit_sha': 'a' * 40}

                before = {c: (checkout / p).read_text() for c, p in AUDIT['targets'].items()}
                with contextlib.chdir(checkout), mock.patch.object(ENRICH, '_gh_json', side_effect=gh_json), mock.patch.object(ENRICH, '_run_gh'):
                    kwargs = dict(repository=repository, release_prs_file=prs_file, mode='manifest', package_path='.', config_file=Path('.github/release-please/config.json'), manifest_file=Path('.github/release-please/manifest.json'), config_backed_single=False, output_directory=checkout / 'output')
                    first = ENRICH.prepare_release_enrichment(**kwargs)
                    first_files = {c: (checkout / p).read_text() for c, p in AUDIT['targets'].items()}
                    release['body'] = json.loads((checkout / 'output/release-body.json').read_text())['body']
                    second = ENRICH.prepare_release_enrichment(**kwargs)
                self.assertEqual(first, second)
                self.assertEqual(first['changelogs'], sorted(AUDIT['targets'][c] for c in active))
                self.assertEqual(set(requested), {900, 339, 341} if len(active) == 3 else {900, 339})
                self.assertFalse((checkout / 'CHANGELOG.md').exists())
                for c, path in AUDIT['targets'].items():
                    self.assertEqual((checkout / path).read_text(), first_files[c])
                    if c not in active:
                        self.assertEqual(first_files[c], before[c])
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
