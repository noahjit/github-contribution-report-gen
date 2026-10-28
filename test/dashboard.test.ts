import {createServer, type Server} from "node:http";
import {Script} from "node:vm";
import {afterEach, beforeEach, expect, test, vi} from "vitest";
import JSZip from "jszip";
import {openDatabase, deleteRepository} from "../src/db.js";
import {dashboardHandler} from "../src/dashboard.js";
import {createDashboardSession} from "../src/dashboard-auth.js";
import {dashboardJs} from "../src/dashboard-page.js";
import {Probot, Server as ProbotServer} from "probot";
import application from "../src/index.js";

let db: ReturnType<typeof openDatabase>, server: Server, base: string;
let handler: ReturnType<typeof dashboardHandler>, permission: ReturnType<typeof vi.fn>, oauthFetch: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  db=openDatabase(":memory:");
  db.exec(`INSERT INTO repository_installation VALUES ('team/project',2,1),('team/removed',2,0);
    INSERT INTO pull_request VALUES ('team/project',1,'alice','Validation tests','closed',1,NULL);
    INSERT INTO ai_declaration(repo,number,declared_by,details,source) VALUES
      ('team/project',1,'alice','Tool: Codex\nPurpose: ALICE_ONLY','command'),
      ('team/project',1,'bob','Tool: Claude\nPurpose: BOB_ONLY','command');`);
  permission=vi.fn().mockResolvedValue({data:{permission:"admin"}});
  oauthFetch=vi.fn();
  server=createServer((req,res)=>{void handler(req,res).then(handled=>{if(!handled){res.statusCode=404;res.end();}});});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  handler=dashboardHandler(db,{base,octokit:async()=>({rest:{repos:{getCollaboratorPermissionLevel:permission}}}) as any,
    clientId:"test-client",clientSecret:"test-secret",fetch:oauthFetch as unknown as typeof fetch});
});
afterEach(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();vi.unstubAllEnvs();});
function user(login="alice",kind:"operator"|"github"="github") {
  const session=createDashboardSession(db,login,kind);
  return {cookie:`gc_dashboard=${session.token}`,csrf:session.csrf};
}
async function api(path:string, who?:ReturnType<typeof user>, body?:unknown, overrides:Record<string,string>={}) {
  return fetch(base+"/dashboard/api/"+path,{method:body===undefined?"GET":"POST",headers:{...(who?{cookie:who.cookie}:{}),...(body===undefined?{}:{Origin:base,"Content-Type":"application/json","X-CSRF-Token":who?.csrf??""}),...overrides},body:body===undefined?undefined:JSON.stringify(body)});
}
const q=(path:string,repo="team/project")=>path+"?repo="+encodeURIComponent(repo);

