import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    ignores: ["dist/**", "node_modules/**", "plugins/*/dist/**"],
  },
  {
    files: [
      "src/**/*.{ts,tsx}",
      "extensions/**/*.ts",
      "pi-web-plugins/**/*.{ts,tsx}",
      "plugins/**/*.ts",
      "vite.config.ts",
      "vitest.config.ts",
    ],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        // The plugin tree is its own project: a plugin's `.tsx` compiles against the host's published
        // JSX runtime, and a type-checked rule reading it outside that project reports the JSX as `any`.
        project: ["./tsconfig.json", "./tsconfig.plugins.json"],
        tsconfigRootDir: import.meta.dirname,
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/strict-boolean-expressions": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/restrict-template-expressions": "error",
      "@typescript-eslint/restrict-plus-operands": "error",
    },
  },
  {
    // JSX spells an event handler as an arrow whose body is a void call — `onClick={() => close()}` —
    // and React's handler type returns void, so the arrow's value is never read. The rule's own
    // accommodation for that shorthand is `ignoreArrowShorthand`; the check that matters, an `if` on a
    // void call, stays on. Scoped to components, so a `.ts` file is still checked as before.
    files: ["src/**/*.tsx", "pi-web-plugins/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
    },
  },
  {
    files: ["src/**/*.tsx", "pi-web-plugins/**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      // A React component is where a stale closure lives: a callback that captured last render's
      // machine, project, session, or registry and fires on it later. `exhaustive-deps` names it, and
      // it is an error here because every plugin host and the whole React workbench is in this repo.
      "react-hooks/exhaustive-deps": "error",
    },
  },
]);
