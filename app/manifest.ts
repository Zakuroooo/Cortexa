import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cortexa — Your AI Second Brain",
    short_name: "Cortexa",
    description:
      "Chat with your documents with citations, plus an autonomous research agent.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#0a0a0b",
    theme_color: "#0a0a0b",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
