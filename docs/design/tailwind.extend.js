// Add this object to theme.extend in tailwind.config.js.

module.exports = {
  colors: {
    charcoal: "#181818",
    blacktop: "#111111",
    fieldGreen: "#193C30",
    paper: "#DAD4CE",
    paperWarm: "#D2CCC6",
    cream: "#EFE7D8",
    ink: "#1B1A1A",
    mutedInk: "#5F5B55",
    chalk: "#E6DED2",
    brandRed: "#C2442D",
    brandRedDark: "#7A3629",
    brandOrange: "#E58541",
    brandGreen: "#0E5A3E",
    softGreen: "#315045"
  },
  borderRadius: {
    sm: "10px",
    md: "14px",
    lg: "22px",
    xl: "28px",
    pill: "999px"
  },
  fontFamily: {
    display: ["var(--font-display)"],
    sans: ["var(--font-sans)"],
    mono: ["var(--font-mono)"]
  },
  boxShadow: {
    paper: "0 12px 40px rgba(0,0,0,0.18)",
    lift: "0 8px 24px rgba(0,0,0,0.16)",
    cutoutRed: "10px 10px 0 #C2442D"
  },
  backgroundImage: {
    "dark-grid": "linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)",
    "paper-grid": "linear-gradient(rgba(0,0,0,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.08) 1px, transparent 1px)",
    "green-grid": "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)"
  },
  backgroundSize: {
    grid: "32px 32px",
    paperGrid: "34px 34px"
  }
};
