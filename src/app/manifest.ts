import type { MetadataRoute } from "next";

// Lets you add drawory to a phone's home screen and open it full screen, like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "drawory",
    short_name: "drawory",
    description: "An endless canvas you draw on together. Make a room, share the code.",
    start_url: "/",
    display: "standalone",
    background_color: "#F5F5F7",
    theme_color: "#F5F5F7",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
