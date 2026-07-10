// Tailwind v4 — single PostCSS plugin handles everything (no @tailwind directives,
// no autoprefixer config; Tailwind 4 covers vendor prefixing internally).
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
