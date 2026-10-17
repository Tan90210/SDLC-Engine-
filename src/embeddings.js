import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIMENSIONS = 384;
let pipelinePromise;
// No query text leaves this process. Initial model download is an explicit setup step.
export async function createEmbedder({allowDownload=false}={}) {
  if(!pipelinePromise) pipelinePromise=(async()=>{
    const {pipeline,env}=await import('@huggingface/transformers');
    env.cacheDir=join(fileURLToPath(new URL('../',import.meta.url)),'data','models');
    env.allowRemoteModels=allowDownload;
    return pipeline('feature-extraction',EMBEDDING_MODEL,{dtype:'q8',device:'cpu',session_options:{intraOpNumThreads:2,interOpNumThreads:1}});
  })().catch(error=>{pipelinePromise=null;throw error;});
  const extractor=await pipelinePromise;
  return async texts=>{
    const result=await extractor(texts,{pooling:'mean',normalize:true,truncation:true,max_length:256});
    return result.tolist();
  };
}
