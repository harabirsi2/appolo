// ESLint for the monorepo.
//
// Typescript-eslint "strict" (the step above recommended) is the base: this
// codebase leans on `unknown` at its boundaries (HTTP bodies, provider JSON,
// postgres rows) and strict keeps that honest. React hooks rules and jsx-a11y
// apply to the web app only.
//
// Rules are switched off only where the rule fights a deliberate decision, and
// each one says why. A disable without a reason is a bug in this file.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/*.d.ts",
      "packages/db/drizzle/**",
      "scripts/visual-output/**",
      "scripts/visual-baselines/**",
      "scripts/visual-baselines-local/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strict,

  {
    files: ["**/*.{ts,tsx,mjs,js}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    },
    rules: {
      // The codebase's row-access idiom is `rows[0]!` after an explicit
      // emptiness check; without the assertion every query would need a cast
      // that hides the same assumption in a less readable way.
      "@typescript-eslint/no-non-null-assertion": "off",

      // `any` appears only at provider/JSON boundaries where the shape is
      // genuinely unknown until parsed; each use is narrowed immediately.
      "@typescript-eslint/no-explicit-any": "off",

      // Empty interfaces/types model open-ended jsonb columns
      // (`Record<string, never>` on a fresh row).
      "@typescript-eslint/no-empty-object-type": "off",

      // LRU-style cache eviction deletes by computed key.
      "@typescript-eslint/no-dynamic-delete": "off",

      // Next.js route handlers take unused positional parameters
      // (`_request`) and the convention is an underscore prefix.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],

      // CLI scripts and the worker print progress by design; the app logs
      // warnings on degraded paths (push delivery, model refresh).
      "no-console": "off",
    },
  },

  {
    // The web app: hooks correctness and the accessibility rules that axe
    // cannot catch statically.
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "jsx-a11y": jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,

      // Deliberate: several effects intentionally depend on a stable ref or
      // run once on mount while reading state the rule would demand. Those
      // lists are documented at each site; obeying the rule here caused
      // re-subscription loops (service worker message listeners, swipe handlers).
      "react-hooks/exhaustive-deps": "off",

      // The app renders icon buttons whose accessible name comes from a
      // wrapping <a aria-label> or a sibling label element.
      "jsx-a11y/control-has-associated-label": "off",

      // Custom components (`<MediaArt>`, `<KindIcon>`) take the text as props;
      // the rule only understands DOM labels.
      "jsx-a11y/label-has-associated-control": "off",
    },
  },

  {
    // Plain scripts are Node programs, not app code: they may use
    // process.exit, top-level await and CommonJS-style requires.
    files: ["scripts/**/*.{mjs,js}"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "no-process-exit": "off",
    },
  },
);
