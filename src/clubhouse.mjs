// GitPorch Clubhouse R0.3: local-only proposal receipts. No service actions.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { git, listRepos, repoRoot, validSlug } from './git.mjs';

const SHA = /^[0-9a-f]{40}$/i;
const ROLES = new Set(['builder', 'tester', 'reviewer', 'researcher']);
const KINDS = ['members', 'proposals', 'decisions'];
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function line(value, max, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\r\n\x00-\x1f]/.test(value)) throw new Error('Invalid ' + name);
  return value.trim();
}
function memberId(value) {
  if (!validSlug(value) || value.startsWith('.')) throw new Error('Invalid member ID');
  return value;
}
function proposalId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) throw new Error('Invalid proposal ID');
  return value;
}
function dir(dataDir,kind) { return join(dataDir,'crew',kind); }
async function writeReceipt(dataDir,kind,name,payload) {
  if(!KINDS.includes(kind)) throw new Error('Unknown receipt kind');
  const path=dir(dataDir,kind);
  await mkdir(path,{recursive:true,mode:0o700});
  const body={schema:'gitporch-clubhouse/0.1',kind,createdAt:new Date().toISOString(),payload};
  const record={...body,checksum:digest(body)};
  const handle=await open(join(path,name+'.json'),'wx',0o600);
  try {await handle.writeFile(JSON.stringify(record,null,2)+'\n');await handle.sync();}finally{await handle.close();}
  return record;
}
async function readReceipt(path,kind) {
  const stats=await stat(path);
  if (!stats.isFile() || stats.size>8192) throw new Error('Invalid receipt file');
  const record=JSON.parse(await readFile(path,'utf8'));
  if(record.kind!==kind || record.schema!=='gitporch-clubhouse/0.1' || typeof record.createdAt!=='string' || typeof record.checksum!=='string') throw new Error('Invalid receipt format');
  const {checksum,...body}=record;
  if(checksum!==digest(body)) throw new Error('Receipt checksum mismatch');
  return record;
}
async function getReceipts(dataDir,kind) {
  const folder=dir(dataDir,kind);
  let names;
  try{names=await readdir(folder,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return [];throw e;}
  if(names.length>1000)throw new Error('Too many receipt files');
  const files=names.filter(e=>e.isFile() && e.name.endsWith('.json')).sort((a,b)=>a.name.localeCompare(b.name));
  if(files.length!==names.length)throw new Error('Unexpected receipt directory entry');
  return Promise.all(files.map(f=>readReceipt(join(folder,f.name),kind)));
}
export async function summary(dataDir){
  const [members,proposals,decisions]=await Promise.all(KINDS.map(k=>getReceipts(dataDir,k)));
  const memberIds=new Set(),proposalsById=new Map(),decisionIds=new Set();
  for(const r of members){
    const p=r.payload;
    memberId(p.id);line(p.displayName,80,'display name');
    if(!ROLES.has(p.role)||memberIds.has(p.id))throw new Error('Invalid or duplicate member');
    memberIds.add(p.id);
  }
  for(const r of proposals){
    const p=r.payload;
    proposalId(p.id);memberId(p.memberId);
    if(!validSlug(p.repoName)||!SHA.test(p.commit)||!memberIds.has(p.memberId)||proposalsById.has(p.id))throw new Error('Invalid proposal');
    line(p.summary,240,'summary');
    proposalsById.set(p.id,r);
  }
  for(const r of decisions){
    const p=r.payload;
    proposalId(p.proposalId);line(p.note,240,'review note');
    if(!proposalsById.has(p.proposalId)||!['ACCEPTED','DECLINED'].includes(p.decision)||decisionIds.has(p.proposalId))throw new Error('Invalid or duplicate decision');
    decisionIds.add(p.proposalId);
  }
  return {mode:'LOCAL_OPERATOR_ONLY',assurance:'CHECKSUM_ONLY_NOT_SIGNED',
    members:members.map(r=>({ ...r.payload,createdAt:r.createdAt })),
    proposals:proposals.map(r=>({ ...r.payload,createdAt:r.createdAt,decision:decisions.find(d=>d.payload.proposalId===r.payload.id)?.payload.decision??'PENDING_OPERATOR_REVIEW'})),
    decisions:decisions.map(r=>({ ...r.payload,createdAt:r.createdAt }))};
}
export async function register(dataDir,id,role,displayName){
  id=memberId(id);displayName=line(displayName,80,'display name');
  if(!ROLES.has(role))throw new Error('Invalid role');
  await summary(dataDir);
  return writeReceipt(dataDir,'members',id,{id,role,displayName});
}
export async function propose(dataDir,memberIdValue,repoName,commit,description){
  memberIdValue=memberId(memberIdValue);
  if(!validSlug(repoName)||!SHA.test(commit))throw new Error('Invalid repository or commit SHA');
  description=line(description,240,'summary');
  const snapshot=await summary(dataDir);
  if(!snapshot.members.some(m=>m.id===memberIdValue))throw new Error('Register this member first');
  const repo=(await listRepos(dataDir)).find(r=>r.name===repoName);
  if(!repo)throw new Error('Local repository not found');
  const objectType=await git(['--git-dir',join(repoRoot(dataDir),repoName+'.git'),'cat-file','-t',commit]);
  if(objectType!=='commit')throw new Error('Reference is not a Git commit');
  const id=randomUUID();
  return writeReceipt(dataDir,'proposals',id,{id,memberId:memberIdValue,repoName,commit:commit.toLowerCase(),summary:description,commitObjectObserved:true});
}
export async function recordDecision(dataDir,id,decision,note,confirmation){
  id=proposalId(id);note=line(note,240,'review note');
  if(!confirmation)throw new Error('Local operator confirmation required');
  if(!['ACCEPTED','DECLINED'].includes(decision))throw new Error('Invalid review decision');
  const state=await summary(dataDir);
  const candidate=state.proposals.find(p=>p.id===id);
  if(!candidate)throw new Error('Proposal not found');
  if(candidate.decision!=='PENDING_OPERATOR_REVIEW')throw new Error('Already reviewed');
  // Not authenticated identity; OS access is the only local trust boundary.
  return writeReceipt(dataDir,'decisions',id,{proposalId:id,decision,note,scope:'LOCAL_OPERATOR_NOTE_ONLY_NO_MERGE'});
}
