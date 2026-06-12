# Max Plan

Todo-застосунок з AI Capture, проєктами, пріоритетами.

## Деплой на Vercel (3 хвилини)

1. Зайди на [vercel.com](https://vercel.com) → увійди через GitHub
2. Натисни **Add New → Project**
3. Перетягни цю папку або завантаж через GitHub
4. Натисни **Deploy** — готово!

## Локальний запуск

```bash
npm install
npm run dev
```

## Примітка про AI Capture

AI Capture використовує Anthropic API. Для роботи потрібен API ключ.
Додай у `.env`:
```
VITE_ANTHROPIC_API_KEY=your_key_here
```
І в App.jsx замінити заголовки fetch на:
```js
"x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY,
"anthropic-version": "2023-06-01",
```
