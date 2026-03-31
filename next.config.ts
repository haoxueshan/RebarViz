import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === 'production';
const isNetlify = !!process.env.NETLIFY;
const isVercel  = !!process.env.VERCEL;

// basePath only needed for GitHub Pages (non-Netlify, non-Vercel prod)
const basePath = isProd && !isNetlify && !isVercel ? '/RebarViz' : '';

// Static export only for GitHub Pages; Vercel & Netlify serve full Next.js
const staticExport = isProd && !isNetlify && !isVercel;

const nextConfig: NextConfig = {
  ...(staticExport ? { output: 'export' } : {}),
  basePath,
  assetPrefix: basePath,
  images: { unoptimized: true },
  reactCompiler: true,
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
};

export default nextConfig;
