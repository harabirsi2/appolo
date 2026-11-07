import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Appolo — Rate and rank what you love",
    short_name: "Appolo",
    description:
      "Rate movies, TV, music, podcasts, and books head-to-head, get a personalised score, and build your ranked top five.",
    start_url: "/app",
    display: "standalone",
    background_color: "#0a0c10",
    theme_color: "#0a0c10",
    orientation: "portrait",
  };
}
