#!/usr/bin/env bun

import { $ } from "bun";
import { readdir } from "fs/promises";
import { join } from "path";

/**
 * Process packages in a directory, either linking or unlinking them
 */
async function processPackages(dir: string, operation: "link" | "unlink"): Promise<void> {
  console.log(`Processing directory: ${dir}`);

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const packagePath = join(dir, entry.name);
        console.log(`${operation === "link" ? "Linking" : "Unlinking"} package: ${packagePath}`);

        try {
          const result = await $`bun ${operation}`.cwd(packagePath).quiet();
          console.log(result.text());
          console.log(`✅ Successfully ${operation}ed ${packagePath}`);
        } catch (error) {
          console.error(
            `Failed to ${operation} ${packagePath}:`,
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    }
  } catch (error) {
    console.error(`Directory ${dir} does not exist or cannot be read`);
  }
}

async function main(): Promise<void> {
  // Parse command line arguments
  const args = process.argv.slice(2);
  if (args.length == 0 || args.length > 1) {
    console.error("Usage: bun run link-all.ts [link|unlink]");
    console.error("  link:    Link packages");
    console.error("  unlink:  Unlink packages");
    process.exit(1);
  }

  const operation = args[0];
  if (operation !== "link" && operation !== "unlink") {
    console.error(`Error: Invalid operation '${operation}'`);
    console.error("Usage: bun run link-all.ts [link|unlink]");
    process.exit(1);
  }

  console.log(`${operation === "link" ? "Linking" : "Unlinking"} packages...`);

  // Process all packages
  await processPackages("packages", operation);
  // Process all providers
  await processPackages("providers", operation);

  // Process all examples
  console.log(`\n${operation === "link" ? "Linking" : "Unlinking"} examples...`);
  await processPackages("examples", operation);

  console.log(`\nAll packages and examples have been ${operation}ed!`);
}

main().catch((error) => {
  console.error("Fatal error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
