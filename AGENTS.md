# AGENTS.md

Guidance for AI coding agents and new maintainers. It summarizes the rules and links to the docs that hold the details; when they disagree, the linked doc wins, so update both.

## What this repo is

Public, [MIT](LICENSE). It creates booth demo repos from [`config.json`](config.json):

- [`create-repo.sh`](create-repo.sh) and [`create-repo.ps1`](create-repo.ps1) read `config.json` and create a demo (repo from a template, plus branches, issues, PRs, security features, Codespaces). See [README: Bash](README.md#bash), [PowerShell](README.md#powershell), and [Workflows and config fields](README.md#workflows-and-config-fields).
- [`.github/extensions/demo-launcher/`](.github/extensions/demo-launcher/): the **Demo Launcher** canvas extension for the GitHub Copilot app. It runs `create-repo` in the background and parses its output. Docs: [README: Demo Launcher canvas](README.md#demo-launcher-canvas).
- [`.github/extensions/demo-launcher-loader/`](.github/extensions/demo-launcher-loader/): the user-level loader, installable from a URL or written by `install.sh`. Docs: [loader README](.github/extensions/demo-launcher-loader/README.md).
- [`resources/<demo>/`](resources/): per-demo PR contents, seeds, seed prompts, and presenter answer keys (`ANSWER_KEY.md`, never copied into demo repos).
- [`templates/booth-bingo/`](templates/booth-bingo/): source for the [`octobooth/booth-bingo`](https://github.com/octobooth/booth-bingo) template repo.
- ChatOps: [`new-demo.yml`](.github/workflows/new-demo.yml) and [`cleanup-demos.yml`](.github/workflows/cleanup-demos.yml). See [README: ChatOps](README.md#chatops).

Running it outside `octobooth`: [docs/run-in-your-own-org.md](docs/run-in-your-own-org.md).

## Branches and releases

Current migration state: [README: Releases](README.md#releases). The [destination release process](docs/releasing.md) describes future publication after separate authorization and paired Mac/Windows validation; it does not imply a migration-ready release exists.

- The destination migration updates `main` only. CI is enabled; New demo and Clean up demos remain disabled. Run available checks locally as well, and do not dispatch duplicate CI or enable ChatOps as a validation shortcut.
- Existing `v1` and immutable version tags retain historical source-oriented content. Do not treat them as migrated destination releases or move them as part of this migration.
- No destination release or assets are published by this change. Machine rollout and paired release testing with [machine-setup](https://github.com/octobooth/machine-setup) require separate approval.
- Never move or delete a pushed `vX.Y.Z` tag.
- **Agents:** don't create, move, or delete tags, or publish GitHub Releases, unless a maintainer explicitly asks.

## Change rules

- **Keep `create-repo.sh` and `create-repo.ps1` in parity:** same flags (`--no-clone` / `-NoClone`), same behavior, and the same output lines. The launcher parses that output (`parseLine` in [`extension.mjs`](.github/extensions/demo-launcher/extension.mjs)), so update it when output changes.
- **Windows PowerShell 5.1:** `create-repo.ps1` is `#Requires -Version 5.1`. No PowerShell 7-only syntax (`??`, `?.`, ternaries, `&&`/`||` pipeline chains, `ForEach-Object -Parallel`). Run git and `gh` through `Invoke-Native` (throws on a non-zero exit code) or `Invoke-GhQuiet` (hides stderr without 5.1 turning it into a terminating error), and follow the existing comments about quoting native arguments.
- **Tests and CI in the same PR:** update [`tests/`](tests/) for behavior changes. `config.json` schema changes (new fields, workflows, or referenced files) need matching updates to the `validate-config` job in [`ci.yml`](.github/workflows/ci.yml); new `new-demo.yml` template options must be `config.json` keys.
- **Docs in the same PR as behavior:** README, [docs/](docs/), and the loader README.
- Booth machines run the launcher on macOS and Windows; test both when a change is platform-sensitive.

## Intentional vulnerabilities: don't fix them

The demos exist to show security tools finding problems. These are **planted on purpose**:

- [`resources/ai-security/`](resources/ai-security/) (seed and `pr-infra`): SSRF, insecure scripts, hard-coded AWS example keys, and more. See its [answer key](resources/ai-security/ANSWER_KEY.md).
- [`resources/security-octo-supply-v4/`](resources/security-octo-supply-v4/): path traversal, intentional code-quality issues, and the vulnerable PHP app ([README](README.md#security-supply-chain-v4)).
- [`resources/octocart/`](resources/octocart/): issues for Copilot code review to find ([answer key](resources/octocart/ANSWER_KEY.md)).
- The template repos `security-octo-supply-v4` and `security-octo-supply`.

Any credentials there are fake or public example values. Never fix, remove, or "harden" them, and don't add suppressions. Close Copilot Autofix, agentic-autofix, and Dependabot PRs that would. Example: [#26](https://github.com/octobooth-demos/repo-setup-scripts/pull/26) (SSRF fix in the AI Security seed) was closed for this reason. If a planted issue changes on purpose, update its answer key and README section too.

## Templates

Template repos can't be pinned: GitHub always creates repos from a template's default branch, so a merged template change reaches every new demo on every machine immediately, with no release. Test it in the template repo's PR, then create one demo from it with the launcher right after merging. See [What booth machines need for each kind of change](docs/releasing.md#what-booth-machines-need-for-each-kind-of-change).

## Where repos go

Only `security-octo-supply-v4` and `ai-security` (`"owner": "org"`) create repos in the `octobooth` org; every other demo uses the signed-in `gh` account, unless `--owner` / `-Owner` is passed. ChatOps targets the org but remains disabled during migration. Template access varies by repository; do not assume every template is public. See [README: Where repos are created](README.md#where-repos-are-created).

Booth machines use the booth account for both the Copilot app and `gh`. Never sign in with personal or staff accounts on booth machines.

## Testing changes

Run what CI runs ([`ci.yml`](.github/workflows/ci.yml) is the source of truth; see also [README: Local checks](README.md#local-checks)). None of these touch GitHub:

```bash
bash -n create-repo.sh && bash -n .github/extensions/demo-launcher/install.sh
shellcheck --severity=warning -x create-repo.sh .github/extensions/demo-launcher/install.sh
bash create-repo.sh --help > /dev/null
for f in .github/extensions/demo-launcher/*.mjs .github/extensions/demo-launcher-loader/*.mjs; do node --check "$f"; done
node --test tests/run-store.test.mjs tests/demo-launcher.test.mjs tests/demo-launcher-loader.test.mjs
pwsh -NoProfile -File tests/create-repo.Tests.ps1
pwsh -NoProfile -Command "if (Invoke-ScriptAnalyzer -Path ./create-repo.ps1 -Settings ./PSScriptAnalyzerSettings.psd1) { exit 1 }"
```

CI also parses `create-repo.ps1` with the PowerShell parser and validates `config.json` with `jq`; copy those steps from `ci.yml` to run them locally.

End to end (creates a real repo in the signed-in account, or the org for org-pinned demos):

```bash
DEMO_NO_BROWSER=1 bash create-repo.sh --template <key> --no-clone
```

Live demos and cleanup are not migration validation; run them only when separately authorized. Every demo repo gets the `demo-generated` topic, and `create-repo.sh --cleanup` / `-Cleanup` deletes those older than 72 hours (always `--dry-run` first). `--all` or `--older-than 0` deletes **every** demo the owner has, including ones in use, so don't run them on `octobooth` or a booth account during an event. See [README: Cleaning up](README.md#cleaning-up).

## Launcher gotchas

- Install the loader **one** way per machine: the script (`install.sh`, booth machines) or the URL install, never both. See [Don't install both](README.md#dont-install-both).
- Sessions in this project load the launcher from their own checkout. A **New worktree** session keeps a frozen copy on its own branch and never picks up `git pull`; use **Current checkout** to run the latest.
- Restart the Copilot app (or reload extensions) to load launcher changes. Re-run `install.sh` (or machine-setup's `install-demo-launcher`) only when the loader or `install.sh` changes.
