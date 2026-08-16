/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require('../../shared/tailwind.preset.js')],
  theme: {
    extend: {},
  },
  plugins: [],
}
