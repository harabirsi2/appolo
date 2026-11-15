import localFont from "next/font/local";

/**
 * Three committed faces cover the UI: Inter for body text, Fraunces for
 * display headings, and a small subset of Noto Color Emoji for the glyphs the
 * app itself uses. Versions are pinned by the files; builds never fetch fonts.
 *
 * The emoji subset is generated from Noto Color Emoji 2.055
 * (https://github.com/google/fonts/blob/main/ofl/notocoloremoji/NotoColorEmoji-Regular.ttf)
 * with:
 *   pyftsubset NotoColorEmoji-Regular.ttf --unicodes='U+231B,U+25B6,U+2764,U+FE0F,U+1F399,U+1F3AC,U+1F3AE,U+1F3B5,U+1F44F,U+1F4DA,U+1F4FA,U+1F514,U+1F525,U+1F602,U+1F622,U+1F62E' --layout-features='*' --flavor=woff2
 */
const display = localFont({
  src: "./fonts/fraunces-latin.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-fraunces",
});

const sans = localFont({
  src: "./fonts/inter-latin.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-inter",
});

const emoji = localFont({
  src: "./fonts/noto-color-emoji-ui.woff2",
  weight: "400",
  display: "swap",
  preload: false,
  variable: "--font-emoji",
});

export const fontVariables = `${display.variable} ${sans.variable} ${emoji.variable}`;
