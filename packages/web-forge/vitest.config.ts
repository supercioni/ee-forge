import { defineConfig } from "vitest/config";

// The contrast test reads the stylesheet as text (`index.css?raw`); without this vitest stubs every CSS import to "".
export default defineConfig({ test: { css: true } });
