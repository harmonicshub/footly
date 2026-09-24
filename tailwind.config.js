/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./*.{js,ts,jsx,tsx}",          // root-level files like footly-v6.jsx
    "./admin-console.jsx",
  ],

  theme: {
    extend: {
      colors: {
        // Brand
        accent: {
          DEFAULT: "#D9480F",
          ink:     "#9C340B",
          wash:    "#FDF0E9",
        },
        // Money / winnings — kept separate from brand so selected buttons
        // never read as payouts
        money: {
          DEFAULT: "#067647",
          wash:    "#E7F5EE",
        },
        // Live indicator — neutral so it never competes with orange buttons
        live: {
          DEFAULT: "#1F2A37",
          dot:     "#F04438",
        },
        // Neutrals (warm cast — cool greys look muddy under orange)
        surface:   "#FFFFFF",
        raised:    "#F1F0ED",
        line:      "#E4E2DE",
        linesoft:  "#EFEEEB",
        bg:        "#F8F7F5",
        dim:       "#5A524E",
        muted:     "#8A827D",
      },

      fontFamily: {
        display: ["'Plus Jakarta Sans'", "system-ui", "sans-serif"],
        body:    ["'Inter'", "system-ui", "-apple-system", "sans-serif"],
        mono:    ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },

      borderRadius: {
        "2xl": "16px",
        "3xl": "24px",
      },

      keyframes: {
        livepulse: {
          "0%, 100%": { opacity: "1" },
          "50%":       { opacity: "0.25" },
        },
        slideup: {
          from: { opacity: "0", transform: "translateY(12px)" },
          to:   { opacity: "1", transform: "none" },
        },
      },

      animation: {
        livepulse: "livepulse 1.4s ease-in-out infinite",
        slideup:   "slideup 0.22s cubic-bezier(.2,.7,.3,1)",
      },
    },
  },

  plugins: [],
};
