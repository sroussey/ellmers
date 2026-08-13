import { Glob } from "bun";
import { existsSync } from "fs";
import { readFile, stat } from "fs/promises";
import { join } from "path";

interface RootPackageJson {
  workspaces: string[];
}

interface PackageJson {
  publishConfig?: {
    access?: string;
  };
}

/**
 * Workspace directories from the root `workspaces` patterns.
 *
 * @param publishableOnly `true` (the default) keeps only packages marked
 *   `publishConfig.access === "public"` — what publishing and consumer-linking
 *   want. Pass `false` for tooling that has to cover *every* workspace, such as
 *   source-mode stubbing: `providers/aws` and `providers/cloudflare` are
 *   `private: true`, so a publishable-only scan skips them and their subpath
 *   imports (`@workglow/aws/job-queue`) fail to resolve in source mode even
 *   though their tests are part of the suite.
 */
export async function findWorkspaces(publishableOnly = true): Promise<string[]> {
  const workspaces: string[] = [];

  // Read root package.json
  const rootPackageJson = JSON.parse(
    (await readFile("./package.json", "utf-8")).toString()
  ) as RootPackageJson;

  // Process each workspace pattern
  for (const pattern of rootPackageJson.workspaces) {
    try {
      const globber = new Glob(pattern);
      for await (const match of globber.scan({ absolute: true, onlyFiles: false })) {
        try {
          const stats = await stat(match);
          if (stats.isDirectory()) {
            const packageJsonPath = join(match, "package.json");
            if (existsSync(packageJsonPath)) {
              const packageJson = JSON.parse(
                (await readFile(packageJsonPath, "utf-8")).toString()
              ) as PackageJson;
              if (!publishableOnly || packageJson.publishConfig?.access === "public") {
                workspaces.push(match);
              }
            }
          }
        } catch (error) {
          console.error(`Error processing workspace pattern ${pattern}:`, error);
          process.exit(1);
        }
      }
    } catch (error) {
      console.error(`Error processing workspace pattern ${pattern}:`, error);
      process.exit(1);
    }
  }
  return workspaces;
}
