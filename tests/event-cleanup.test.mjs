import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanup, parseArgs, validateManifest } from "../scripts/event-cleanup.mjs";

const SHA = "a".repeat(40);
const BOUNDARY = Date.parse("2026-01-08T00:00:00Z");
function fixture() {
    const repo = { id: 1, name: "demo", full_name: "octobooth/demo", owner: { login: "octobooth" }, topics: ["demo-generated"], created_at: "2025-12-01T00:00:00Z" };
    const manifest = { schema_version: 1, events: [{ id: "conference", ends_at: "2026-01-01T00:00:00Z", repositories: [{ id: 1, full_name: repo.full_name }], review_pr: 10 }] };
    const control = { id: 90, full_name: "octobooth/control", default_branch: "main" };
    const pr = { merged_at: "2026-01-08T00:00:00Z", base: { ref: "main", repo: control }, head: { sha: SHA } };
    const state = {
        repo, manifest, control, pr, inventory: [repo], text: null, headText: null, variable: "reviewer",
        reviews: [{ id: 1, user: { login: "reviewer" }, state: "APPROVED", commit_id: SHA, submitted_at: "2026-01-08T00:00:00Z" }],
        permission: "write", calls: [], intercept: null,
    };
    function api(path, options = {}) {
        state.calls.push({ path, ...options });
        if (state.intercept) state.intercept(path, options);
        if (options.method === "DELETE") return null;
        if (path === "users/octobooth") return { type: "Organization" };
        if (path === "orgs/octobooth/repos?per_page=100") return structuredClone(state.inventory);
        if (path === "repos/octobooth/control") return state.control;
        if (path === "repos/octobooth/control/actions/variables/CLEANUP_REVIEWERS") return { value: state.variable };
        if (path === "repos/octobooth/control/pulls/10") return state.pr;
        if (path === "repos/octobooth/control/pulls/10/reviews?per_page=100") return state.reviews;
        if (path === "repos/octobooth/control/collaborators/reviewer/permission") return { permission: state.permission };
        if (path.startsWith("repos/octobooth/control/contents/cleanup-events.json?ref=")) {
            const text = path.endsWith(SHA) ? state.headText ?? state.text : state.text;
            return { encoding: "base64", content: Buffer.from(text ?? JSON.stringify(state.manifest)).toString("base64") };
        }
        if (path === "repos/octobooth/demo") return state.repo;
        throw new Error(`Unexpected API request: ${path}`);
    }
    return { state, run: (options = {}) => cleanup({ controlRepo: control.full_name, owner: "octobooth", now: () => BOUNDARY, api, ...options }) };
}
const deletes = (state) => state.calls.filter((c) => c.method === "DELETE");

test("exact seven-day boundary permits reviewed scope; one millisecond earlier retains", () => {
    const { state, run } = fixture();
    assert.equal(run({ now: () => BOUNDARY - 1, execute: true }).retained.length, 1);
    assert.equal(deletes(state).length, 0);
    assert.deepEqual(run({ execute: true }).deleted, ["octobooth/demo"]);
    assert.equal(deletes(state).length, 1);
});

test("preview never deletes and exposes both eligible and missing associations", () => {
    const { state, run } = fixture();
    state.inventory.push({ ...state.repo, id: 2, full_name: "octobooth/unassigned" });
    const result = run();
    assert.equal(result.eligible.length, 1);
    assert.match(result.retained[0].reason, /Missing exact event association/);
    assert.equal(deletes(state).length, 0);
});

for (const [label, change] of [
    ["missing reviewer designation", (s) => { s.variable = ""; }],
    ["invalid event end", (s) => { s.manifest.events[0].ends_at = "2026-02-30T00:00:00Z"; }],
    ["missing event id", (s) => { delete s.manifest.events[0].id; }],
    ["missing approval", (s) => { s.reviews = []; }],
    ["review before retention boundary", (s) => { s.reviews[0].submitted_at = "2026-01-07T23:59:59Z"; }],
    ["future approval", (s) => { s.reviews[0].submitted_at = "2026-01-09T00:00:00Z"; }],
    ["stale approval head", (s) => { s.reviews[0].commit_id = "b".repeat(40); }],
    ["changed manifest bytes", (s) => { s.headText = JSON.stringify(s.manifest) + "\n"; }],
    ["unmerged review PR", (s) => { s.pr.merged_at = null; }],
    ["wrong PR base", (s) => { s.pr.base.ref = "other"; }],
    ["reviewer no longer authorized", (s) => { s.permission = "read"; }],
    ["non-designated approver", (s) => { s.reviews[0].user.login = "other"; }],
    ["dismissed latest review", (s) => { s.reviews.push({ ...s.reviews[0], id: 2, state: "DISMISSED" }); }],
    ["later requested changes", (s) => { s.reviews.push({ ...s.reviews[0], id: 2, state: "CHANGES_REQUESTED" }); }],
    ["overlapping event reuse", (s) => { s.manifest.events.push({ ...s.manifest.events[0], id: "next-event" }); }],
    ["case-insensitive overlapping name", (s) => { s.manifest.events[0].repositories.push({ id: 2, full_name: "Octobooth/Demo" }); }],
    ["recreated repo", (s) => { s.repo.id = 2; }],
]) {
    test(`${label} retains resources`, () => {
        const { state, run } = fixture();
        change(state);
        const result = run({ execute: true });
        assert.equal(result.deleted.length, 0);
        assert.equal(deletes(state).length, 0);
        assert.equal(result.retained.length, 1);
    });
}

