import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config";

export default defineConfig({
  headLinkOptions: {
    preset: "2023",
  },
  preset: {
    ...minimal2023Preset,
    apple: {
      ...minimal2023Preset.apple,
      backgroundColor: "#1e2b2d",
      padding: 0.2,
    },
    appleSplashScreens: {
      padding: 0.3,
      resizeOptions: { background: "#1e2b2d", fit: "contain" },
      darkResizeOptions: { background: "#1e2b2d", fit: "contain" },
      linkMediaOptions: {
        log: true,
        addMediaScreen: true,
        xhtml: false,
        includeId: false,
      },
      sizes: [
        {
          width: 2048,
          height: 2732,
          scaleFactor: 2,
        },
        {
          width: 1668,
          height: 2388,
          scaleFactor: 2,
        },
        {
          width: 1640,
          height: 2360,
          scaleFactor: 2,
        },
        {
          width: 1488,
          height: 2266,
          scaleFactor: 2,
        },
        {
          width: 1620,
          height: 2160,
          scaleFactor: 2,
        },
        {
          width: 1320,
          height: 2868,
          scaleFactor: 3,
        },
        {
          width: 1206,
          height: 2622,
          scaleFactor: 3,
        },
        {
          width: 1290,
          height: 2796,
          scaleFactor: 3,
        },
        {
          width: 1179,
          height: 2556,
          scaleFactor: 3,
        },
        {
          width: 1284,
          height: 2778,
          scaleFactor: 3,
        },
        {
          width: 1170,
          height: 2532,
          scaleFactor: 3,
        },
        {
          width: 1242,
          height: 2688,
          scaleFactor: 3,
        },
        {
          width: 828,
          height: 1792,
          scaleFactor: 2,
        },
        {
          width: 1125,
          height: 2436,
          scaleFactor: 3,
        },
        {
          width: 1242,
          height: 2208,
          scaleFactor: 3,
        },
        {
          width: 750,
          height: 1334,
          scaleFactor: 2,
        },
      ],
    },
    maskable: {
      ...minimal2023Preset.maskable,
      backgroundColor: "#7a1121",
      padding: 0.25,
    },
    transparent: {
      ...minimal2023Preset.transparent,
      sizes: [192, 512],
      padding: 0.05,
    },
  },
  images: ["public/playon-logo.png"],
});
