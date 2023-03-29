module.exports = {
  env: {
    commonjs: true,
    es2021: true,
    node: true,
    mocha: true
  },
  extends: ["eslint:recommended", "prettier"],
  overrides: [],
  parserOptions: {
    ecmaVersion: "latest",
  },
  rules: {
  "no-unused-vars": ["error", { "args": "all", "varsIgnorePattern": "^_", "argsIgnorePattern": "^_" }]
  },
};
