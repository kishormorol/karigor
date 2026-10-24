import type { MetadataRoute } from "next";
import { APP_NAME, APP_TAGLINE } from "@/lib/app";

/** Lets people add the app to their phone's home screen and open it like an installed app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_TAGLINE,
    start_url: "/",
    display: "standalone",
    background_color: "#f5f6f4",
    theme_color: "#0e5e55",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
