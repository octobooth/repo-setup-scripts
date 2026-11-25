import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

function run(args, failure = false) {
    const dir = mkdtempSync(join(tmpdir(), "cleanup-entrypoint-"));
    try {
        writeFileSync(join(dir, "gh"), `#!/bin/bash
printf '%s\\n' "$*" >> "$CALLS"
case "$*" in
  "auth status") exit 0 ;;
  "api user --jq .login") echo demo-user ;;
  *) echo "Unexpected gh call: $*" >&2; exit 99 ;;
esac
`, { mode: 0o755 });
        writeFileSync(join(dir, "node"), `#!/bin/bash
printf '%s\\n' "$@" > "$NODE_ARGS"
echo "Retained demo-user/demo: Missing exact event association."
exit ${failure ? 1 : 0}
`, { mode: 0o755 });
        const calls = join(dir, "calls");
        const nodeArgs = join(dir, "node-args");
        writeFileSync(calls, "");
        writeFileSync(nodeArgs, "");
        const result = spawnSync("bash", [join(root, "create-repo.sh"), ...args], {
            env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CALLS: calls, NODE_ARGS: nodeArgs },
            encoding: "utf8", timeout: 10000,
        });
        return { ...result, calls: readFileSync(calls, "utf8"), nodeArgs: readFileSync(nodeArgs, "utf8").trim().split("\n") };
    } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("Bash cleanup delegates read-only preview to account control repo", () => {
    const result = run(["--cleanup"]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.nodeArgs.includes("demo-user/demo-cleanup"));
    assert.ok(!result.nodeArgs.includes("--execute"));
    assert.match(result.stdout, /Retained demo-user\/demo/);
    assert.doesNotMatch(result.calls, /repo delete/);
});

test("Bash preview accepts explicit scope and octobooth control default", () => {
    const explicit = run(["--cleanup", "--owner", "some-org", "--control-repo", "some-org/control", "--event", "conference", "--dry-run"]);
    assert.equal(explicit.status, 0, explicit.stderr);
    assert.deepEqual(explicit.nodeArgs.slice(1), ["--control-repo", "some-org/control", "--owner", "some-org", "--event", "conference"]);
    assert.ok(run(["--cleanup", "--owner", "Octobooth"]).nodeArgs.includes("octobooth/repo-setup-scripts"));
});

test("Bash rejects age/all/yes bypasses before any API or engine call", () => {
    for (const flags of [["--all"], ["--older-than", "0"], ["--yes"]]) {
        const result = run(["--cleanup", ...flags]);
        assert.notEqual(result.status, 0);
        assert.match(result.stdout, /not supported.*preview-only/);
        assert.equal(result.calls, "");
        assert.deepEqual(result.nodeArgs, [""]);
    }
});

test("Bash propagates shared engine API/metadata failures", () => {
    assert.notEqual(run(["--cleanup"], true).status, 0);
});

function workflowOptions(env) {
    const workflow = readFileSync(join(root, ".github/workflows/cleanup-demos.yml"), "utf8");
    const script = workflow.split("        run: |\n")[1].split("\n      - name:")[0].split("\n").map((line) => line.slice(10)).join("\n");
    const dir = mkdtempSync(join(tmpdir(), "cleanup-options-"));
    try {
        const output = join(dir, "output");
        writeFileSync(output, "");
        const result = spawnSync("bash", ["-e", "-c", script], {
            env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, ...env }, encoding: "utf8", timeout: 10000,
        });
        return { ...result, output: readFileSync(output, "utf8") };
    } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("workflow manual/comments default to preview and preserve event scope", () => {
    const manual = workflowOptions({ EVENT_NAME: "workflow_dispatch", INPUT_EVENT: "conference" });
    assert.equal(manual.status, 0, manual.stderr);
    assert.match(manual.output, /event=conference\ndry_run=true/);
    const comment = workflowOptions({ EVENT_NAME: "issue_comment", COMMENT_BODY: "/cleanup --event conference" });
    assert.equal(comment.status, 0, comment.stderr);
    assert.match(comment.output, /event=conference\ndry_run=true/);
    const execute = workflowOptions({ EVENT_NAME: "issue_comment", COMMENT_BODY: "/cleanup --event conference --confirm" });
    assert.match(execute.output, /event=conference\ndry_run=false/);
    assert.match(workflowOptions({ EVENT_NAME: "schedule" }).output, /dry_run=false/);
});

test("workflow rejects age/all and malformed event inputs", () => {
    for (const body of ["/cleanup --all --confirm", "/cleanup 0", "/cleanup 72", "/cleanup --older-than 1", "/cleanup --event", "/cleanup --event ../other"]) {
        const result = workflowOptions({ EVENT_NAME: "issue_comment", COMMENT_BODY: body });
        assert.notEqual(result.status, 0, body);
        assert.doesNotMatch(result.output, /run=true/);
    }
    assert.match(workflowOptions({ EVENT_NAME: "issue_comment", COMMENT_BODY: "/cleanup-other --confirm" }).output, /run=false/);
    assert.notEqual(workflowOptions({ EVENT_NAME: "workflow_dispatch", INPUT_EVENT: "conf\ninjected=true" }).status, 0);
});
