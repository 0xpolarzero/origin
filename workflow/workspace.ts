import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { isPathWithinScope } from "./paths";

type SnapshotEntry = {
  kind: "file" | "symlink";
  mode: number;
  hash: string;
};

type Snapshot = Map<string, SnapshotEntry>;

const EXCLUDED_NAMES = new Set([".git", ".bun", ".smithers", "node_modules"]);
const EXCLUDED_PREFIXES = [".origin-review-cli-fixture-", "origin-review.db"];

function toPosixPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function shouldSkipRelativePath(relativePath: string): boolean {
  if (!relativePath) {
    return false;
  }

  const parts = toPosixPath(relativePath).split("/");
  return parts.some(
    (part) =>
      EXCLUDED_NAMES.has(part) || EXCLUDED_PREFIXES.some((prefix) => part.startsWith(prefix)),
  );
}

function ensureParentDirectory(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function hashSymlink(path: string): string {
  return createHash("sha256").update(readlinkSync(path)).digest("hex");
}

function snapshotEntryForPath(path: string): SnapshotEntry {
  const stats = lstatSync(path);

  if (stats.isSymbolicLink()) {
    return {
      kind: "symlink",
      mode: stats.mode,
      hash: hashSymlink(path),
    };
  }

  return {
    kind: "file",
    mode: stats.mode,
    hash: hashFile(path),
  };
}

function collectNodeModulesPaths(sourceRoot: string): string[] {
  const nodeModulesPaths: string[] = [];

  function visit(relativePath: string): void {
    const absolutePath = relativePath ? join(sourceRoot, relativePath) : sourceRoot;
    const entries = readdirSync(absolutePath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === ".bun") {
        continue;
      }

      const childRelativePath = relativePath ? join(relativePath, entry.name) : entry.name;
      if (entry.name === "node_modules") {
        nodeModulesPaths.push(toPosixPath(childRelativePath));
        continue;
      }

      if (entry.isDirectory()) {
        visit(childRelativePath);
      }
    }
  }

  visit("");
  return nodeModulesPaths.sort((left, right) => left.localeCompare(right));
}

function copyNodeModulesSymlinks(sourceRoot: string, workspaceRoot: string): void {
  for (const relativePath of collectNodeModulesPaths(sourceRoot)) {
    const sourceNodeModules = join(sourceRoot, relativePath);
    const targetNodeModules = join(workspaceRoot, relativePath);

    if (!existsSync(sourceNodeModules) || existsSync(targetNodeModules)) {
      continue;
    }

    ensureParentDirectory(targetNodeModules);
    symlinkSync(sourceNodeModules, targetNodeModules, "dir");
  }
}

function entriesAreEqual(
  left: SnapshotEntry | undefined,
  right: SnapshotEntry | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }

  return left.kind === right.kind && left.mode === right.mode && left.hash === right.hash;
}

export function copyRepoWorkspace(sourceRoot: string, workspaceRoot: string): void {
  cpSync(sourceRoot, workspaceRoot, {
    recursive: true,
    filter: (sourcePath) => {
      const relativePath = relative(sourceRoot, sourcePath);
      return !shouldSkipRelativePath(relativePath);
    },
  });

  copyNodeModulesSymlinks(sourceRoot, workspaceRoot);
}

export function captureWorkspaceSnapshot(rootDir: string): Snapshot {
  const snapshot = new Map<string, SnapshotEntry>();

  function visit(relativePath: string): void {
    const absolutePath = relativePath ? join(rootDir, relativePath) : rootDir;
    const stats = lstatSync(absolutePath);

    if (stats.isDirectory()) {
      const entries = readdirSync(absolutePath, { withFileTypes: true })
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));

      for (const entry of entries) {
        const childRelativePath = relativePath ? join(relativePath, entry) : entry;
        if (shouldSkipRelativePath(childRelativePath)) {
          continue;
        }
        visit(childRelativePath);
      }
      return;
    }

    snapshot.set(toPosixPath(relativePath), snapshotEntryForPath(absolutePath));
  }

  visit("");
  return snapshot;
}

export function syncWorkspaceChanges(options: {
  baselineSnapshot: Snapshot;
  scopePaths: string[];
  sourceRoot: string;
  targetRoot: string;
}): string[] {
  const { baselineSnapshot, scopePaths, sourceRoot, targetRoot } = options;
  const nextSnapshot = captureWorkspaceSnapshot(sourceRoot);
  const changedPaths = new Set<string>();

  for (const path of baselineSnapshot.keys()) {
    if (!entriesAreEqual(baselineSnapshot.get(path), nextSnapshot.get(path))) {
      changedPaths.add(path);
    }
  }

  for (const path of nextSnapshot.keys()) {
    if (!entriesAreEqual(baselineSnapshot.get(path), nextSnapshot.get(path))) {
      changedPaths.add(path);
    }
  }

  const sortedChangedPaths = [...changedPaths].sort((left, right) => left.localeCompare(right));
  const outOfScopePaths = sortedChangedPaths.filter((path) => !isPathWithinScope(path, scopePaths));
  if (outOfScopePaths.length > 0) {
    throw new Error(
      `Address pass changed files outside the requested scope: ${outOfScopePaths.join(", ")}`,
    );
  }

  for (const relativePath of sortedChangedPaths) {
    const sourcePath = join(sourceRoot, relativePath);
    const targetPath = join(targetRoot, relativePath);
    const nextEntry = nextSnapshot.get(relativePath);

    if (!nextEntry) {
      rmSync(targetPath, { force: true, recursive: true });
      continue;
    }

    ensureParentDirectory(targetPath);
    rmSync(targetPath, { force: true, recursive: true });

    if (nextEntry.kind === "symlink") {
      symlinkSync(readlinkSync(sourcePath), targetPath);
      continue;
    }

    copyFileSync(sourcePath, targetPath);
    chmodSync(targetPath, nextEntry.mode);
  }

  return sortedChangedPaths;
}
