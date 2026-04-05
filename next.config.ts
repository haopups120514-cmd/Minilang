import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@supabase/supabase-js",
    "@supabase/postgrest-js",
    "@supabase/realtime-js",
    "@supabase/auth-js",
    "@supabase/storage-js",
    "@supabase/functions-js",
  ],
  experimental: {
    browsersListForSwc: true,
  },
};

export default nextConfig;
