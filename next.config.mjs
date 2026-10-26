/** @type {import('next').NextConfig} */
const config = {
  output: "export",
  distDir: process.env.LIFEOS_BUILD_DIR || ".next",
  trailingSlash: true,
  devIndicators: false,
};
export default config;
