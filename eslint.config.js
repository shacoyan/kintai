// Minimal ESLint flat config — scoped intentionally to ONE bug class:
// React "rules of hooks" violations (e.g. a hook called after an early return),
// which caused a production outage. We deliberately do NOT enable broad rulesets
// (no @typescript-eslint/recommended, react/recommended, airbnb) to avoid burying
// the signal under thousands of unrelated warnings.
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "**/*.config.*"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      // Non-type-aware parse is enough for rules-of-hooks; we skip
      // project/project-service on purpose (type-checked linting is slow + noisy).
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      // Registered ONLY so the codebase's pre-existing inline
      // `eslint-disable @typescript-eslint/*` directives resolve to a known
      // rule. We enable NONE of its rules — the active ruleset stays limited
      // to the two react-hooks rules below.
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
