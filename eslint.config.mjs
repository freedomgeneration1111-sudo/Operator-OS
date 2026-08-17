import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({baseDirectory:import.meta.dirname});
export default [
  ...compat.extends("next/core-web-vitals","next/typescript"),
  {ignores:["node_modules/**","staff-app/dist/**","worker-configuration.d.ts"]},
  {rules:{"@next/next/no-html-link-for-pages":"off"}},
  {files:["staff-app/**/*.{ts,tsx}"],rules:{"@next/next/no-img-element":"off"}},
];
