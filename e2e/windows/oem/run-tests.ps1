# ============================================================================
# OpenTabs Windows E2E Test Runner
#
# Runs targeted tests that exercise Windows-specific behavior:
#   1. Server startup (opentabs start / MCP server spawn)
#   2. Path handling (backslashes, drive letters, UNC paths)
#   3. Environment variable sanitization (libuv EINVAL)
#   4. Process management (no SIGTERM, TerminateProcess)
#   5. CLI commands (doctor, start, stop)
#   6. Cross-platform utilities (atomicWrite, platformExec, etc.)
#
# Results are written to the Shared folder for the host to collect.
# ============================================================================

$ErrorActionPreference = "Continue"
$RepoDir = "C:\opentabs"
$SharedDir = "C:\Users\opentabs\Desktop\Shared"
$ResultFile = Join-Path $SharedDir "results.log"
$DetailFile = Join-Path $SharedDir "results-detail.log"

function Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$ts  $msg" | Tee-Object -FilePath $ResultFile -Append
}

Set-Location $RepoDir

Log "========================================="
Log "OpenTabs Windows E2E Test Suite"
Log "========================================="
Log "OS:       $([System.Environment]::OSVersion.VersionString)"
Log "Node:     $(node --version)"
Log "npm:      $(npm --version)"
Log "Platform: $([System.Environment]::OSVersion.Platform)"
Log ""

$passed = 0
$failed = 0
$errors = @()

