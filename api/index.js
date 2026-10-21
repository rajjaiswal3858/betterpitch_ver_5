// Vercel function: every request is rewritten here (vercel.json) and served by
// the same handler `npm start` uses locally.
module.exports = require('../server.js').handler;
