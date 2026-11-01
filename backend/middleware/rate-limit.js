// Single-process limiter. Use a shared store before deploying multiple instances.
const buckets = new Map();
const timer = setInterval(() => {
 const now = Date.now();
 for (const [key, value] of buckets) if (value.until <= now) buckets.delete(key);
}, 60000);
timer.unref();
module.exports = function rateLimit(req, res, next) {
 const key = req.ip;
 let b = buckets.get(key);
 if (!b || b.until <= Date.now()) {
   if (buckets.size >= 10000) return res.status(429).json({ message: "Please try again later" });
   b = { count: 0, until: Date.now() + 15 * 60000 }; buckets.set(key, b);
 }
 if (++b.count > 50) { res.set("Retry-After", String(Math.ceil((b.until-Date.now())/1000))); return res.status(429).json({ message: "Too many attempts. Try later." }); }
 next();
};
