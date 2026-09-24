/** @type {import('next').NextConfig} */
const nextConfig = {
  // Expose only the variables the browser actually needs.
  // Server-side secrets (DB, Redis, PSP keys) are never listed here.
  env: {
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
  },

  images: {
    // Add CDN domains here when you serve team crests or promo images.
    remotePatterns: [],
  },

  // Odds updates come in fast — keep the default 30 s revalidation
  // for static pages; dynamic routes handle their own caching.
  experimental: {
    serverComponentsExternalPackages: ["pg", "redis"],
  },

  // Redirect bare /admin to /admin/dashboard
  async redirects() {
    return [
      {
        source: "/admin",
        destination: "/admin/dashboard",
        permanent: false,
      },
    ];
  },

  // Strip X-Powered-By, add basic security headers
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
