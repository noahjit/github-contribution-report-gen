import type Database from "better-sqlite3";
import type {IncomingMessage, ServerResponse} from "node:http";
import type {Context} from "probot";
import {dashboardHtml, dashboardCss, dashboardJs} from "./dashboard-page.js";
import {createDashboardSession, dashboardSession, sessionHash, secret, cookieValue, type DashboardSession} from "./dashboard-auth.js";
import {repositoryWeights, configuredWeights, activityShares} from "./activity-share.js";
import {contributionReport, declarationDraft} from "./reports.js";
import {declarationFields} from "./declaration-fields.js";
import {declarationWord} from "./word.js";
import {publishSnapshot, reportId, recordConfirmation} from "./confirmations.js";

type Options = {base: string; octokit: (id: number) => Promise<Context["octokit"]>; clientId?: string; clientSecret?: string; fetch?: typeof fetch};
class HttpError extends Error {constructor(public status: number, message: string) {super(message);}}
async function jsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {raw += chunk.toString(); if (raw.length > 20_000) throw new HttpError(413, "Request too large.");}
  try {const data = JSON.parse(raw); if (!data || typeof data !== "object" || Array.isArray(data)) throw Error(); return data;}
  catch {throw new HttpError(400, "Expected a JSON object.");}
}
export function dashboardHandler(db: Database.Database, options: Options) {
  const base = new URL(options.base).origin, cookieSecure = base.startsWith("https:") ? "; Secure" : "";
  const oauth = new Map<string, number>();
  const call = options.fetch ?? fetch;
  const cookie = (name: string, value: string, seconds: number) => `${name}=${value}; Path=/dashboard; HttpOnly; SameSite=Lax; Max-Age=${seconds}${cookieSecure}`;
  async function permission(repo: string, session: DashboardSession) {
    const row = db.prepare("SELECT installation_id FROM repository_installation WHERE repo = ? AND active = 1").get(repo) as {installation_id: number} | undefined;
    if (!row) throw new HttpError(404, "Repository is not installed or access has been removed.");
    if (session.kind === "operator") return "admin";
    const [owner, name] = repo.split("/");
    try {
      const client = await options.octokit(row.installation_id);
      const result = await client.rest.repos.getCollaboratorPermissionLevel({owner, repo: name, username: session.login});
      const level = result.data.permission;
      if (!["admin", "write", "read"].includes(level)) throw Error();
      if (!db.prepare("SELECT 1 FROM repository_installation WHERE repo=? AND installation_id=? AND active=1").get(repo,row.installation_id)) throw Error();
      return level;
    } catch {throw new HttpError(403, "You no longer have access to this repository, or GitHub could not verify it.");}
  }
  function dataFor(repo: string, session: DashboardSession, access: string) {
    const prs = db.prepare("SELECT * FROM pull_request WHERE repo = ? ORDER BY number DESC").all(repo) as {number: number; author: string; title: string; merged: number}[];
    const declarations = db.prepare("SELECT id, number, declared_by, details, created_at FROM ai_declaration WHERE repo = ? ORDER BY id DESC").all(repo) as {id:number; number:number; declared_by:string; details:string}[];
    const commits = db.prepare("SELECT author, COUNT(*) AS commits FROM commit_record WHERE repo = ? GROUP BY author").all(repo) as {author:string; commits:number}[];
    const aliases = db.prepare("SELECT email, login FROM identity_alias WHERE repo = ?").all(repo) as {email:string;login:string}[];
    const reviews = db.prepare(`SELECT r.reviewer, COUNT(*) AS reviews FROM review r JOIN pull_request p ON p.repo=r.repo AND p.number=r.pr_number
      WHERE r.repo=? AND r.reviewer != p.author GROUP BY reviewer`).all(repo) as {reviewer:string;reviews:number}[];
    const weights = repositoryWeights(db, repo), body = contributionReport(db, repo);
    const activity = activityShares([
      ...prs.map(p => ({author:p.author, merged:p.merged, commits:0, reviews:0})),
      ...commits.map(c => ({author:aliases.find(a => a.email === c.author.toLowerCase())?.login ?? c.author, merged:0, commits:c.commits, reviews:0})),
      ...reviews.map(r => ({author:r.reviewer, merged:0, commits:0, reviews:r.reviews})),
    ], weights);
    const snapshots = db.prepare("SELECT report_id, number FROM report_snapshot WHERE repo = ? ORDER BY number DESC, rowid DESC LIMIT 30").all(repo) as {report_id:string;number:number}[];
    return {repo, access, canManage: access === "admin", canRespond: session.kind === "github" && ["admin","write"].includes(access),
      canEdit: session.kind === "github" && ["admin","write"].includes(access), weights, activity, report: body, prs,
      declarations: declarations.map(d => ({...d, fields: declarationFields(d.details)})),
      counts:{prs:prs.length, merged:prs.filter(p=>p.merged).length, commits:commits.reduce((n,c)=>n+c.commits,0), reviews:reviews.reduce((n,r)=>n+r.reviews,0), declarations:declarations.length},
      snapshots: snapshots.map(s => ({...s, stale: reportId(repo,s.number,body)!==s.report_id,
        responses: db.prepare("SELECT login, status, reason, updated_at FROM team_confirmation WHERE repo = ? AND report_id = ? ORDER BY login").all(repo,s.report_id)}))};
  }
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? "/", base), path = url.pathname;
    if (path !== "/dashboard" && !path.startsWith("/dashboard/")) return false;
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer"); res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const json = (status: number, data: unknown) => {res.statusCode=status; res.setHeader("Content-Type","application/json; charset=utf-8"); res.end(JSON.stringify(data));};
    try {
      if (req.method === "GET" && ["/dashboard","/dashboard/","/dashboard/app.css","/dashboard/app.js"].includes(path)) {
        const css=path.endsWith(".css"), js=path.endsWith(".js");
        res.setHeader("Content-Type",css?"text/css; charset=utf-8":js?"text/javascript; charset=utf-8":"text/html; charset=utf-8");
        res.end(css?dashboardCss:js?dashboardJs:dashboardHtml); return true;
      }
      if (path === "/dashboard/auth/github" && req.method === "GET") {
        if (!options.clientId || !options.clientSecret) throw new HttpError(503,"GitHub sign-in needs GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET. For local operator access, run npm run dashboard in the project terminal.");
        for (const [key, expiry] of oauth) if (expiry < Date.now()) oauth.delete(key);
        if (oauth.size > 1000) throw new HttpError(429,"Too many sign-in attempts. Try again later.");
        const state=secret(); oauth.set(sessionHash(state), Date.now()+600000);
        res.setHeader("Set-Cookie",cookie("gc_oauth",state,600));
        const target=new URL("https://github.com/login/oauth/authorize");
        target.searchParams.set("client_id",options.clientId); target.searchParams.set("redirect_uri",base+"/dashboard/auth/callback"); target.searchParams.set("state",state);
        res.statusCode=302; res.setHeader("Location",target.href); res.end(); return true;
      }
      if (path === "/dashboard/auth/callback" && req.method === "GET") {
        const state=url.searchParams.get("state")??"", code=url.searchParams.get("code");
        const expiry=oauth.get(sessionHash(state)); oauth.delete(sessionHash(state));
        if (!/^[a-f0-9]{64}$/.test(state) || state !== cookieValue(req,"gc_oauth") || !expiry || expiry < Date.now() || !code || !options.clientId || !options.clientSecret) throw new HttpError(403,"Sign-in expired or invalid. Start again from the dashboard.");
        const tokenResponse=await call("https://github.com/login/oauth/access_token",{method:"POST",headers:{Accept:"application/json","Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:options.clientId,client_secret:options.clientSecret,code,redirect_uri:base+"/dashboard/auth/callback"}),signal:AbortSignal.timeout(15000)});
        const tokenData=await tokenResponse.json() as {access_token?:string};
        if (!tokenResponse.ok || !tokenData.access_token) throw new HttpError(403,"GitHub did not authorize sign-in. Try again.");
        const userResponse=await call("https://api.github.com/user",{headers:{Authorization:`Bearer ${tokenData.access_token}`,Accept:"application/vnd.github+json","User-Agent":"github-contrib-report"},signal:AbortSignal.timeout(15000)});
        const user=await userResponse.json() as {login?:string};
        if (!userResponse.ok || !user.login || !/^[a-z\d-]+$/i.test(user.login)) throw new HttpError(403,"Could not verify your GitHub identity.");
        const session=createDashboardSession(db,user.login.toLowerCase(),"github");
        res.setHeader("Set-Cookie",[cookie("gc_dashboard",session.token,28800),cookie("gc_oauth","",0)]);
        res.statusCode=302; res.setHeader("Location","/dashboard"); res.end(); return true;
      }
      if (req.method !== "GET" && req.headers.origin !== base) throw new HttpError(403,"Request origin is not allowed.");
      if (path === "/dashboard/api/session" && req.method === "POST") {
        const input=await jsonBody(req), token=typeof input.token === "string" ? input.token : "";
        const saved=db.prepare("SELECT * FROM dashboard_session WHERE token_hash = ? AND bootstrap = 1 AND expires_at > ?").get(sessionHash(token),Date.now()) as DashboardSession|undefined;
        if (!saved) throw new HttpError(401,"Operator sign-in link expired or was already used. Run npm run dashboard for a new one.");
        db.prepare("DELETE FROM dashboard_session WHERE token_hash = ?").run(saved.token_hash);
        const session=createDashboardSession(db,saved.login,saved.kind);
        res.setHeader("Set-Cookie",cookie("gc_dashboard",session.token,28800)); json(200,{ok:true}); return true;
      }
      const session=dashboardSession(db,req);
      if (path === "/dashboard/api/session" && req.method === "GET") {json(200,{authenticated:!!session, login:session?.login, kind:session?.kind, csrf:session?.csrf, githubSignIn:!!options.clientId&&!!options.clientSecret}); return true;}
      if (!session) throw new HttpError(401,"Sign in to view repository data.");
      if (req.method !== "GET" && req.headers["x-csrf-token"] !== session.csrf) throw new HttpError(403,"Your session changed. Refresh before saving.");
      if (path === "/dashboard/api/logout" && req.method === "POST") {
        db.prepare("DELETE FROM dashboard_session WHERE token_hash = ?").run(session.token_hash); res.setHeader("Set-Cookie",cookie("gc_dashboard","",0)); json(200,{ok:true}); return true;
      }
      if (path === "/dashboard/api/repos" && req.method === "GET") {
        const rows=db.prepare("SELECT repo FROM repository_installation WHERE active = 1 ORDER BY repo").all() as {repo:string}[];
        const accessible: string[]=[];
        for (const row of rows) {try {await permission(row.repo,session); accessible.push(row.repo);} catch { /* fail closed */ }}
        json(200,{repos:accessible}); return true;
      }
      const repo=url.searchParams.get("repo")??"";
      if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new HttpError(400,"Choose a repository.");
      const access=await permission(repo,session);
      if (path === "/dashboard/api/data" && req.method === "GET") {json(200,dataFor(repo,session,access)); return true;}
      const input = req.method === "POST" ? await jsonBody(req) : {};
      if (path === "/dashboard/api/weights" && req.method === "POST") {
        if (access!=="admin") throw new HttpError(403,"Only repository admins can change weights.");
        if (input.reset === true) db.prepare("DELETE FROM repository_weights WHERE repo = ?").run(repo);
        else {
          if (!Array.isArray(input.weights) || input.weights.some(v=>typeof v!=="number")) throw new HttpError(400,"Supply three numerical weights.");
          let weights; try {weights=configuredWeights(input.weights.join(","));} catch {throw new HttpError(400,"Use three nonnegative weights with at least one positive value.");}
          db.prepare("INSERT OR REPLACE INTO repository_weights VALUES (?, ?)").run(repo,weights.join(","));
        }
        json(200,{ok:true}); return true;
      }
      if (path === "/dashboard/api/declaration" && req.method === "POST") {
        if (session.kind!=="github" || !["write","admin"].includes(access)) throw new HttpError(403,"Sign in with your GitHub account and repository write access to edit your own declarations.");
        if (!Number.isSafeInteger(input.id) || typeof input.details!=="string" || !input.details.trim() || input.details.length>4000) throw new HttpError(400,"Provide an entry ID and 1–4000 characters of details.");
        const result = db.prepare("UPDATE ai_declaration SET details = ? WHERE repo = ? AND id = ? AND lower(declared_by) = ?").run(input.details.trim(),repo,input.id,session.login.toLowerCase());
        if (!result.changes) throw new HttpError(404,"Your declaration entry was not found.");
        db.prepare("DELETE FROM declaration_download WHERE repo = ?").run(repo); json(200,{ok:true}); return true;
      }
      if (path === "/dashboard/api/word" && req.method === "POST") {
        const login=session.kind==="operator" && typeof input.login==="string" ? input.login : session.login;
        if (!login || login==="Local operator") throw new HttpError(400,"Select the declaration author to export.");
        const bytes=await declarationWord(declarationDraft(db,repo,login,input.bounded===true));
        res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.wordprocessingml.document"); res.setHeader("Content-Disposition",'attachment; filename="ai-declaration.docx"'); res.end(bytes); return true;
      }
      if (path === "/dashboard/api/snapshot" && req.method === "POST") {
        if (access!=="admin" && access!=="write") throw new HttpError(403,"Repository write access is required.");
        if (!Number.isSafeInteger(input.number) || !db.prepare("SELECT 1 FROM pull_request WHERE repo=? AND number=?").get(repo,input.number)) throw new HttpError(400,"Select a tracked PR.");
        const snapshot=publishSnapshot(db,repo,input.number as number); json(200,{id:snapshot.id}); return true;
      }
      if (path === "/dashboard/api/response" && req.method === "POST") {
        if (session.kind!=="github" || !["admin","write"].includes(access)) throw new HttpError(403,"Use GitHub sign-in to confirm or flag a report as yourself.");
        if (!Number.isSafeInteger(input.number) || typeof input.id!=="string" || !/^[a-f0-9]{16}$/.test(input.id) || !["confirmed","flagged"].includes(String(input.status))) throw new HttpError(400,"Choose a report and response.");
        const reason=typeof input.reason==="string"?input.reason.trim():"";
        if (input.status==="flagged" && (!reason || reason.length>1000)) throw new HttpError(400,"Include a reason of up to 1000 characters.");
        const message=recordConfirmation(db,repo,input.number as number,input.id,session.login,input.status as "confirmed"|"flagged",reason);
        if (!message.startsWith("Your ")) throw new HttpError(409,message);
        json(200,{ok:true}); return true;
      }
      throw new HttpError(404,"Dashboard route not found.");
    } catch (error) {
      json(error instanceof HttpError?error.status:500,{error:error instanceof HttpError?error.message:"Something went wrong. Try again or check the operator logs."}); return true;
    }
  };
}
