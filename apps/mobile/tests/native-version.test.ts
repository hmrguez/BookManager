import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planVersionUpdate, updateNativeVersions } from "../scripts/bump-version";

const gradle = await readFile(new URL("../android/app/build.gradle", import.meta.url), "utf8");
const project = await readFile(new URL("../ios/App/App.xcodeproj/project.pbxproj", import.meta.url), "utf8");
const baseline = planVersionUpdate(gradle, project, "sync");
const android = (version = "1.10.1", build = 12) => baseline.gradle
  .replace(/versionName "[^"]+"/, `versionName "${version}"`)
  .replace(/versionCode \d+/, `versionCode ${build}`);
const ios = (version = "1.0", build = 1) => baseline.project
  .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`)
  .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`);

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture(projectText = ios()) {
  const directory = await mkdtemp(join(tmpdir(), "wovenleaf-version-"));
  directories.push(directory);
  const gradlePath = join(directory, "android/app/build.gradle");
  const projectPath = join(directory, "ios/App/App.xcodeproj/project.pbxproj");
  await mkdir(join(directory, "android/app"), { recursive: true });
  await mkdir(join(directory, "ios/App/App.xcodeproj"), { recursive: true });
  await writeFile(gradlePath, android());
  await writeFile(projectPath, projectText);
  return { directory, gradlePath, projectPath };
}

describe("shared native release versions", () => {
  test("synchronizes all six iOS configurations without bumping Android", () => {
    const result = planVersionUpdate(android(), ios(), "sync");
    expect(result.version).toBe("1.10.1");
    expect(result.build).toBe(12);
    expect(result.gradle).toBe(android());
    expect(result.project).toBe(ios("1.10.1", 12));
    expect(planVersionUpdate(result.gradle, result.project, "sync")).toEqual(result);
  });

  test("patch uses numeric version ordering and the highest build across platforms", () => {
    const result = planVersionUpdate(android("1.9.9", 40), ios("1.10.1", 12), "patch");
    expect(result.version).toBe("1.10.2");
    expect(result.build).toBe(41);
    expect(result.gradle).toBe(android("1.10.2", 41));
    expect(result.project).toBe(ios("1.10.2", 41));
  });

  test("minor resets the patch and build-only preserves the marketing version", () => {
    const minor = planVersionUpdate(android(), ios(), "minor");
    expect(minor.version).toBe("1.11.0");
    expect(minor.build).toBe(13);
    const build = planVersionUpdate(android(), ios(), "build");
    expect(build.version).toBe("1.10.1");
    expect(build.build).toBe(13);
    expect(build.gradle).toContain('versionNameSuffix "-dev"');
  });

  test("normalizes two-part versions and catches an extension ahead of the app", () => {
    expect(planVersionUpdate(android("1.0", 1), ios(), "patch").version).toBe("1.0.1");
    const ahead = ios().replace("MARKETING_VERSION = 1.0;", "MARKETING_VERSION = 2.0;")
      .replace("CURRENT_PROJECT_VERSION = 1;", "CURRENT_PROJECT_VERSION = 30;");
    expect(planVersionUpdate(android(), ahead, "sync").project).toBe(ios("2.0.0", 30));
  });

  test("rejects unsupported fields, layouts and build overflow", () => {
    expect(() => planVersionUpdate(android("1.2-beta"), ios(), "patch")).toThrow("Invalid native version");
    expect(() => planVersionUpdate(android(), ios().replace("MARKETING_VERSION", "UNKNOWN"), "patch")).toThrow("six iOS");
    expect(() => planVersionUpdate(android(), ios().replace("CURRENT_PROJECT_VERSION = 1;", 'CURRENT_PROJECT_VERSION = "1.2";'), "patch")).toThrow("Invalid shared build");
    expect(() => planVersionUpdate(android("1.0", 2100000000), ios(), "patch")).toThrow("Invalid shared build");
  });

  test("writes both native files and leaves every unrelated setting untouched", async () => {
    const files = await fixture();
    await updateNativeVersions(files.directory, "patch");
    expect(await readFile(files.gradlePath, "utf8")).toBe(android("1.10.2", 13));
    expect(await readFile(files.projectPath, "utf8")).toBe(ios("1.10.2", 13));
  });

  test("dry-run changes neither file", async () => {
    const files = await fixture();
    const result = await updateNativeVersions(files.directory, "minor", true);
    expect(result.version).toBe("1.11.0");
    expect(await readFile(files.gradlePath, "utf8")).toBe(android());
    expect(await readFile(files.projectPath, "utf8")).toBe(ios());
  });

  test("invalid iOS input fails before changing Android", async () => {
    const files = await fixture("invalid project");
    await expect(updateNativeVersions(files.directory, "patch")).rejects.toThrow("Missing iOS");
    expect(await readFile(files.gradlePath, "utf8")).toBe(android());
    expect(await readFile(files.projectPath, "utf8")).toBe("invalid project");
  });
});
