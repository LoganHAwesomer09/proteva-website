import js from '@eslint/js';
import globals from 'globals';
export default [
  { ignores:['node_modules/**','dist/**','test-results/**','playwright-report/**'] },
  js.configs.recommended,
  { files:['assets/*.js'], languageOptions:{globals:globals.browser} },
  { files:['api/*.js','lib/*.js','scripts/*.mjs','tests/**','*.config.*'], languageOptions:{globals:{...globals.node,...globals.browser}} }
];
