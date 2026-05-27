import fs from "fs";
import path from "path";

const rootDir = path.resolve(__dirname, "../..");
const ignoredDirs = new Set([".git", ".next", "node_modules"]);
const textFileExtensions = new Set([
  ".env",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
  ".yml",
  ".yaml",
]);

function collectTextFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return ignoredDirs.has(entry.name) ? [] : collectTextFiles(fullPath);
    }

    if (!entry.isFile()) {
      return [];
    }

    return entry.name.startsWith(".env") ||
      textFileExtensions.has(path.extname(entry.name))
      ? [fullPath]
      : [];
  });
}

describe("environment variable security", () => {
  it("does not expose the Neon database connection string through NEXT_PUBLIC_", () => {
    const publicNeonConnectionString = [
      "NEXT",
      "PUBLIC",
      "NEON",
      "DB",
      "CONNECTION",
      "STRING",
    ].join("_");

    const matches = collectTextFiles(rootDir).flatMap((file) => {
      const content = fs.readFileSync(file, "utf8");

      return content.includes(publicNeonConnectionString)
        ? [path.relative(rootDir, file)]
        : [];
    });

    expect(matches).toEqual([]);
  });
});