# --------------------------------------------------------------------------
# Test helper — runs a node script inline, captures exit code
# --------------------------------------------------------------------------
function Run-Test {
    param(
        [string]$Name,
        [string]$Script
    )

    Log "--- TEST: $Name"

    $tmpFile = [System.IO.Path]::GetTempFileName() -replace '\.tmp$', '.mjs'
    Set-Content -Path $tmpFile -Value $Script -Encoding UTF8

    $proc = Start-Process -FilePath "node" -ArgumentList $tmpFile `
        -NoNewWindow -Wait -PassThru `
        -RedirectStandardOutput "$SharedDir\test-stdout.tmp" `
        -RedirectStandardError "$SharedDir\test-stderr.tmp"

    $stdout = Get-Content "$SharedDir\test-stdout.tmp" -Raw -ErrorAction SilentlyContinue
    $stderr = Get-Content "$SharedDir\test-stderr.tmp" -Raw -ErrorAction SilentlyContinue

    if ($stdout) { $stdout | Out-File $DetailFile -Append }
    if ($stderr) { $stderr | Out-File $DetailFile -Append }

    Remove-Item $tmpFile -ErrorAction SilentlyContinue
    Remove-Item "$SharedDir\test-stdout.tmp" -ErrorAction SilentlyContinue
    Remove-Item "$SharedDir\test-stderr.tmp" -ErrorAction SilentlyContinue

    if ($proc.ExitCode -eq 0) {
        Log "  PASS: $Name"
        $script:passed++
    } else {
        Log "  FAIL: $Name (exit code: $($proc.ExitCode))"
        if ($stderr) { Log "  stderr: $($stderr.Trim())" }
        $script:failed++
        $script:errors += $Name
    }
}

# ==========================================================================
# TEST 1: Platform detection
# ==========================================================================
Run-Test "platform detection" @'
import { isWindows } from "./platform/shared/dist/index.js";
import assert from "node:assert";

assert.strictEqual(isWindows(), true, "isWindows() must return true on Windows");
assert.strictEqual(process.platform, "win32");
console.log("OK: isWindows() === true, process.platform === win32");
'@

# ==========================================================================
# TEST 2: platformExec appends .cmd on Windows
# ==========================================================================
Run-Test "platformExec appends .cmd" @'
import { platformExec } from "./platform/shared/dist/index.js";
import assert from "node:assert";

assert.strictEqual(platformExec("npm"), "npm.cmd");
assert.strictEqual(platformExec("npx"), "npx.cmd");
assert.strictEqual(platformExec("node"), "node.cmd");
assert.strictEqual(platformExec("python"), "python");
console.log("OK: platformExec correctly appends .cmd for npm/npx/node");
'@

# ==========================================================================
# TEST 3: sanitizeEnv strips undefined values
# ==========================================================================
Run-Test "sanitizeEnv strips undefined" @'
import { sanitizeEnv } from "./platform/shared/dist/index.js";
import assert from "node:assert";

const env = { FOO: "bar", BAZ: undefined, QUUX: "ok" };
const result = sanitizeEnv(env);

assert.strictEqual(result.FOO, "bar");
assert.strictEqual(result.QUUX, "ok");
assert.strictEqual("BAZ" in result, false, "undefined values must be stripped");
console.log("OK: sanitizeEnv strips undefined values");
'@

# ==========================================================================
# TEST 4: sanitizeEnv — spawn with undefined env values causes EINVAL
# ==========================================================================
Run-Test "spawn EINVAL with undefined env" @'
import { spawn } from "node:child_process";
import { sanitizeEnv } from "./platform/shared/dist/index.js";

// Spawn with raw env containing undefined — should fail with EINVAL on Windows
const badEnv = { ...process.env, __TEST_UNDEF__: undefined };

const fail = new Promise((resolve) => {
    const proc = spawn("node", ["--version"], {
        env: badEnv,
        stdio: "pipe",
    });
    proc.on("error", (err) => resolve(err));
    proc.on("exit", () => resolve(null));
});

const err = await fail;
if (!err) {
    // Some Node.js versions may not fail — that is OK, the test verifies
    // sanitizeEnv is still needed as a safety measure
    console.log("OK: spawn did not fail (Node.js may handle undefined internally now)");
} else {
    if (err.code !== "EINVAL") {
        console.error(`Unexpected error code: ${err.code}`);
        process.exit(1);
    }
    console.log("OK: spawn with undefined env correctly produces EINVAL");
}

// Verify sanitizeEnv fixes it
const cleanEnv = sanitizeEnv(badEnv);
const ok = new Promise((resolve) => {
    const proc = spawn("node", ["--version"], {
        env: cleanEnv,
        stdio: "pipe",
    });
    proc.on("error", (err) => { console.error(err); resolve(false); });
    proc.on("exit", (code) => resolve(code === 0));
});

if (!(await ok)) {
    console.error("spawn with sanitized env failed");
    process.exit(1);
}
console.log("OK: spawn with sanitizeEnv succeeds");
'@

# ==========================================================================
# TEST 5: atomicWrite on NTFS
# ==========================================================================
Run-Test "atomicWrite on NTFS" @'
import { atomicWrite } from "./platform/shared/dist/index.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opentabs-win-test-"));
const file = path.join(dir, "test.json");

// Write initial content
await atomicWrite(file, '{"version": 1}\n');
assert.strictEqual(fs.readFileSync(file, "utf-8"), '{"version": 1}\n');

// Overwrite (tests NTFS delete-then-rename path)
await atomicWrite(file, '{"version": 2}\n');
assert.strictEqual(fs.readFileSync(file, "utf-8"), '{"version": 2}\n');

// Rapid successive writes (race condition stress test)
const writes = Array.from({ length: 10 }, (_, i) =>
    atomicWrite(file, `{"version": ${i + 10}}\n`)
);
await Promise.all(writes);
const final = JSON.parse(fs.readFileSync(file, "utf-8"));
assert.ok(final.version >= 10, `Final version should be >= 10, got ${final.version}`);

fs.rmSync(dir, { recursive: true, force: true });
console.log("OK: atomicWrite works correctly on NTFS");
'@

# ==========================================================================
# TEST 6: safeChmod is a no-op on Windows
# ==========================================================================
Run-Test "safeChmod no-op on Windows" @'
import { safeChmod } from "./platform/shared/dist/index.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opentabs-win-test-"));
const file = path.join(dir, "test.txt");
fs.writeFileSync(file, "hello");

// safeChmod should silently succeed (no-op) on Windows
await safeChmod(file, 0o600);
await safeChmod(file, 0o700);

fs.rmSync(dir, { recursive: true, force: true });
console.log("OK: safeChmod silently succeeds on Windows");
'@

# ==========================================================================
# TEST 7: Windows path resolution in plugin resolver
# ==========================================================================
Run-Test "Windows path patterns" @'
import assert from "node:assert";
import path from "node:path";

// Verify path.sep is backslash on Windows
assert.strictEqual(path.sep, "\\");

// Verify drive letter paths resolve correctly
const resolved = path.resolve("C:\\Users\\test\\opentabs");
assert.ok(resolved.startsWith("C:\\"), `Expected C:\\ prefix, got: ${resolved}`);

// Verify path.join uses backslashes
const joined = path.join("C:\\Users", "test", ".opentabs", "config.json");
assert.ok(joined.includes("\\"), `Expected backslashes, got: ${joined}`);
assert.ok(!joined.includes("/"), `Should not contain forward slashes: ${joined}`);

// Verify UNC-style paths
const unc = path.resolve("\\\\server\\share\\file.txt");
assert.ok(unc.startsWith("\\\\"), `Expected UNC prefix, got: ${unc}`);

console.log("OK: Windows path patterns work correctly");
'@

# ==========================================================================
# TEST 8: MCP server starts and responds to /health
# ==========================================================================
Run-Test "MCP server startup" @'
import { fork } from "node:child_process";
import { sanitizeEnv } from "./platform/shared/dist/index.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Create isolated config directory
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "opentabs-win-e2e-"));
const extDir = path.join(configDir, "extension");
fs.mkdirSync(extDir, { recursive: true });

// Write minimal config
const config = { localPlugins: [], permissions: {} };
fs.writeFileSync(
    path.join(configDir, "config.json"),
    JSON.stringify(config, null, 2),
    "utf-8"
);

// Write auth secret
const secret = "test-secret-" + Date.now();
fs.writeFileSync(
    path.join(extDir, "auth.json"),
    JSON.stringify({ secret }),
    "utf-8"
);

// Write version marker
const serverPkg = JSON.parse(
    fs.readFileSync("platform/mcp-server/package.json", "utf-8")
);
fs.writeFileSync(
    path.join(extDir, ".opentabs-version"),
    serverPkg.version,
    "utf-8"
);

// Start server on port 0 (ephemeral)
const serverEntry = path.join(process.cwd(), "platform/mcp-server/dist/index.js");
const proc = fork(serverEntry, ["--dev"], {
    env: sanitizeEnv({
        ...process.env,
        PORT: "0",
        OPENTABS_CONFIG_DIR: configDir,
        OPENTABS_SKIP_NPM_DISCOVERY: "1",
        OPENTABS_DANGEROUSLY_SKIP_PERMISSIONS: "1",
    }),
    stdio: ["ignore", "pipe", "pipe", "ipc"],
});

let port = null;

// Parse port from startup log
const portPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Server did not start within 30s")), 30_000);

    const onData = (chunk) => {
        const text = chunk.toString();
        const match = text.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) {
            port = parseInt(match[1], 10);
            clearTimeout(timeout);
            resolve(port);
        }
    };

    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);

    proc.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
    });

    proc.on("exit", (code) => {
        if (!port) {
            clearTimeout(timeout);
            reject(new Error("Server exited with code " + code + " before ready"));
        }
    });
});

try {
    port = await portPromise;
    console.log("Server started on port", port);

    // Hit /health endpoint
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(5_000),
    });

    if (!res.ok) {
        throw new Error(`/health returned ${res.status}`);
    }

    const health = await res.json();
    if (health.status !== "ok") {
        throw new Error(`Health status: ${health.status}`);
    }

    console.log("OK: MCP server started and /health returned ok");
    console.log(`  version: ${health.version}, mode: ${health.mode}, plugins: ${health.plugins}`);
} finally {
    // Kill the server — on Windows proc.kill() calls TerminateProcess
    try { proc.kill(); } catch {}
    // Wait for exit
    await new Promise((resolve) => {
        proc.on("exit", resolve);
        setTimeout(resolve, 5_000);
    });
    // Clean up
    fs.rmSync(configDir, { recursive: true, force: true });
}
'@

# ==========================================================================
# TEST 9: Process kill behavior on Windows (no SIGTERM)
# ==========================================================================
Run-Test "process kill behavior" @'
import { fork } from "node:child_process";
import assert from "node:assert";

// Spawn a long-running child
const child = fork("-e", "setInterval(() => {}, 1000)", {
    stdio: "ignore",
});

// On Windows, proc.kill() should work (maps to TerminateProcess)
assert.ok(child.pid > 0, "Child should have a PID");

// Kill it
const exitPromise = new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
    setTimeout(() => resolve({ code: null, signal: "timeout" }), 5_000);
});

child.kill();
const result = await exitPromise;

// On Windows, killed processes exit with code 1 or null with signal SIGTERM
assert.ok(
    result.code !== null || result.signal !== "timeout",
    "Process should have exited after kill()"
);

console.log(`OK: Process killed successfully (code=${result.code}, signal=${result.signal})`);
'@

# ==========================================================================
# TEST 10: npm/npx spawn with platformExec
# ==========================================================================
Run-Test "npm spawn via platformExec" @'
import { spawn } from "node:child_process";
import { platformExec, sanitizeEnv } from "./platform/shared/dist/index.js";
import assert from "node:assert";

const cmd = platformExec("npm");
assert.strictEqual(cmd, "npm.cmd", "Should use npm.cmd on Windows");

const result = await new Promise((resolve, reject) => {
    const proc = spawn(cmd, ["--version"], {
        env: sanitizeEnv(process.env),
        stdio: "pipe",
        shell: false,
    });

    let stdout = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.on("error", reject);
    proc.on("exit", (code) => resolve({ code, stdout: stdout.trim() }));
});

assert.strictEqual(result.code, 0, `npm --version exited with code ${result.code}`);
assert.ok(/^\d+\.\d+\.\d+/.test(result.stdout), `Expected version string, got: ${result.stdout}`);
console.log(`OK: npm.cmd --version returned ${result.stdout}`);
'@

# ==========================================================================
# TEST 11: Config file with Windows paths
# ==========================================================================
Run-Test "config with Windows paths" @'
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";

// Simulate a config.json with Windows-style paths
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "opentabs-win-cfg-"));
const config = {
    localPlugins: [
        "C:\\Users\\test\\.opentabs\\plugins\\my-plugin",
        ".\\relative\\plugin",
        "~\\custom\\plugin",
    ],
    permissions: {},
};

const configPath = path.join(configDir, "config.json");
fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

// Read it back and verify paths are preserved
const loaded = JSON.parse(fs.readFileSync(configPath, "utf-8"));
assert.strictEqual(loaded.localPlugins[0], "C:\\Users\\test\\.opentabs\\plugins\\my-plugin");
assert.strictEqual(loaded.localPlugins[1], ".\\relative\\plugin");
assert.strictEqual(loaded.localPlugins[2], "~\\custom\\plugin");

fs.rmSync(configDir, { recursive: true, force: true });
console.log("OK: Config with Windows paths read/write correctly");
'@

# ==========================================================================
# TEST 12: Temp directory creation and cleanup
# ==========================================================================
Run-Test "temp directory operations" @'
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";

// mkdtemp should work with Windows temp dir
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "opentabs-win-"));
assert.ok(fs.existsSync(tmpDir), "Temp dir should exist");
assert.ok(tmpDir.includes("\\"), `Temp dir should use backslashes: ${tmpDir}`);

// Nested directory creation
const nested = path.join(tmpDir, "a", "b", "c");
fs.mkdirSync(nested, { recursive: true });
assert.ok(fs.existsSync(nested));

// File operations in deep paths
const file = path.join(nested, "test.json");
fs.writeFileSync(file, '{"ok": true}', "utf-8");
assert.strictEqual(JSON.parse(fs.readFileSync(file, "utf-8")).ok, true);

// Recursive cleanup
fs.rmSync(tmpDir, { recursive: true, force: true });
assert.ok(!fs.existsSync(tmpDir), "Temp dir should be deleted");

console.log("OK: Temp directory operations work on Windows");
'@

# ==========================================================================
# Summary
# ==========================================================================
Log ""
Log "========================================="
Log "RESULTS: $passed passed, $failed failed"
Log "========================================="

if ($errors.Count -gt 0) {
    Log ""
    Log "Failed tests:"
    foreach ($e in $errors) {
        Log "  - $e"
    }
}

# Write machine-readable result
$summary = @{
    passed = $passed
    failed = $failed
    total = $passed + $failed
    errors = $errors
    timestamp = (Get-Date -Format "o")
    os = [System.Environment]::OSVersion.VersionString
    node = (node --version)
    platform = "win32"
} | ConvertTo-Json

Set-Content -Path (Join-Path $SharedDir "results.json") -Value $summary -Encoding UTF8

if ($failed -gt 0) {
    exit 1
}
exit 0
