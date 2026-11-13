# Releasing

> [!IMPORTANT]
> This is the destination release procedure for [octobooth/repo-setup-scripts](https://github.com/octobooth/repo-setup-scripts) and [octobooth/machine-setup](https://github.com/octobooth/machine-setup). Publication and machine rollout require separate authorization; the migration changes `main` only and does not publish a migration-ready `v1`, release, or assets. Existing tags retain their original source-oriented content until a separately approved release updates the matching major tag; immutable version tags must never be rewritten. The source organization remains read-only. CI is enabled on this destination, but New demo and Clean up demos remain disabled. See [the current migration state](../README.md#releases).

## Destination release process

Releases use semantic version tags, with the **same version on both** this repo and [octobooth/machine-setup](https://github.com/octobooth/machine-setup):

- Each tested release gets a full tag, `vX.Y.Z` (for example `v1.0.0`).
- For an approved release, move the matching major tag (`v1` for `v1.x.y`) to the tested commit, like GitHub Actions' major tags. Booth machines can then use that approved major tag. A pre-existing tag name alone is not evidence that the destination migration was tested or released.
- Bump the major (`v2`) only for breaking changes, for example new manual setup steps, changed paths, or new required `gh` scopes. Otherwise bump the minor for new demos or features and the patch for fixes.

See [Releases](../README.md#releases) for how booth machines use the tags.

## Migration release acceptance

For the organization migration, hosted CI and remote verification replace the physical-machine validation in step 4 of [Making a change](#making-a-change) and step 1 of [Cutting a release](#cutting-a-release). Local software installation, booth setup execution, VM work, physical Mac/Windows pilots, and machine cutover are not migration requirements. Normal repository editing and Git/API operations can run in local sessions; no substitute test environment is needed.

1. Record the exact candidate SHA for each destination repository and successful hosted CI runs for those SHAs, including the machine-setup Windows PowerShell 5.1 job. Existing evidence: [machine-setup CI at 978e3d7](https://github.com/octobooth/machine-setup/actions/runs/43483575581) and [launcher CI at 0487cb0](https://github.com/octobooth/repo-setup-scripts/actions/runs/43489813453). If a candidate changes, use the completed CI result for the new SHA rather than assuming an earlier run covers it.
2. Verify destination refs and the exact candidate commits remotely. Before authorized publication, confirm the proposed immutable version is unused in both repositories. After publication, verify the paired version tags, matching major tags, and GitHub Releases resolve to the recorded commits. Never rewrite a published immutable version.
3. Verify that the Playwright version pinned by the machine-setup candidate has both its archive and checksum available from the destination release URLs, and that the archive matches the checksum. For version 0.0.83, use the [destination bundle release](https://github.com/octobooth/machine-setup/releases/tag/playwright-mcp-v0.0.83). A Git tag or successful setup exit code alone is not asset verification.
4. Record the CI links, candidate SHAs, and remote ref/release/asset results. Describe this as automated and remote acceptance, not a physical-machine test. Keep separately unresolved demo or integration findings explicit; they are not silently satisfied by CI.

Release/tag writes still require their existing explicit authorization. The future operator setup and rollout instructions below remain available, but running them is not a gate for completing this migration.

## Making a change

How a change gets from a PR to the booth machines after release work is authorized. Machines pinned to a release tag do not pick up a `main` merge; they need the approved tag and an explicit update. The commands for steps 4 to 7 are in [Cutting a release](#cutting-a-release). Do not use the historical `v1` as the migration-ready release.

1. **Open a PR to `main`** in this repo or machine-setup.
2. **Wait for CI and Copilot code review**, and fix what they find.
3. **Merge.** `main` now contains the candidate change. Machines pinned to a release tag aren't affected.
4. **Validate and record the candidate commits.** For this migration, use [Migration release acceptance](#migration-release-acceptance); do not run booth setup or pilots. For normal future releases with separately authorized machine testing, test `main` on a booth Mac and a Windows machine ([step 1](#cutting-a-release)): clear `BOOTH_RELEASE`, put both checkouts on `main`, run machine-setup's `install-demo-launcher` **without** a ref, run the demos, and record both commit IDs. You can batch several merged PRs into one release.
5. **Tag both repos at the tested commits** ([step 2](#cutting-a-release)), with the same version, even if only one repo changed, so the versions stay paired. Bump the patch (`v1.0.x`) for fixes and the minor (`v1.x.0`) for new demos or features.
6. **Move the matching major tag** to the same commits ([step 3](#cutting-a-release)).
7. **Create the GitHub Releases** on both repos with `--generate-notes --verify-tag` ([step 4](#cutting-a-release)).
8. **For a separately authorized operator rollout, update the booth machines:** verify destination remotes, fetch and check out the approved major tag in machine-setup, run `install-demo-launcher --ref <major>` (`-Ref <major>` on Windows) with the same tag, verify both installed commits match the release record, and restart the Copilot app. See [Update a booth machine](../README.md#update-a-booth-machine). Never update by checking out a tag alone when the loader or setup changed. This rollout is outside the migration acceptance scope.

Steps 5 to 7 in one block, run only after release authorization from destination clones where you can push to both repos (not necessarily the booth machine). Fill in an unused version, its matching major, and the two commit IDs you recorded in step 4. The example version below is not a claim that it is available or migration-ready:

```bash
VERSION=v1.0.1                 # the new version
MAJOR=v1                       # its major: v1 for any v1.x.y
BRANCH=main                    # or release/vN for a hotfix on an older major
LATEST=true                    # false for a hotfix on an older major, so it doesn't become "Latest"
MS=~/repos/machine-setup       # clone of octobooth/machine-setup
RSS=~/repos/repo-setup-scripts # clone of octobooth/repo-setup-scripts
MS_SHA=PASTE_MACHINE_SETUP_SHA     # recorded in step 4
RSS_SHA=PASTE_REPO_SETUP_SCRIPTS_SHA # recorded in step 4

test "$(git -C "$MS" remote get-url origin)" = "https://github.com/octobooth/machine-setup.git" &&
test "$(git -C "$MS" remote get-url --push origin)" = "https://github.com/octobooth/machine-setup.git" &&
test "$(git -C "$RSS" remote get-url origin)" = "https://github.com/octobooth/repo-setup-scripts.git" &&
test "$(git -C "$RSS" remote get-url --push origin)" = "https://github.com/octobooth/repo-setup-scripts.git" &&
git -C "$MS" fetch origin --tags --force &&
git -C "$RSS" fetch origin --tags --force &&
git -C "$MS" merge-base --is-ancestor "$MS_SHA" "origin/$BRANCH" &&
git -C "$RSS" merge-base --is-ancestor "$RSS_SHA" "origin/$BRANCH" &&
git -C "$MS" tag -a "$VERSION" "$MS_SHA" -m "$VERSION" &&
git -C "$RSS" tag -a "$VERSION" "$RSS_SHA" -m "$VERSION" &&
git -C "$MS" tag -fa "$MAJOR" "$MS_SHA" -m "$MAJOR -> $VERSION" &&
git -C "$RSS" tag -fa "$MAJOR" "$RSS_SHA" -m "$MAJOR -> $VERSION" &&
git -C "$MS" push origin "$VERSION" &&
git -C "$RSS" push origin "$VERSION" &&
git -C "$MS" push origin "$MAJOR" --force &&
git -C "$RSS" push origin "$MAJOR" --force &&
gh release create "$VERSION" -R octobooth/machine-setup --generate-notes --verify-tag --latest="$LATEST" &&
gh release create "$VERSION" -R octobooth/repo-setup-scripts --generate-notes --verify-tag --latest="$LATEST"
```

The remote checks stop this HTTPS-clone example from publishing to the source organization or a fork. The `merge-base` check stops if a commit isn't on the branch you tested. Nothing is pushed until both repos are checked and tagged locally. If a later step fails, inspect the remote state before resuming; `git tag -a` refuses to overwrite a `vX.Y.Z` tag that already exists. Never move or delete a pushed `vX.Y.Z` tag. The major-tag updates shown here are future release operations, not part of migration.

### What booth machines need for each kind of change

| Change | On booth machines |
| --- | --- |
| Demo Launcher, `config.json`, or `create-repo` scripts | The approved major-tag update in step 8. |
| Loader (`.github/extensions/demo-launcher-loader/`) or `install.sh` | The same update. It reinstalls the loader, because `install-demo-launcher` always re-runs `install.sh`. Say so in the release notes, and don't update by hand with `git checkout` alone. |
| machine-setup's `config.json` or `setup` scripts (new apps, extensions, or repos) | The approved major-tag update, then `setup` again with the same release (`bash setup.sh --ref <major>` or `.\setup.ps1 -Ref <major>`). See machine-setup's [booth playbook](https://github.com/octobooth/machine-setup/blob/main/docs/booth-playbook.md). |
| A template repo | Nothing, and no release. Templates can't be pinned, so a merged template change reaches every new demo right away, on every machine. Test it in the template repo's PR before merging, then create one demo from it right after merging. |

### When to bump to `v2`

Only for breaking changes: anything a booth machine can't pick up from the `v1` update in step 8, such as new manual setup steps, changed paths, or new required `gh` scopes. Tag `v2.0.0` and create a new `v2` tag; never move `v1` to a `v2.x.y` commit. Machines stay on `v1` until you update each one to `v2` (with `--ref v2`) and do its manual steps, and `v1` can still get hotfixes ([step 5](#cutting-a-release)).

## Cutting a release

1. **Validate the candidate commits.** For this migration, complete [Migration release acceptance](#migration-release-acceptance), record both exact SHAs, and proceed to step 2 without executing the machine instructions below. For normal future releases with separately authorized machine testing, apply machine-setup as follows. The candidate is `main` of both destination repos, or a `release/vN` branch for a hotfix (step 5). Before running any update or publication commands, verify each checkout's fetch and push `origin` points to its `octobooth` destination, as in the checks above. Use clean checkouts; do not overwrite local work. On a booth Mac and a Windows machine:

   1. Make sure no release is set, so the installer doesn't pin an older tag: `unset BOOTH_RELEASE` (macOS) or `Remove-Item Env:BOOTH_RELEASE -ErrorAction SilentlyContinue` (Windows).
   2. Put both checkouts on the candidate branch and update them:

      ```bash
      git -C ~/repos/machine-setup checkout main && git -C ~/repos/machine-setup pull --ff-only
      git -C ~/repos/repo-setup-scripts checkout main && git -C ~/repos/repo-setup-scripts pull --ff-only
      ```

   3. From `~/repos/machine-setup`, run `install-demo-launcher` **without** `--ref` / `-Ref` (and the full `setup` script if `setup` changed since the last release). Without a release it keeps the branch you checked out, so it installs the loader from the candidate. Updating a checkout alone doesn't apply machine-setup's changes, so don't skip this.
   4. Record both candidate commits:

      ```bash
      git -C ~/repos/machine-setup rev-parse HEAD
      git -C ~/repos/repo-setup-scripts rev-parse HEAD
      ```

   5. Restart the Copilot app and, as separately authorized release validation, run these from the Demo Launcher: `security-octo-supply-v4`, `ai-security`, and one demo that creates its repo in the booth account (for example `booth-bingo`). Confirm destination template/reusable-workflow access and required security features for the booth account. Do not enable ChatOps or scheduled cleanup for this check.
   6. Run the two `rev-parse` commands again. If either changed, or differs between the Mac and Windows machine, start over with the new commits.

2. **Tag the recorded commits, with the same version on both repos.** In each verified destination checkout, tag the exact SHA from step 1, not whatever the branch points at now. Verify that commit is on the tested branch before tagging:

   ```bash
   git fetch origin --tags --force &&
   git merge-base --is-ancestor <recorded-sha> origin/<tested-branch> &&
   git tag -a vX.Y.Z <recorded-sha> -m "vX.Y.Z" &&
   git push origin vX.Y.Z
   ```

3. **Move the matching major tag on both repos** to the same recorded commit. Use the release's own major: `vX` for `vX.Y.Z` (`v1` for `v1.4.2`, `v2` for `v2.0.0`). Never move `v1` to a `v2.x.y` commit; a new major gets a new major tag, and machines on `v1` stay there until you move them to `v2`.

   ```bash
   git tag -fa vX <recorded-sha> -m "vX.Y.Z"
   git push origin vX --force
   ```

   Booth machines on `vX` pick it up the next time they update (see [Update a booth machine](../README.md#update-a-booth-machine)).
4. **Create the GitHub Release on both destination repos**, from the pushed matching version tag:

   ```bash
   gh release create vX.Y.Z -R octobooth/machine-setup --generate-notes --verify-tag
   gh release create vX.Y.Z -R octobooth/repo-setup-scripts --generate-notes --verify-tag
   ```

   `--verify-tag` stops if the tag isn't on GitHub, instead of creating it from the default branch. If the release changes the loader (`.github/extensions/demo-launcher-loader/`) or `install.sh`, add `--notes "Booth machines must re-run install-demo-launcher after updating."` (it goes above the generated notes).
5. **Hotfix:** patch the major that booth machines use. If `main` is still on that major, fix it on `main` with a normal PR. If `main` has moved to a newer major, create `release/vN` from the latest tag of that major in **both** repos (`git switch -c release/v1 v1.x.y && git push -u origin release/v1`) and fix it there with a PR into that branch. Machine-setup's `--ref` only accepts tags, so test the candidate by checking out `release/vN` instead of `main` in step 1.2 (in both checkouts) and running the installer without a ref. Then tag the next patch (`vX.Y.Z+1`) on **both** repos, even if only one changed, and move that major's tag. If a newer major exists, create its Release with `--latest=false`.

Never move or delete a full `vX.Y.Z` tag; cut a new one instead. Only the major tag moves.

Templates can't be pinned: GitHub always creates repos from a template's default branch. Template changes are guarded by their PR CI. For normal future releases, the separately authorized machine tests in step 1 check the current templates; migration acceptance uses the hosted and remote evidence above without claiming live demo execution.
