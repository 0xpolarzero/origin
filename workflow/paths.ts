import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

function splitRawPaths(value: string | string[]): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => entry.split(","));
  }

  return value.split(",");
}

function toPosixPath(value: string): string {
  return value.replaceAll("\\", "/");
}

export function normalizeRequestedPath(rootDir: string, rawPath: string): string {
  const trimmed = rawPath.trim();

  if (!trimmed) {
    throw new Error("Scoped review paths cannot be empty.");
  }

  const absolutePath = resolve(rootDir, trimmed);
  const relativePath = relative(rootDir, absolutePath);

  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Scoped review path resolves outside the repository: ${rawPath}`);
  }

  if (!existsSync(absolutePath)) {
    throw new Error(`Scoped review path does not exist: ${rawPath}`);
  }

  return toPosixPath(relativePath);
}

export function parseRequestedPaths(
  rootDir: string,
  rawValue: string | string[] | undefined,
): string[] {
  if (rawValue == null) {
    return [];
  }

  if (Array.isArray(rawValue) && rawValue.length === 0) {
    return [];
  }

  const entries = splitRawPaths(rawValue)
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    throw new Error("Scoped review path list cannot be empty.");
  }

  const normalized = new Set<string>();
  for (const entry of entries) {
    normalized.add(normalizeRequestedPath(rootDir, entry));
  }

  return [...normalized].sort();
}

export function isPathWithinScope(path: string, scopePaths: string[]): boolean {
  if (scopePaths.length === 0) {
    return true;
  }

  const normalized = toPosixPath(path);
  return scopePaths.some((scopePath) => {
    const normalizedScope = toPosixPath(scopePath);
    return normalized === normalizedScope || normalized.startsWith(`${normalizedScope}/`);
  });
}
