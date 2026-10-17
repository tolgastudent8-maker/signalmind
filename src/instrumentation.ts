export async function register() {
  // Serverless hosts (Vercel) freeze idle functions, so a background loop cannot run there;
  // feeds are refreshed on demand instead (scheduler.ensureFeeds from the news/Guard routes).
  if (process.env.NEXT_RUNTIME === "nodejs" && !process.env.VERCEL) {
    const { startScheduler } = await import("./lib/scheduler.ts");
    startScheduler();
  }
}
