import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const androidCode = /^([\t ]*versionCode[\t ]+)(\d+)([\t ]*)$/gm;
const androidName = /^([\t ]*versionName[\t ]+")([^"\r\n]+)("[\t ]*)$/gm;
const iosCode = /^([\t ]*CURRENT_PROJECT_VERSION[\t ]*=[\t ]*)([^;\r\n]+)(;[\t ]*)$/gm;
const iosName = /^([\t ]*MARKETING_VERSION[\t ]*=[\t ]*)([^;\r\n]+)(;[\t ]*)$/gm;

type Operation = "patch" | "minor" | "build" | "sync";

function versions(source: string, pattern: RegExp, label: string) {
  const matches = [...source.matchAll(pattern)];
  if (!matches.length) throw new Error(`Missing ${label}`);
  return matches.map((match) => match[2]);
}

function parseVersion(value: string): number[] {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?$/.test(value)) {
    throw new Error(`Invalid native version: ${value}`);
  }
  const parts = value.split(".").map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) {
    throw new Error(`Native version is too large: ${value}`);
  }
  return [parts[0], parts[1], parts[2] ?? 0];
}

function parseBuild(value: string) {
  const number = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(number) || number > 2100000000) {
    throw new Error(`Invalid shared build number: ${value}`);
  }
  return number;
}

function compareVersions(left: number[], right: number[]) {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

export function planVersionUpdate(gradle: string, project: string, operation: Operation) {
  const names = versions(gradle, androidName, "Android versionName");
  const codes = versions(gradle, androidCode, "Android versionCode");
  const iosNames = versions(project, iosName, "iOS MARKETING_VERSION");
  const iosCodes = versions(project, iosCode, "iOS CURRENT_PROJECT_VERSION");
  // The app, ShareExtension and LibbyExtension each have Debug and Release settings.
  // Fail before writing either file if the native project layout changes.
  if (names.length !== 1 || codes.length !== 1 || iosNames.length !== 6 || iosCodes.length !== 6) {
    throw new Error("Expected one Android version and six iOS target/configuration versions");
  }
  const currentNames = [...names, ...iosNames];
  const currentCodes = [...codes, ...iosCodes];
  const latest = currentNames.map(parseVersion).sort(compareVersions).at(-1)!;
  const [major, minor, patch] = latest;
  const version = operation === "patch"
    ? `${major}.${minor}.${patch + 1}`
    : operation === "minor" ? `${major}.${minor + 1}.0` : latest.join(".");
  const build = Math.max(...currentCodes.map(parseBuild)) + (operation === "sync" ? 0 : 1);
  parseVersion(version);
  parseBuild(String(build));

  const replace = (source: string, pattern: RegExp, value: string) =>
    source.replace(pattern, (_match, prefix: string, _old: string, suffix: string) => `${prefix}${value}${suffix}`);
  return {
    version,
    build,
    gradle: replace(replace(gradle, androidName, version), androidCode, String(build)),
    project: replace(replace(project, iosName, version), iosCode, String(build)),
  };
}

export async function updateNativeVersions(mobileDirectory: string, operation: Operation, dryRun = false) {
  const gradlePath = resolve(mobileDirectory, "android/app/build.gradle");
  const projectPath = resolve(mobileDirectory, "ios/App/App.xcodeproj/project.pbxproj");
  const [gradle, project] = await Promise.all([
    readFile(gradlePath, "utf8"), readFile(projectPath, "utf8"),
  ]);
  const result = planVersionUpdate(gradle, project, operation);
  if (!dryRun) {
    // Validate both inputs first; restore Android if writing the iOS project fails.
    if (result.gradle !== gradle) await writeFile(gradlePath, result.gradle, "utf8");
    try {
      if (result.project !== project) await writeFile(projectPath, result.project, "utf8");
    } catch (error) {
      if (result.gradle !== gradle) await writeFile(gradlePath, gradle, "utf8");
      throw error;
    }
  }
  return result;
}

// Keep imports side-effect free for release-tool tests.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [operation, ...flags] = process.argv.slice(2);
  if (!["patch", "minor", "build", "sync"].includes(operation) || flags.some((flag) => flag !== "--dry-run")) {
    console.error("Usage: bun scripts/bump-version.ts <patch|minor|build|sync> [--dry-run]");
    process.exit(1);
  }
  const dryRun = flags.includes("--dry-run");
  const mobileDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = await updateNativeVersions(mobileDirectory, operation as Operation, dryRun);
  console.log(`${dryRun ? "Would set" : "Set"} Android and all iOS targets to ${result.version} (${result.build})`);
}
