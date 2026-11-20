// @ts-check
import withNuxt from "./.nuxt/eslint.config.mjs";

export default withNuxt(
  { ignores: [".output/**", ".nuxt/**", "playwright-report/**", "test-results/**", "server/generated/**", "app/components/ui/**", "dist/**", "assets-src/**"] },
  {
    rules: {
      // Formatting is not enforced; correctness rules are.
      // `({ accountId, ...rest }) => rest` (leave one field out) is an intended pattern; `_name` marks an unused argument.
      // (the base rule for plain JS, the TypeScript rule for .ts and .vue: the base rule misreads TypeScript signatures)
      "no-unused-vars": ["error", { varsIgnorePattern: "^_", argsIgnorePattern: "^_", ignoreRestSiblings: true }],
      "@typescript-eslint/no-unused-vars": ["error", { varsIgnorePattern: "^_", argsIgnorePattern: "^_", ignoreRestSiblings: true }],
      "vue/html-self-closing": "off",
      "vue/singleline-html-element-content-newline": "off",
      "vue/max-attributes-per-line": "off",
      "vue/multi-word-component-names": "off",
      "vue/html-indent": "off",
      "vue/html-closing-bracket-newline": "off",
      "vue/first-attribute-linebreak": "off",
      "vue/attributes-order": "off",
      "vue/require-default-prop": "off",
      "vue/block-order": "off",
    },
  },
  {
    files: ["**/*.ts", "**/*.vue"],
    rules: { "no-unused-vars": "off" },
  },
);
