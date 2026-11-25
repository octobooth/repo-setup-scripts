import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { CanvasError } from "@github/copilot-sdk/extension";

export function createCleanup({ repoRoot, scriptEnv, gh = "gh", broadcast }) {
    const idle = () => ({ status: "idle", owner: null, controlRepo: null, candidates: [], retained: [], error: null, workflowUrl: null });
    let state = idle();
    const publish = () => broadcast("cleanup", state);

    async function preview({ owner, controlRepo, event, olderThanHours } = {}) {
        if (state.status === "previewing") throw new CanvasError("busy", "Cleanup preview is already running.");
        if (olderThanHours !== undefined) throw new CanvasError("invalid_options", "Age cutoffs cannot bypass event retention and recorded review. Use a control repository and event.");
        state = { ...idle(), status: "previewing" };
        publish();
        try {
            const env = scriptEnv();
            if (!owner?.trim()) {
                const user = spawnSync(gh, ["api", "user", "--jq", ".login"], { env, encoding: "utf8", timeout: 15000 });
                if (user.error || user.status !== 0 || !user.stdout.trim()) throw new Error("Cannot identify the signed-in gh account; no cleanup scope was assumed.");
                owner = user.stdout.trim();
            }
            owner = owner.trim();
            controlRepo = controlRepo?.trim() || (owner.toLowerCase() === "octobooth" ? "octobooth/repo-setup-scripts" : `${owner}/demo-cleanup`);
            state.owner = owner;
            state.controlRepo = controlRepo;
            const args = [join(repoRoot, "scripts", "event-cleanup.mjs"), "--owner", owner, "--control-repo", controlRepo, "--json"];
            if (event?.trim()) args.push("--event", event.trim());
            const result = await new Promise((resolve, reject) => {
                const child = spawn(process.execPath, args, { cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"] });
                let stdout = "", stderr = "";
                child.stdout.on("data", (chunk) => { stdout += chunk; });
                child.stderr.on("data", (chunk) => { stderr += chunk; });
                child.on("error", reject);
                child.on("close", (code) => {
                    try {
                        const report = JSON.parse(stdout);
                        if (code !== 0 && !report.error) throw new Error(stderr || `Cleanup preview failed (exit ${code}).`);
                        resolve(report);
                    } catch (error) { reject(new Error(`Cleanup preview failed: ${error.message}`)); }
                });
            });
            state.candidates = result.eligible;
            state.retained = result.retained;
            state.error = result.error;
            if (/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(controlRepo)) state.workflowUrl = `https://github.com/${controlRepo}/actions`;
            state.status = result.error ? "error" : "preview";
        } catch (error) {
            state.status = "error";
            state.error = error.message;
        }
        publish();
        return state;
    }

    return {
        get state() { return state; },
        preview,
        remove() {
            throw new CanvasError("reviewed_workflow_required", "Local cleanup is preview-only. Use the control repository's reviewed cleanup workflow; event end + seven days and exact-scope DevRel/DRI approval are required. No repositories or local clones were deleted.");
        },
        reset() {
            if (state.status === "previewing") return state;
            state = idle();
            publish();
            return state;
        },
    };
}
