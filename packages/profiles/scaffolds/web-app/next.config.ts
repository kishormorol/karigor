import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client"],
  // Forms send files of up to 4 MB (MAX_UPLOAD_BYTES); server actions take 1 MB unless told otherwise.
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
};

export default nextConfig;
