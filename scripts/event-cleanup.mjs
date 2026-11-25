import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const WEEK = 7 * 24 * 60 * 60 * 1000;
const FILE = "cleanup-events.json";
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+$/;
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const normalize = (value) => value.toLowerCase();

export function github(path, { paginate = false, method = "GET" } = {}) {
    const args = ["api", "--method", method, path];
    if (paginate) args.push("--paginate", "--slurp");
    const result = spawnSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error(`GitHub API failed (${method} ${path}): ${result.error?.message || result.stderr.trim()}`);
    if (method === "DELETE") return null;
    const data = JSON.parse(result.stdout);
    return paginate ? data.flat() : data;
}

function instant(value) {
    if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value)) return NaN;
    const time = Date.parse(value);
    return Number.isFinite(time) && new Date(time).toISOString() === value.replace("Z", ".000Z") ? time : NaN;
}

export function validateManifest(data) {
    if (data?.schema_version !== 1 || !Array.isArray(data.events)) throw new Error("Invalid cleanup manifest: expected schema_version 1 and events array.");
    const events = new Set(), ids = new Set(), names = new Set();
    for (const event of data.events) {
        if (!event || typeof event.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(event.id) || events.has(event.id) ||
            !Number.isFinite(instant(event.ends_at)) || !Number.isSafeInteger(event.review_pr) || event.review_pr < 1 ||
            !Array.isArray(event.repositories)) throw new Error("Invalid or duplicate event metadata; all resources retained.");
        events.add(event.id);
        for (const repo of event.repositories) {
            if (!Number.isSafeInteger(repo?.id) || repo.id < 1 || typeof repo.full_name !== "string" || !NAME.test(repo.full_name) ||
                ids.has(repo.id) || names.has(normalize(repo.full_name))) {
                throw new Error("Invalid or overlapping repository scope; all resources retained.");
            }
            ids.add(repo.id);
            names.add(normalize(repo.full_name));
        }
    }
    return data;
}

function manifestAt(api, controlRepo, ref) {
    const file = api(`repos/${controlRepo}/contents/${FILE}?ref=${encodeURIComponent(ref)}`);
    if (file.encoding !== "base64" || typeof file.content !== "string") throw new Error("Cleanup manifest is not a readable file.");
    return Buffer.from(file.content, "base64").toString("utf8");
}

function snapshot(api, controlRepo) {
    const control = api(`repos/${controlRepo}`);
    if (!control.default_branch || normalize(control.full_name) !== normalize(controlRepo)) throw new Error("Control repository identity could not be verified.");
    const text = manifestAt(api, controlRepo, control.default_branch);
    const manifest = validateManifest(JSON.parse(text));
    const variable = api(`repos/${controlRepo}/actions/variables/CLEANUP_REVIEWERS`);
    const reviewers = typeof variable.value === "string" ? variable.value.split(",").map((s) => s.trim()) : [];
    if (!reviewers.length || reviewers.some((s) => !LOGIN.test(s))) throw new Error("CLEANUP_REVIEWERS must designate comma-separated DevRel/DRI GitHub logins; all resources retained.");
    return { control, text, manifest, reviewers: reviewers.map(normalize), hash: createHash("sha256").update(text).digest("hex") };
}

function reviewReason(api, controlRepo, state, event, now) {
    const boundary = instant(event.ends_at) + WEEK;
    if (now < boundary) return `Retained until ${new Date(boundary).toISOString()} (event end plus seven days).`;
    const pr = api(`repos/${controlRepo}/pulls/${event.review_pr}`);
    if (!pr.merged_at || pr.base?.ref !== state.control.default_branch ||
        normalize(pr.base?.repo?.full_name || "") !== normalize(controlRepo) || !/^[a-f0-9]{40,64}$/.test(pr.head?.sha || "")) {
        return "Review PR must be merged into the control repository default branch.";
    }
    if (manifestAt(api, controlRepo, pr.head.sha) !== state.text) return "Review is stale: the current manifest differs from the review PR head.";
    const reviews = api(`repos/${controlRepo}/pulls/${event.review_pr}/reviews?per_page=100`, { paginate: true });
    const latest = new Map();
    for (const review of [...reviews].sort((a, b) => a.id - b.id)) {
        const login = normalize(review.user?.login || "");
        if (state.reviewers.includes(login) && ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state)) latest.set(login, review);
    }
    for (const [login, review] of latest) {
        const submitted = Date.parse(review.submitted_at);
        if (review.state !== "APPROVED" || review.commit_id !== pr.head.sha || !Number.isFinite(submitted) || submitted < boundary || submitted > now) continue;
        const access = api(`repos/${controlRepo}/collaborators/${login}/permission`);
        if (["write", "maintain", "admin"].includes(access.permission)) return null;
    }
    return "Missing current DevRel/DRI approval for the exact PR head after the retention boundary, with live write permission.";
}

function repoReason(repo, owner, controlRepo, expected) {
    if (!repo || !Number.isSafeInteger(repo.id) || typeof repo.full_name !== "string" ||
        normalize(repo.owner?.login || "") !== normalize(owner) || normalize(repo.full_name.split("/")[0]) !== normalize(owner)) return "Repository owner/identity mismatch.";
    if (!repo.topics?.includes("demo-generated")) return "Repository no longer has the demo-generated topic.";
    if (normalize(repo.full_name) === normalize(controlRepo) || normalize(repo.name || repo.full_name.split("/")[1]) === "demo-cleanup") return "Cleanup control repository is protected.";
    if (expected && (repo.id !== expected.id || normalize(repo.full_name) !== normalize(expected.full_name))) return "Repository was replaced, renamed, transferred, or reassigned.";
    return null;
}

