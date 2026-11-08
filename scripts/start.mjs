// npm start: the built app served by the server, on http://127.0.0.1:4317.
process.env.NODE_ENV = 'production'
await import('../server/index.mjs')
