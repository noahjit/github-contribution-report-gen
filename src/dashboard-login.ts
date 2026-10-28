import {openDatabase} from "./db.js";
import {createDashboardSession} from "./dashboard-auth.js";
import {downloadBase} from "./downloads.js";
const db = openDatabase();
try {
  const base = downloadBase() ?? "http://localhost:3000";
  const {token} = createDashboardSession(db, "Local operator", "operator", true);
  console.log("Private operator sign-in link (valid for 10 minutes, single use). Keep it out of repository comments:");
  console.log(`${base}/dashboard#session=${token}`);
} finally {db.close();}
