module.exports = {
    "env": {
        "browser": true,
        "commonjs": true,
        "es2021": true,
        "mocha": true,
    },
    "extends": "eslint:recommended",
    "overrides": [
    ],
    "parserOptions": {
        "ecmaVersion": "latest"
    },
    "rules": {
      "no-unused-vars": ["error", { "args": "all", "varsIgnorePattern": "^_", "argsIgnorePattern": "^_" }],
      "semi": [2, "always"],
    }
};
