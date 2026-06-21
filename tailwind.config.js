/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./public/**/*.html'],
  theme: {
    extend: {},
  },
  plugins: [],
  safelist: [
    'bg-red-400',
    'bg-amber-400',
    'bg-emerald-400',
    'bg-zinc-900',
    'text-white',
    'shadow-sm',
    'text-zinc-400',
    'hover:text-zinc-800',
    'ring-2',
    'ring-offset-2',
    'scale-105',
    'opacity-80',
    'hover:opacity-100',
    'hover:scale-105',
    'text-emerald-500',
    'hover:text-emerald-500',
    'text-amber-500',
    'hover:text-amber-500',
    {
      pattern: /^(bg|text|border-l|ring)-(pink|blue|emerald|purple)-(100|400|500|600)$/,
    },
  ],
};
