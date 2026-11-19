// Import is a planning source, never a direct write or a trusted baseline.
import { createHmac } from 'node:crypto'
import { hash, canonical, safeEqual, SCHEMA_VERSION, MAX_PAYLOAD_BYTES, withinPayloadLimit, validateStatePayload } from './protocol.js'

export function exportSnapshot(state,{now=()=>new Date().toISOString(),secret=null}={}) {
  const body={
    schemaVersion:SCHEMA_VERSION,kind:'plugin-sync-snapshot',createdAt:now(),
    identity:state.identity?{deviceId:state.identity.deviceId,profileId:state.identity.profileId}:{deviceId:'offline-export',profileId:'offline-export'},
    revision:structuredClone(state.revision),
    expected:structuredClone(state.expected??[]),expectedConfig:structuredClone(state.expectedConfig??[]),expectedMemory:structuredClone(state.expectedMemory??[]),
  }
  const errors=validateStatePayload(body)
  if(errors.length)throw new Error('invalid-snapshot-resources')
  const manifest=secret
    ?{algorithm:'hmac-sha256',digest:createHmac('sha256',secret).update(canonical(body)).digest('hex')}
    :{algorithm:'sha256',digest:hash(body),untrusted:true}
  const snapshot={...body,manifest}
  if(!withinPayloadLimit(snapshot))throw new Error('snapshot-too-large')
  return snapshot
}

export function verifySnapshot(snapshot,secret=null) {
  if(!snapshot||snapshot.kind!=='plugin-sync-snapshot')return {ok:false,reason:'not-a-snapshot'}
  if(snapshot.schemaVersion!==SCHEMA_VERSION)return {ok:false,reason:'unsupported-schema'}
  if(!withinPayloadLimit(snapshot))return {ok:false,reason:'payload-too-large'}
  const {manifest,...body}=snapshot
  if(!manifest||!['sha256','hmac-sha256'].includes(manifest.algorithm))return {ok:false,reason:'bad-manifest'}
  let digest,trust='untrusted'
  if(manifest.algorithm==='hmac-sha256'){
    if(!secret)return {ok:false,reason:'unknown-signing-key'}
    digest=createHmac('sha256',secret).update(canonical(body)).digest('hex');trust='authenticated'
  }else{digest=hash(body)}
  if(!safeEqual(digest,manifest.digest))return {ok:false,reason:'digest-mismatch'}
  if(typeof snapshot.createdAt!=='string'||!Number.isFinite(Date.parse(snapshot.createdAt)))return {ok:false,reason:'bad-created-at'}
  const errors=validateStatePayload(body)
  if(errors.length)return {ok:false,reason:'invalid-snapshot-resources',errors}
  return {ok:true,snapshot,trust}
}

export function parseSnapshot(text,secret=null) {
  if(typeof text!=='string')return {ok:false,reason:'invalid-snapshot-text'}
  if(Buffer.byteLength(text,'utf8')>MAX_PAYLOAD_BYTES)return {ok:false,reason:'payload-too-large'}
  let snapshot
  try{snapshot=JSON.parse(text)}catch{return {ok:false,reason:'invalid-json'}}
  return verifySnapshot(snapshot,secret)
}
