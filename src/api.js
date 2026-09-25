export async function api(path,options={}){
 const response=await fetch(`/api${path}`,{...options,headers:options.body instanceof FormData?options.headers:{'Content-Type':'application/json',...options.headers}});
 const contentType=response.headers.get('content-type')||'';const result=contentType.includes('json')?await response.json():await response.text();
 if(!response.ok){const e=new Error(result?.error?.message||`Request failed (${response.status}).`);e.code=result?.error?.code;e.details=result?.error?.details;e.status=response.status;throw e}return result;
}
export const post=(path,body={})=>api(path,{method:'POST',body:JSON.stringify(body)});
