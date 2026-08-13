// @ts-nocheck
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import jsxA11yPlugin from "eslint-plugin-jsx-a11y";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import regexpPlugin from "eslint-plugin-regexp";
import { defineConfig } from "eslint/config";
import globals from "globals";

export default defineConfig(
  {
    ignores: ["**/dist", "**/storybook-static", "**/node_modules"],
  },
  {
    files: ["{packages,providers,examples}/**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.es2020,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
      "jsx-a11y": jsxA11yPlugin,
      regexp: regexpPlugin,
    },
    settings: {
      react: {
        version: "19.0",
      },
    },
    rules: {
      ...tsPlugin.configs["recommended"].rules,
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...jsxA11yPlugin.configs.recommended.rules,
      ...regexpPlugin.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "react/react-in-jsx-scope": "off",
      // `disallowTypeAnnotations` must stay off: inline `import()` types are how
      // optional peer dependencies are typed here (e.g. `typeof import("pg")`)
      // without forcing a static import that would break consumers who have not
      // installed the package. Turning it on flags those deliberate annotations,
      // and they are not autofixable.
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "separate-type-imports",
          disallowTypeAnnotations: false,
        },
      ],
    },
  },
  {
    // `*_JobRunFns.ts` files execute inside workers, which have an isolated
    // runtime with their own `globalServiceRegistry`. Importing main-thread-only
    // state (the global service registry or credential stores) resolves against a
    // different, empty registry at runtime. Resolve such state in the task class on
    // the main thread and pass it through the serialized job input instead.
    files: ["**/*_JobRunFns.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@workglow/util",
              importNames: [
                "globalServiceRegistry",
                "getGlobalCredentialStore",
                "setGlobalCredentialStore",
              ],
              message:
                "Main-thread-only state is unavailable in workers. Resolve it in the task class (e.g. AiTask.getJobInput()) and pass it through the serialized job input.",
            },
            {
              name: "@workglow/util/worker",
              importNames: ["globalServiceRegistry"],
              message:
                "Main-thread-only state is unavailable in workers. Resolve it in the task class (e.g. AiTask.getJobInput()) and pass it through the serialized job input.",
            },
            // Blocked WHOLESALE rather than by importNames: every export of
            // this package registers services into the global registry, so a
            // name list would be the whole surface and would drift the moment
            // one was added.
            {
              name: "@workglow/bootstrap",
              message:
                "A run-fn executes in a worker with its own globalServiceRegistry, so bootstrapWorkglow mutates a registry the main thread never sees. Resolve the services in the task class (e.g. AiTask.getJobInput()) and pass them through the serialized job input.",
            },
            {
              name: "workglow/bootstrap",
              message:
                "A run-fn executes in a worker with its own globalServiceRegistry, so bootstrapWorkglow mutates a registry the main thread never sees. Resolve the services in the task class (e.g. AiTask.getJobInput()) and pass them through the serialized job input.",
            },
          ],
        },
      ],
    },
  },
  {
    // Provider `src/ai/common/**` files are re-exported from each provider's
    // `runtime.ts`, so they are evaluated inside worker bundles.
    // `@workglow/ai/worker` exists to keep the 50+ task classes out of those
    // bundles; the effort helpers below resolve identically from it.
    //
    // Restricted by NAME rather than by path: several files in this directory
    // legitimately import error classes and task types the worker barrel does
    // not re-export yet, and a path-wide restriction would only buy a wall of
    // eslint-disable comments. `allowTypeImports` keeps `import type
    // { ModelEffort } from "@workglow/ai"` legal, which matters because those
    // types sit beside every one of these value imports.
    files: ["providers/*/src/ai/common/**/*.ts"],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@workglow/ai",
              importNames: [
                "MODEL_EFFORTS",
                "isModelEffort",
                "sanitizeEffortOptions",
                "readEffortOptions",
                "stampEffortOptions",
                "enabledEffortsForModel",
                "effortPlaceholder",
              ],
              allowTypeImports: true,
              message:
                "Import effort helpers from @workglow/ai/worker. The root barrel " +
                "pulls all task classes and a second copy of AiProviderRegistry / " +
                "CheckpointRegistry into the worker bundle.",
            },
          ],
        },
      ],
    },
  }
);
