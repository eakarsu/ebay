export function createNativeAITransport({fetchImpl=globalThis.fetch,timeoutMs=60000,limit=20,windowMs=3600000,now=Date.now}={}) {
  const owners=new Map();
  return async function nativeAITransport(req,res,owner,url,options) {
    const time=now();
    for(const [id,row] of owners)if(row.expires<=time)owners.delete(id);
    const row=owners.get(owner)||{count:0,expires:time+windowMs};
    if(row.count>=limit){const error=new Error('Hourly AI request limit reached. Try again later.');error.status=429;error.retryAfter=Math.max(1,Math.ceil((row.expires-time)/1000));throw error;}
    if(!owners.has(owner)&&owners.size>=10000){const error=new Error('AI request capacity is temporarily unavailable.');error.status=503;throw error;}
    row.count++;owners.set(owner,row);
    const controller=new AbortController();let timedOut=false;
    const abort=()=>{if(!res.writableEnded)controller.abort();};
    req.once('aborted',abort);res.once('close',abort);
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);timer.unref?.();
    try {
      const response=await fetchImpl(url,{...options,signal:controller.signal});
      if(controller.signal.aborted)throw Object.assign(new Error('Request canceled'),{name:'AbortError'});
      if(!response.ok){const error=new Error('OpenRouter rejected the request ('+response.status+').');error.status=response.status===429?429:502;throw error;}
      const data=await response.json();
      if(controller.signal.aborted||res.destroyed)throw Object.assign(new Error('Request canceled'),{name:'AbortError'});
      const content=String(data.choices?.[0]?.message?.content||'').trim();
      if(!content)throw Object.assign(new Error('OpenRouter returned an empty response.'),{status:502});
      const requestId=String(data.id||'').trim();if(!requestId)throw Object.assign(new Error('OpenRouter provider receipt is missing.'),{status:502});return {content,model:data.model,providerReceipt:{requestId,provider:'openrouter',upstreamModel:String(data.model||''),created:Number(data.created||0)}};
    } catch(error) {
      if(controller.signal.aborted){const failure=new Error(timedOut?'OpenRouter request timed out.':'Request canceled.');failure.status=timedOut?504:499;throw failure;}
      if(error.status)throw error;
      throw Object.assign(new Error('OpenRouter could not be reached.'),{status:502});
    } finally {clearTimeout(timer);req.removeListener('aborted',abort);res.removeListener('close',abort);}
  };
}
