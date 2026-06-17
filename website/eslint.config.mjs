import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// GUARD — Tailwind v4 named-scale collapse.
// This project's @theme (app/globals.css) defines a custom --spacing-* scale but
// NOT the container / shadow scales. So `max-w-sm`/`max-w-lg` resolve against the
// spacing scale (8px / 24px — render-verified) and `shadow-md`/`shadow-lg` produce
// no shadow. Bitten 3× (max-w-lg, shadow-md, max-w-sm). Use arbitrary values
// (`max-w-[22rem]`) or inline styles instead.
// The regex matches both plain string classNames (Literal) and the static chunks
// of template-literal classNames (TemplateElement). Arbitrary `max-w-[..]` /
// `shadow-[..]` and keyword scales (`max-w-full|none|screen|fit`) are allowed.
const NAMED_SCALE_RE =
  '(?<!\\w)(?<!-)(?:(?:max-w|min-w|max-h|min-h)-(?:xs|sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|prose)|shadow-(?:sm|md|lg|xl|2xl|inner))(?!\\w)';
const NAMED_SCALE_MSG =
  'Tailwind v4 named scale collapses in this theme (no container/shadow scale configured): named max-w-*/min-w-*/max-h-*/shadow-* resolve to tiny spacing values or no shadow. Use an arbitrary value like max-w-[22rem] or an inline style.';
const noNamedScales = {
  files: ['**/*.{ts,tsx}'],
  rules: {
    'no-restricted-syntax': [
      'error',
      { selector: `Literal[value=/${NAMED_SCALE_RE}/]`, message: NAMED_SCALE_MSG },
      { selector: `TemplateElement[value.cooked=/${NAMED_SCALE_RE}/]`, message: NAMED_SCALE_MSG },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  noNamedScales,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),
]);

export default eslintConfig;
