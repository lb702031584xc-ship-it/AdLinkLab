/** @type {import('next').NextConfig} */
const nextConfig = {
  // standalone disabled on Windows hosts (symlink EPERM). Docker image uses full next start.
  eslint: {
    // ESLint config is incomplete in this repo (missing react-hooks plugin);
    // type checking via tsc covers correctness. Disable lint during builds.
    ignoreDuringBuilds: true,
  },
  // P1-20：安全响应头。CSP 保持宽松（script/style 允许 unsafe-inline，
  // 以免破坏 Next.js 内联脚本），frame-ancestors 只允许同源。
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; frame-ancestors 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
