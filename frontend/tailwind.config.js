/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    "*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      keyframes: {
        "fade-in": {
          "0%": { opacity: 0 },
          "100%": { opacity: 1 },
        },
        "slide-up": {
          // ⚠️ translate3d med ikke-null Z (0.0001px) er kritisk. Med Z=0
          // optimerer browseren transformen til 2D-matrix og forhindrer
          // GPU-layer-promotion i Safari/WebKit — uten eget compositing-
          // layer rendres ikke backdrop-filter på glass-kort. Chrome
          // promoter automatisk; Safari krever 3D-hint med faktisk Z.
          // Verifisert via Safari Web Inspector Layers-panel 2026-05-18.
          // Se D-022. NB: globals.css har også en regel for ALLE
          // backdrop-blur-elementer som ikke er avhengig av denne anim.
          "0%": { opacity: 0, transform: "translate3d(0, 8px, 0.0001px)" },
          "100%": { opacity: 1, transform: "translate3d(0, 0, 0.0001px)" },
        },
        "slide-in-right": {
          // D-066: side-panel glir inn fra høyre. Z-hint per D-022 for
          // backdrop-blur kompatibilitet.
          "0%": { opacity: 0, transform: "translate3d(24px, 0, 0.0001px)" },
          "100%": { opacity: 1, transform: "translate3d(0, 0, 0.0001px)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.4s ease-out forwards",
        "slide-up": "slide-up 0.35s ease-out forwards",
        "slide-in-right": "slide-in-right 0.28s ease-out forwards",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
