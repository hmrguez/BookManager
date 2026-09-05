import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const bumpType = process.argv[2];
const dryRun = process.argv.includes("--dry-run");

if (bumpType !== "patch" && bumpType !== "minor") {
  console.error(
    "Usage: bun scripts/bump-android-version.ts <patch|minor> [--dry-run]",
  );
  process.exit(1);
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const gradlePath = resolve(scriptDirectory, "../android/app/build.gradle");
const gradle = await readFile(gradlePath, "utf8");

const versionCodePattern = /^(\s*versionCode\s+)(\d+)(\s*)$/m;
const versionNamePattern =
  /^(\s*versionName\s+")(\d+)\.(\d+)(?:\.(\d+))?("\s*)$/m;

const versionCodeMatch = gradle.match(versionCodePattern);
const versionNameMatch = gradle.match(versionNamePattern);

if (!versionCodeMatch || !versionNameMatch) {
  throw new Error(`Could not find Android version fields in ${gradlePath}`);
}

const currentVersionCode = Number(versionCodeMatch[2]);
const major = Number(versionNameMatch[2]);
const minor = Number(versionNameMatch[3]);
const patch = Number(versionNameMatch[4] ?? 0);

const nextVersionCode = currentVersionCode + 1;
const nextVersion =
  bumpType === "patch"
    ? `${major}.${minor}.${patch + 1}`
    : `${major}.${minor + 1}.0`;

const updatedGradle = gradle
  .replace(
    versionCodePattern,
    (_, prefix: string, _current: string, suffix: string) =>
      `${prefix}${nextVersionCode}${suffix}`,
  )
  .replace(
    versionNamePattern,
    (
      _,
      prefix: string,
      _major: string,
      _minor: string,
      _patch: string | undefined,
      suffix: string,
    ) => `${prefix}${nextVersion}${suffix}`,
  );

if (!dryRun) {
  await writeFile(gradlePath, updatedGradle, "utf8");
}

console.log(
  `${dryRun ? "Would update" : "Updated"} Android version: ${versionNameMatch[2]}.${minor}.${patch} (${currentVersionCode}) -> ${nextVersion} (${nextVersionCode})`,
);
