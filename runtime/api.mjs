import {createNativeAITransport} from './nativeAITransport.mjs';
import {serveNativePromptConsole} from './serveNativePromptConsole.mjs';
import http from 'node:http';
import crypto from 'node:crypto';
import { literal, query } from './db.mjs';

const port=Number(process.env.BACKEND_PORT);
const frontendOrigin=`http://127.0.0.1:${process.env.FRONTEND_PORT}`;
const selectedEndpoint=String(process.env.RUNTIME_AI_ENDPOINT||'');
const feature=String(process.env.RUNTIME_AI_FEATURE||'application-assistant');
const project=String(process.env.RUNTIME_PROJECT_NAME||'Application');
const systemPrompt=String(process.env.RUNTIME_AI_SYSTEM_PROMPT||'Provide a concise, practical, evidence-aware answer for this application workflow.');
const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Access-Control-Allow-Origin':frontendOrigin,'Access-Control-Allow-Headers':'Authorization, Content-Type'});res.end(JSON.stringify(body));};
const readBody=req=>new Promise((resolve,reject)=>{let text='';req.on('data',chunk=>{text+=chunk;if(text.length>1_000_000)reject(new Error('request too large'));});req.on('end',()=>{try{resolve(text?JSON.parse(text):{});}catch(error){reject(error);}});req.on('error',reject);});
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function verify(password,stored){const [kind,salt,digest]=String(stored).split('$');if(kind!=='scrypt'||!salt||!digest)return false;const candidate=crypto.scryptSync(password,salt,32);const expected=Buffer.from(digest,'hex');return candidate.length===expected.length&&crypto.timingSafeEqual(candidate,expected);}
function actor(req){const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!token)return null;const row=query(`SELECT u.id,u.email,u.display_name,u.role FROM runtime_app_sessions s JOIN runtime_app_users u ON u.id=s.user_id WHERE s.token_hash=${literal(sha(token))} AND s.expires_at>NOW() AND u.active=TRUE LIMIT 1`,{rows:true});if(!row)return null;const [id,email,displayName,role]=row.split('\t');return{id,email,displayName,role};}
const nativeAITransport=createNativeAITransport();
const server=http.createServer(async(req,res)=>{
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':frontendOrigin,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS'});return res.end();}
  const url=new URL(req.url||'/',`http://127.0.0.1:${port}`);
  try{
    if(req.method==='GET'&&url.pathname==='/ai-workspace')return serveNativePromptConsole(res);
    if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{status:'ok',project});
    if(req.method==='GET'&&url.pathname==='/api/auth/demo-credentials'){
      if(process.env.NODE_ENV==='production')return json(res,404,{error:'Not found'});
      const email=process.env.DEMO_EMAIL||process.env.PROVISION_ADMIN_EMAIL||process.env.ADMIN_EMAIL;const password=process.env.DEMO_PASSWORD||process.env.PROVISION_ADMIN_PASSWORD||process.env.ADMIN_PASSWORD;
      return email&&password?json(res,200,{email,password}):json(res,503,{error:'Demo credentials are not configured'});
    }
    if(req.method==='POST'&&url.pathname==='/api/auth/login'){
      const body=await readBody(req);const email=String(body.email||'').trim().toLowerCase();const password=String(body.password||'');
      const row=query(`SELECT id,email,password_hash,display_name,role FROM runtime_app_users WHERE email=${literal(email)} AND active=TRUE LIMIT 1`,{rows:true});
      if(!row)return json(res,401,{error:'Invalid credentials'});
      const [id,userEmail,passwordHash,displayName,role]=row.split('\t');if(!verify(password,passwordHash))return json(res,401,{error:'Invalid credentials'});
      const token=crypto.randomBytes(32).toString('hex');query(`INSERT INTO runtime_app_sessions(token_hash,user_id,expires_at) VALUES(${literal(sha(token))},${literal(id)}::uuid,NOW()+INTERVAL '24 hours')`);
      return json(res,200,{token,user:{id,email:userEmail,name:displayName,role}});
    }
    if(req.method==='GET'&&url.pathname==='/api/auth/me'){const user=actor(req);return user?json(res,200,{user}):json(res,401,{error:'Authentication required'});}
    if(req.method==='GET'&&url.pathname==='/api/ai/history'){
      const user=actor(req);if(!user)return json(res,401,{error:'Authentication required'});
      const rows=query(`SELECT json_build_object('id',id,'feature',feature,'input',input,'output',output,'model',model,'providerReceipt',provider_receipt,'createdAt',created_at)::text FROM runtime_ai_interactions WHERE user_id=${literal(user.id)}::uuid ORDER BY created_at DESC LIMIT 50`,{rows:true});
      return json(res,200,{history:rows?rows.split('\n').map(JSON.parse):[]});
    }
    const reportRoute=url.pathname.match(/^\/api\/ai\/history\/(\d+)$/);
    if(reportRoute&&['PUT','DELETE'].includes(req.method)){
      const user=actor(req);if(!user)return json(res,401,{error:'Authentication required'});
      const id=Number(reportRoute[1]);if(!Number.isSafeInteger(id)||id<1)return json(res,400,{error:'Invalid report reference'});
      let sql;
      if(req.method==='PUT'){const body=await readBody(req);const title=typeof body.title==='string'?body.title.trim():'';if(!title||title.length>160)return json(res,422,{error:'Report title must contain 1-160 characters'});sql=`UPDATE runtime_ai_interactions SET output=jsonb_set(output,'{user_title}',${literal(JSON.stringify(title))}::jsonb,TRUE) WHERE id=${id} AND user_id=${literal(user.id)}::uuid RETURNING id`;}
      else sql=`DELETE FROM runtime_ai_interactions WHERE id=${id} AND user_id=${literal(user.id)}::uuid RETURNING id`;
      const changed=query(sql,{rows:true});return changed?json(res,200,{id,deleted:req.method==='DELETE'}):json(res,404,{error:'Saved report not found'});
    }
    if(req.method==='POST'&&url.pathname===selectedEndpoint){
      const user=actor(req);if(!user)return json(res,401,{error:'Authentication required'});
      const body=await readBody(req);const prompt=String(body.prompt||body.question||body.message||body.context||'').trim();if(!prompt||prompt.length>20000)return json(res,400,{error:'prompt must contain 1-20000 characters'});
      const base=String(process.env.OPENROUTER_BASE_URL||'').replace(/\/+$/,'');const model=String(process.env.OPENROUTER_MODEL||'').trim();const key=String(process.env.OPENROUTER_API_KEY||'').trim();
      if(base!=='https://openrouter.ai/api/v1'||!model||!key)throw Object.assign(new Error('Exact OpenRouter configuration is required'),{status:503});
      const provider=await nativeAITransport(req,res,user.id,`${base}/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','X-Title':project},body:JSON.stringify({model,messages:[{role:'system',content:systemPrompt},{role:'user',content:prompt}],max_tokens:650})});
      const content=provider.content;const providerReceipt=provider.providerReceipt;
      if(res.destroyed)return;
      if(actor(req)?.id!==user.id)return json(res,401,{error:'Authentication required'});
      const saved=query(`INSERT INTO runtime_ai_interactions(user_id,feature,input,output,model,provider_receipt) VALUES(${literal(user.id)}::uuid,${literal(feature)},${literal(JSON.stringify(body))}::jsonb,${literal(JSON.stringify({content}))}::jsonb,${literal(model)},${literal(JSON.stringify(providerReceipt))}::jsonb) RETURNING id`,{rows:true});
      return json(res,200,{content,model,providerReceipt,interactionId:Number(saved),feature});
    }
    return json(res,404,{error:'Not found'});
  }catch(error){if(res.destroyed||error.status===499)return;if(error.retryAfter)res.setHeader('Retry-After',String(error.retryAfter));return json(res,error.status||500,{error:error.status?error.message:'Internal service error'});}
});
server.listen(port,'127.0.0.1',()=>console.log(`${project} runtime API listening on ${port}`));