export function cleanup({ controlRepo, owner, event: eventId, execute = false, repos = [], expectedManifest, api = github, now = () => Date.now() }) {
    const result = { owner, controlRepo, manifestHash: null, eligible: [], retained: [], deleted: [], failed: [], error: null };
    let inventory = [];
    try {
        if (!NAME.test(controlRepo || "") || !LOGIN.test(owner || "")) throw new Error("Valid --control-repo OWNER/REPO and --owner OWNER are required.");
        if (eventId !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(eventId)) throw new Error("Invalid event ID.");
        if (repos.some((name) => !NAME.test(name))) throw new Error("Invalid selected repository.");
        const account = api(`users/${owner}`);
        if (account.type !== "Organization") {
            const user = api("user");
            if (normalize(user.login || "") !== normalize(owner)) throw new Error("Personal-account cleanup requires that account's gh authentication to include private repositories.");
        }
        inventory = api(account.type === "Organization" ? `orgs/${owner}/repos?per_page=100` : "user/repos?affiliation=owner&per_page=100", { paginate: true })
            .filter((r) => normalize(r.owner?.login || "") === normalize(owner) && r.topics?.includes("demo-generated"));
        const initial = snapshot(api, controlRepo);
        result.manifestHash = initial.hash;
        if (expectedManifest && expectedManifest !== initial.hash) throw new Error("Manifest changed since preview; preview and review the current scope again.");
        if (eventId && !initial.manifest.events.some((event) => event.id === eventId)) throw new Error(`Event '${eventId}' is missing from the manifest.`);
        const reasons = new Map();
        for (const repo of inventory) {
            const event = initial.manifest.events.find((e) => e.repositories.some((r) => r.id === repo.id && normalize(r.full_name) === normalize(repo.full_name)));
            let reason = repoReason(repo, owner, controlRepo);
            if (!reason && !event) reason = "Missing exact event association (repository ID and name); retained.";
            if (!reason && eventId && event.id !== eventId) reason = "Associated with a different event; retained.";
            if (!reason && repos.length && !repos.some((r) => normalize(r) === normalize(repo.full_name))) reason = "Not selected; retained.";
            if (!reason) {
                if (!reasons.has(event.id)) reasons.set(event.id, reviewReason(api, controlRepo, initial, event, now()));
                reason = reasons.get(event.id);
            }
            if (reason) result.retained.push({ repo: repo.full_name, reason });
            else result.eligible.push({ repo: repo.full_name, id: repo.id, createdAt: repo.created_at, event: event.id });
        }
        if (execute) {
            for (const candidate of result.eligible) {
                const current = snapshot(api, controlRepo);
                if (current.hash !== initial.hash) throw new Error("Manifest changed during cleanup; remaining resources retained.");
                const event = current.manifest.events.find((e) => e.id === candidate.event);
                const reason = reviewReason(api, controlRepo, current, event, now());
                if (reason) throw new Error(`${candidate.repo}: ${reason}`);
                const live = api(`repos/${candidate.repo}`);
                const changed = repoReason(live, owner, controlRepo, { id: candidate.id, full_name: candidate.repo });
                if (changed) throw new Error(`${candidate.repo}: ${changed}`);
                api(`repos/${candidate.repo}`, { method: "DELETE" });
                result.deleted.push(candidate.repo);
            }
        }
    } catch (error) {
        result.error = error.message;
        const retained = new Set(result.retained.map((r) => r.repo));
        for (const repo of inventory) {
            if (!result.deleted.includes(repo.full_name) && !retained.has(repo.full_name)) result.retained.push({ repo: repo.full_name, reason: error.message });
        }
        if (execute) result.failed = result.eligible.map((r) => r.repo).filter((r) => !result.deleted.includes(r));
        result.eligible = [];
    }
    return result;
}

export function parseArgs(args) {
    const options = { repos: [] };
    const values = { "--control-repo": "controlRepo", "--owner": "owner", "--event": "event", "--expected-manifest": "expectedManifest" };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--execute") options.execute = true;
        else if (arg === "--json") options.json = true;
        else if (values[arg] || arg === "--repo") {
            const value = args[++i];
            if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
            if (arg === "--repo") options.repos.push(value);
            else options[values[arg]] = value;
        } else throw new Error(`Unsupported cleanup option '${arg}'. Age cutoffs and --all cannot bypass event retention and review.`);
    }
    return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const options = parseArgs(process.argv.slice(2));
        const result = cleanup(options);
        if (options.json) console.log(JSON.stringify(result));
        else {
            for (const item of result.retained) console.log(`Retained ${item.repo}: ${item.reason}`);
            for (const item of result.eligible) console.log(`Eligible ${item.repo} (event ${item.event})`);
            for (const repo of result.deleted) console.log(`Deleted ${repo}`);
            if (result.error) console.error(`Cleanup stopped: ${result.error}`);
            else if (!options.execute) console.log("Preview only; nothing deleted. Execute only the reviewed event scope.");
        }
        if (result.error) process.exitCode = 1;
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
