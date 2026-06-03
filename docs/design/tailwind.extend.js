// Add this object to theme.extend in tailwind.config.js.

module.exports = {
  colors: {
    ink: "#050505",
    charcoal: "#171411",
    espresso: "#21170F",
    paper: "#F7F3EA",
    warmWhite: "#FFFCF5",
    mist: "#ECEBE7",
    gridLine: "#D8D3C8",
    taupe: "#918A7C",
    clay: "#D65A2B",
    saffron: "#E5B72E",
    coffee: "#9B6436",
    cream: "#E7D0AE",
    leaf: "#405733",
    deepBlue: "#223D66",
    error: "#9E2F1C",
    success: "#405733"
  },
  spacing: {
    1: "4px",
    2: "8px",
    3: "12px",
    4: "16px",
    5: "24px",
    6: "32px",
    7: "48px",
    8: "64px",
    9: "80px",
    10: "96px",
    11: "128px",
    12: "160px",
    13: "192px",
    14: "240px"
  },
  borderRadius: {
    none: "0",
    xs: "4px",
    sm: "8px",
    md: "12px",
    lg: "16px",
    full: "999px"
  },
  fontFamily: {
    display: ["var(--font-display)"],
    displayItalic: ["var(--font-display-italic)"],
    sans: ["var(--font-sans)"],
    script: ["var(--font-script)"]
  },
  boxShadow: {
    none: "none",
    soft: "0 18px 40px rgba(5,5,5,0.10)",
    modal: "0 28px 80px rgba(5,5,5,0.28)"
  },
  backgroundImage: {
    "editorial-grid": "linear-gradient(to right, rgba(216,211,200,0.62) 1px, transparent 1px), linear-gradient(to bottom, rgba(216,211,200,0.42) 1px, transparent 1px)",
    "dark-editorial-grid": "linear-gradient(to right, rgba(255,252,245,0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,252,245,0.10) 1px, transparent 1px)"
  },
  backgroundSize: {
    editorialGrid: "32px 96px",
    microGrid: "32px 32px"
  }
};