test("dashboard assets contain no repo data before sign-in and scripts parse",async()=>{
  new Script(dashboardJs);
  const page=await fetch(base+"/dashboard");expect(page.status).toBe(200);
  expect(page.headers.get("content-security-policy")).toContain("script-src 'self'");
  expect(await page.text()).not.toContain("ALICE_ONLY");
  expect((await api(q("data"))).status).toBe(401);
  expect((await (await api("session")).json()).authenticated).toBe(false);
});
test("the actual Probot app registers dashboard routes on the existing server",async()=>{
  const port=(server.address() as {port:number}).port;
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  vi.stubEnv("DATABASE_PATH",":memory:");vi.stubEnv("PUBLIC_BASE_URL",base);
  const service=new ProbotServer({Probot:Probot.defaults({githubToken:"test-token",logLevel:"fatal"}),port,host:"127.0.0.1"});
  await service.load(application);
  try {
    await service.start();
    const response=await fetch(base+"/dashboard");expect(response.status).toBe(200);
    expect(await response.text()).toContain("/dashboard/app.js");
    const anonymous=await fetch(base+"/dashboard/api/session");expect((await anonymous.json()).authenticated).toBe(false);
  } finally {await service.stop();}
});
test("operator bootstrap is single-use, rotates secret and cannot impersonate a teammate",async()=>{
  const boot=createDashboardSession(db,"Local operator","operator",true);
  expect((await api("session",undefined,{token:boot.token},{Origin:"https://evil.example"})).status).toBe(403);
  const response=await api("session",undefined,{token:boot.token});expect(response.status).toBe(200);
  const setCookie=response.headers.get("set-cookie")!;expect(setCookie).toContain("HttpOnly");expect(setCookie).not.toContain(boot.token);
  expect((await api("session",undefined,{token:boot.token})).status).toBe(401);
  const cookie=setCookie.split(";")[0];
  const info=await (await api("session",undefined,undefined,{cookie})).json();
  const operator={cookie,csrf:info.csrf};
  expect((await api(q("response"),operator,{id:"0".repeat(16),number:1,status:"confirmed"})).status).toBe(403);
  expect((await api(q("declaration"),operator,{id:1,details:"forged"})).status).toBe(403);
  const repoList=await (await api("repos",operator)).json();expect(repoList.repos).toEqual(["team/project"]);
});
test("writes require origin and CSRF; admin weights persist and validate",async()=>{
  const admin=user();
  expect((await api(q("weights"),admin,{weights:[60,20,20]},{"X-CSRF-Token":"wrong"})).status).toBe(403);
  expect((await api(q("weights"),admin,{weights:[60,20,20]},{Origin:"https://evil.example"})).status).toBe(403);
  expect((await api(q("weights"),admin,{weights:[0,0,0]})).status).toBe(400);
  for(const weights of [[100,100,100],[60,30,20],[30,30,30],[101,-1,0],[33.333,33.333,33.334]]) {
    const response=await api(q("weights"),admin,{weights});expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("totaling exactly 100%");
  }
  expect(db.prepare("SELECT 1 FROM repository_weights").get()).toBeUndefined();
  expect((await api(q("weights"),admin,{weights:[60,20,20]})).status).toBe(200);
  const data=await (await api(q("data"),admin)).json();expect(data.weights).toEqual([60,20,20]);
  expect(data.activity.rows[0].units).toBe(1000);
  expect((await api(q("weights"),admin,{reset:true})).status).toBe(200);
  expect((await api(q("weights"),admin,{weights:[33.34,33.33,33.33]})).status).toBe(200);
  expect((await api(q("weights"),admin,{weights:[100,0,0]})).status).toBe(200);
  db.prepare("UPDATE repository_weights SET weights='1,1,1'").run();
  expect((await (await api(q("data"),admin)).json()).percentages).toEqual([33.34,33.33,33.33]);
});
test("readers cannot modify settings or entries; writers edit only their own declarations",async()=>{
  const alice=user();permission.mockResolvedValue({data:{permission:"read"}});
  expect((await api(q("weights"),alice,{weights:[40,30,30]})).status).toBe(403);
  expect((await api(q("declaration"),alice,{id:1,details:"bad"})).status).toBe(403);
  permission.mockResolvedValue({data:{permission:"write"}});
  expect((await api(q("declaration"),alice,{id:2,details:"forged"})).status).toBe(404);
  db.prepare("INSERT INTO declaration_download VALUES ('team/project','hash',?,?)").run(Buffer.from("x"),Date.now()+100000);
  expect((await api(q("declaration"),alice,{id:1,details:"Tool: Codex\nPurpose: corrected"})).status).toBe(200);
  expect(db.prepare("SELECT 1 FROM declaration_download").get()).toBeUndefined();
});
test("Word export binds GitHub users to themselves regardless of requested login",async()=>{
  const response=await api(q("word"),user(),{login:"bob",bounded:true});expect(response.status).toBe(200);
  expect(response.headers.get("content-disposition")).toContain("attachment");
  const zip=await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()));
  const xml=await zip.file("word/document.xml")!.async("string");
  expect(xml).toContain("ALICE_ONLY");expect(xml).not.toContain("BOB_ONLY");
});
test("permission revocation and expired sessions fail closed",async()=>{
  const alice=user();permission.mockResolvedValue({data:{permission:"none"}});
  expect((await api(q("data"),alice)).status).toBe(403);
  expect((await (await api("repos",alice)).json()).repos).toEqual([]);
  permission.mockResolvedValue({data:{permission:"admin"}});deleteRepository(db,"team/project");
  expect((await api(q("data"),alice)).status).toBe(404);
  db.prepare("UPDATE dashboard_session SET expires_at=0").run();
  expect((await api(q("data"),alice)).status).toBe(401);
});
test("dashboard snapshots and responses become stale after report changes",async()=>{
  const alice=user();
  const snapshot=await (await api(q("snapshot"),alice,{number:1})).json();
  expect((await api(q("response"),alice,{number:1,id:snapshot.id,status:"confirmed"})).status).toBe(200);
  await api(q("weights"),alice,{weights:[60,20,20]});
  expect((await api(q("response"),alice,{number:1,id:snapshot.id,status:"confirmed"})).status).toBe(409);
  expect((await (await api(q("data"),alice)).json()).snapshots[0].stale).toBe(true);
});
test("GitHub sign-in checks browser-bound state and exchanges the code without returning tokens",async()=>{
  const start=await fetch(base+"/dashboard/auth/github",{redirect:"manual"});
  const state=new URL(start.headers.get("location")!).searchParams.get("state")!;
  const cookie=start.headers.get("set-cookie")!.split(";")[0];
  oauthFetch.mockResolvedValueOnce(new Response(JSON.stringify({access_token:"private-user-token"}),{status:200}))
    .mockResolvedValueOnce(new Response(JSON.stringify({login:"alice"}),{status:200}));
  const response=await fetch(base+"/dashboard/auth/callback?code=test&state="+state,{headers:{cookie},redirect:"manual"});
  expect(response.status).toBe(302);expect(response.headers.get("location")).toBe("/dashboard");
  expect(response.headers.get("set-cookie")).not.toContain("private-user-token");
  expect((await fetch(base+"/dashboard/auth/callback?code=test&state="+state,{headers:{cookie},redirect:"manual"})).status).toBe(403);
  expect(oauthFetch).toHaveBeenCalledTimes(2);
});
