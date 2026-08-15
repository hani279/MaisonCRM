// Vercel serverless entrypoint — the whole Express app (routes, static
// file serving, everything) runs as one function. vercel.json rewrites
// every request here.
module.exports = require('../server');