test("owner, topic and control-repository restrictions exclude unrelated resources", () => {
    const { state, run } = fixture();
    state.inventory = [
        { ...state.repo, owner: { login: "other" }, full_name: "other/demo" },
        { ...state.repo, topics: [] },
        { ...state.repo, name: "demo-cleanup", full_name: "octobooth/demo-cleanup" },
        { ...state.repo, name: "control", full_name: "octobooth/control" },
    ];
    const result = run({ execute: true });
    assert.equal(result.deleted.length, 0);
    assert.equal(result.retained.length, 2);
    assert.ok(result.retained.every((r) => /protected/.test(r.reason)));
});

for (const [label, change] of [
    ["revoked approval", (s) => { s.reviews = []; }],
    ["removed reviewer designation", (s) => { s.variable = ""; }],
    ["event reassignment", (s) => { s.manifest.events[0].ends_at = "2026-02-01T00:00:00Z"; }],
    ["owner transfer", (s) => { s.repo = { ...s.repo, owner: { login: "other" } }; }],
    ["replacement identity", (s) => { s.repo = { ...s.repo, id: 999 }; }],
    ["removed topic", (s) => { s.repo = { ...s.repo, topics: [] }; }],
]) {
    test(`revalidates ${label} immediately before deletion`, () => {
        const { state, run } = fixture();
        let snapshots = 0;
        state.intercept = (path) => {
            if (path === "repos/octobooth/control" && ++snapshots === 2) change(state);
        };
        const result = run({ execute: true });
        assert.ok(result.error);
        assert.equal(result.deleted.length, 0);
        assert.equal(deletes(state).length, 0);
    });
}

test("API failures never look like an empty successful cleanup", () => {
    for (const endpoint of ["orgs/octobooth/repos?per_page=100", "repos/octobooth/control", "repos/octobooth/control/actions/variables/CLEANUP_REVIEWERS", "repos/octobooth/control/pulls/10/reviews?per_page=100", "repos/octobooth/demo"]) {
        const { state, run } = fixture();
        state.intercept = (path) => { if (path === endpoint) throw new Error("API unavailable"); };
        assert.match(run({ execute: true }).error, /API unavailable/);
        assert.equal(deletes(state).length, 0);
    }
});

test("delete failure reports retained scope and fails the operation", () => {
    const { state, run } = fixture();
    state.intercept = (_, options) => { if (options.method === "DELETE") throw new Error("Delete denied"); };
    const result = run({ execute: true });
    assert.match(result.error, /Delete denied/);
    assert.deepEqual(result.failed, ["octobooth/demo"]);
    assert.equal(result.retained.length, 1);
});

test("event and selected repository filters narrow scope, never widen it", () => {
    const { state, run } = fixture();
    assert.equal(run({ repos: ["octobooth/other"], execute: true }).deleted.length, 0);
    assert.match(run({ event: "missing", execute: true }).error, /missing/);
    assert.equal(deletes(state).length, 0);
});

test("preview hash rejects changed scope", () => {
    const { state, run } = fixture();
    const preview = run();
    state.manifest.events[0].id = "changed";
    assert.match(run({ execute: true, expectedManifest: preview.manifestHash }).error, /changed since preview/);
    assert.equal(deletes(state).length, 0);
});

test("personal account inventory requires matching authenticated account", () => {
    const { state, run } = fixture();
    const api = (path) => {
        if (path === "users/octobooth") return { type: "User" };
        if (path === "user") return { login: "someone-else" };
        throw new Error("Should not enumerate another account");
    };
    assert.match(run({ api, execute: true }).error, /that account's gh authentication/);
    assert.equal(deletes(state).length, 0);
});

test("old destructive flags are explicitly rejected", () => {
    for (const flag of ["--all", "--older-than", "--days", "--yes"]) assert.throws(() => parseArgs([flag]), /cannot bypass event retention/);
    assert.deepEqual(parseArgs(["--control-repo", "org/control", "--owner", "org", "--event", "conf", "--execute", "--json"]), {
        controlRepo: "org/control", owner: "org", event: "conf", execute: true, json: true, repos: [],
    });
    assert.throws(() => validateManifest({ schema_version: 1 }), /Invalid cleanup manifest/);
});
