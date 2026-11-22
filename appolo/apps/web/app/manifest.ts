import type { MetadataRoute } from "next";

/**
 * Installable web app manifest.
 *
 * `display: standalone` is the whole point: installed from the home screen the
 * app opens without browser chrome, so the only difference from the old native
 * client is the address bar before install. The colours match the dark
 * editorial shell (`--color-bg` #07080A, brand #10B981) so the splash and the
 * status bar do not flash white on launch.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Appolo — compare, don't score",
    short_name: "Appolo",
    description:
      "Rank what you love by picking the better of two titles. Movies, TV, music, podcasts, books and games, one tap at a time.",
    start_url: "/app?source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    background_color: "#07080A",
    theme_color: "#07080A",
    lang: "en",
    dir: "ltr",
    categories: ["entertainment", "lifestyle"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Rate something",
        short_name: "Rate",
        description: "Start a head-to-head comparison",
        url: "/app/rate",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Search the catalog",
        short_name: "Search",
        description: "Find a title to rank",
        url: "/app/search",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
