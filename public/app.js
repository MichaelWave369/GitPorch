const $ = (id) => document.getElementById(id);
const samples = [
 {name:'porch-demo',branches:['main'],latest:{hash:'b39f4a8',subject:'feat: plant the first porch posts',date:'2026-10-19T12:00:00Z'}},
 {name:'lantern-ledger',branches:['main','dev'],latest:{hash:'a7d9e31',subject:'docs: file the lantern ledger',date:'2026-10-19T12:00:00Z'}},
 {name:'barnyard-lab',branches:['main'],latest:{hash:'f90c2de',subject:'test: inspect the floorboards',date:'2026-10-19T12:00:00Z'}}
];
let showcase = false;
function node(tag, klass='', value) {
 const e = document.createElement(tag);if(klass)e.className=klass;if(value!==undefined)e.textContent=String(value);return e;
}
function date(value) {
 if(!value)return 'No commits yet';const d=new Date(value);
 return Number.isNaN(d.getTime())?'Unknown date':d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
}
async function inspect(repo, button) {
 document.querySelectorAll('.repo').forEach(b=>b.classList.remove('active'));button.classList.add('active');
 const history=$('history');history.replaceChildren(node('strong','',repo.name));
 let commits=[];
 if(showcase){if(repo.latest)commits=[{...repo.latest,author:'Fictional example'}];}
 else try {
   const result=await fetch('/api/repos/'+encodeURIComponent(repo.name)+'/commits',{cache:'no-store'});
   if(!result.ok)throw new Error();commits=(await result.json()).commits || [];
 }catch {history.append(node('p','','Unable to read local Git history.'));return}
 if(!commits.length){history.append(node('p','','No commits yet. Push a commit and check again.'));return}
 for(const c of commits.slice(0,8)) {
   const item=node('div','commit');item.append(node('b','',c.subject||'(no message)'),node('small','',c.hash+' · '+date(c.date)+(c.author?' · '+c.author:'')));history.append(item);
 }
}
function render(repos) {
 $('repo-count').textContent=repos.length;
 $('branch-count').textContent=repos.reduce((n,r)=>n+r.branches.length,0);
 const list=$('repos');list.replaceChildren();
 if(!repos.length){list.append(node('div','empty','No repositories yet. Create one with: node src/cli.mjs init hello-world'));return;}
 for(const repo of repos) {
   const b=node('button','repo');b.type='button';b.setAttribute('aria-label','Inspect '+repo.name);
   const info=node('div','repo-info');
   info.append(node('strong','',repo.name),node('p','',repo.latest?.subject||'Waiting for the first commit'),node('small','',repo.branches.length+' branches · '+date(repo.latest?.date)));
   b.append(node('span','repo-icon','⑂'),info,node('span','repo-tag',showcase?'DEMO':'LOCAL'));
   b.addEventListener('click',()=>inspect(repo,b));list.append(b);
 }
 list.firstElementChild?.click();
}
async function load() {
 try {
   const [s,r]=await Promise.all([fetch('/api/status',{cache:'no-store'}),fetch('/api/repos',{cache:'no-store'})]);
   if(!s.ok||!r.ok)throw new Error();
   const status=await s.json(), payload=await r.json();
   if(status.service!=='The GitPorch'||!Array.isArray(payload.repositories))throw new Error();
   $('status').textContent='●  LOCAL / CONNECTED';
   $('transport').textContent=status.gitTransport==='starting_or_available'?'LOCAL ONLY':'CHECK STATUS';
   $('notice').textContent='LOCAL SERVICE CONNECTED · Real repositories from your machine. Network clones are read-only. Push over a local filesystem remote.';
   render(payload.repositories);
 }catch {
   showcase=true;$('status').textContent='●  SHOWCASE / OFFLINE';$('transport').textContent='DEMO';
   $('notice').classList.add('demo');$('notice').textContent='SHOWCASE MODE · Fictional sample repositories only. Run npm start locally to view actual Git data.';
   render(samples);
 }
}
for(const b of document.querySelectorAll('button[data-copy]'))b.addEventListener('click',async()=>{
 try{await navigator.clipboard.writeText(b.dataset.copy);b.textContent='Copied!'}catch{b.textContent='Select the code above'}
});
load();

async function refreshClubhouse(){
 const members=document.getElementById('club-members');
 const proposals=document.getElementById('club-proposals');
 if(!members||!proposals)return;
 const safe=(name,klass,text)=>{const e=document.createElement(name);if(klass)e.className=klass;e.textContent=String(text);return e};
 try{
  const response=await fetch('/api/clubhouse',{cache:'no-store'});
  if(!response.ok)throw Error('Crew data unavailable');
  const crew=await response.json();
  members.replaceChildren();proposals.replaceChildren();
  if(!crew.members.length)members.append(safe('p','club-empty','No members registered. The rocking chairs are waiting.'));
  else for(const m of crew.members){
   const card=safe('div','club-row','');
   card.append(safe('strong','',m.displayName),safe('small','',m.id+' · '+m.role.toUpperCase()));
   members.append(card);
  }
  if(!crew.proposals.length)proposals.append(safe('p','club-empty','No proposals yet. Nobody has claimed a green build.'));
  else for(const p of crew.proposals.slice(-12).reverse()){
   const card=safe('div','club-row','');
   card.append(safe('strong','',p.summary),safe('small','',p.memberId+' → '+p.repoName+' @ '+p.commit.slice(0,9)),safe('small','',p.decision+' · NOT A CI RESULT'));
   proposals.append(card);
  }
 }catch(e){
  members.replaceChildren(safe('p','club-empty','Local crew records could not be verified.'));
  proposals.replaceChildren(safe('p','club-empty','Records are withheld when their integrity cannot be checked.'));
 }
}
refreshClubhouse();

async function refreshWorkshop(){
 const counts=document.getElementById('workshop-counts');
 const jobs=document.getElementById('workshop-jobs');
 if(!counts||!jobs)return;
 const mk=(tag,text,cls='')=>{const element=document.createElement(tag);element.textContent=String(text);if(cls)element.className=cls;return element};
 try{
  const response=await fetch('/api/porch-crew',{cache:'no-store'});
  if(!response.ok)throw Error('Queue endpoint unavailable');
  const snapshot=await response.json();
  counts.replaceChildren(mk('p','Queued: '+snapshot.counts.queued+' · Uncertain: '+snapshot.counts.runningUncertain+' · Finished: '+snapshot.counts.done));
  jobs.replaceChildren();
  const latest=snapshot.jobs.slice(0,10);
  if(!latest.length){jobs.append(mk('p','No integrity checks queued yet.','club-empty'));return;}
  for(const job of latest){
   const row=mk('div','','club-row');
   const label=job.status==='DONE'?(job.outcome==='ABORTED_UNVERIFIED'?'ABORTED · UNVERIFIED · NO CHECK':'Git fsck '+job.outcome+' · NOT CI'):
     job.status==='RUNNING_UNCERTAIN'?'INTERRUPTED OR RUNNING · UNVERIFIED':'QUEUED · UNVERIFIED';
   row.append(mk('strong',job.repo+' · '+label),mk('small',job.commit.slice(0,12)+' · '+job.check));
   jobs.append(row);
  }
 }catch{
  counts.replaceChildren(mk('p','Queue unavailable or receipts could not be verified.','club-empty'));
  jobs.replaceChildren(mk('p','No verified queue results can be shown.','club-empty'));
 }
}
refreshWorkshop();

async function refreshSandbox(){
 const counts=document.getElementById('sandbox-counts');
 const items=document.getElementById('sandbox-jobs');
 if(!counts||!items)return;
 const make=(tag,t,cl='')=>{const e=document.createElement(tag);e.textContent=String(t);if(cl)e.className=cl;return e;};
 try{
  const response=await fetch('/api/sandbox-tests',{cache:'no-store'});
  if(!response.ok)throw Error('Local test results not available');
  const snap=await response.json();
  if(snap.assurance!=='DOCKER_EXIT_AND_TAP_NOT_SIGNED_ATTESTATION')throw Error('Unexpected receipt contract');
  counts.replaceChildren(make('p','Queued '+snap.counts.queued+' · Uncertain '+snap.counts.runningUncertain+' · Completed '+snap.counts.done));
  items.replaceChildren();
  if(!snap.jobs.length){items.append(make('p','No container jobs yet. The tool shed is quiet.','club-empty'));return;}
  for(const job of snap.jobs.slice(0,10)){
   const row=make('div','','club-row');
   const state=job.status==='DONE'?(job.outcome==='ABORTED_UNVERIFIED'?'ABORTED · UNVERIFIED · NO TEST':'CONTAINER '+job.outcome):job.status==='RUNNING_UNCERTAIN'?'INTERRUPTED / UNVERIFIED':'QUEUED / NOT RUN';
   const results=job.counts?(' · '+job.counts.pass+'/'+job.counts.tests+' tests passed'):'';
   row.append(make('strong',job.repo+' · '+state),make('small',job.commit.slice(0,12)+results+' · '+job.kind));
   if(job.evidence?.stdoutSha256)row.append(make('small','Local stdout SHA-256: '+job.evidence.stdoutSha256.slice(0,16)+'… · UNSIGNED'));
   items.append(row);
  }
 }catch{
  counts.replaceChildren(make('p','No verified local test summary available.','club-empty'));
  items.replaceChildren(make('p','Receipt state unavailable or failed validation.','club-empty'));
 }
}
refreshSandbox();

async function refreshRecoveryDoctor(){
 const renderLane=(target,state)=>{
  const box=document.getElementById(target);
  if(!box)return;
  const p=document.createElement('p');
  p.className='club-empty';
  p.textContent=state
   ? 'Receipt integrity: '+state.integrity+' · '+state.workerLock
      +' · Queued: '+(state.queued??'unknown')
      +' · Uncertain: '+(state.runningUncertain??'unknown')
      +' · Done: '+(state.completed??'unknown')
   : 'Recovery diagnostics could not be verified.';
  box.replaceChildren(p);
 };
 try{
  const response=await fetch('/api/recovery',{cache:'no-store'});
  if(!response.ok)throw Error('Recovery diagnostic unavailable');
  const data=await response.json();
  if(data.mode!=='READ_ONLY_RECOVERY_DIAGNOSTIC')throw Error('Unexpected recovery contract');
  renderLane('recovery-git',data.lanes.git);
  renderLane('recovery-tests',data.lanes.tests);
 }catch{
  renderLane('recovery-git',null);renderLane('recovery-tests',null);
 }
}
refreshRecoveryDoctor();


async function refreshPhiRunners(){
 const pulse=$('phirunners-pulse'),lanes=$('phirunners-lanes'),jobs=$('phirunners-jobs');
 if(!pulse||!lanes||!jobs)return;
 const make=(tag,value,cls='')=>{const e=document.createElement(tag);e.textContent=String(value);if(cls)e.className=cls;return e;};
 try{
  const response=await fetch('/api/phirunners',{cache:'no-store'});
  if(!response.ok)throw Error('Local API unavailable');
  const state=await response.json();
  if(state.service!=='PhiRunners'||state.mode!=='LOCAL_READ_ONLY')throw Error('Unexpected PhiRunners API');
  const all=state.totals;
  pulse.replaceChildren(make('p',all
    ?'Queued '+all.queued+' · Uncertain '+all.runningUncertain+' · Done '+all.done+' · PASS '+all.passed+' · FAIL '+all.failed+' · Other '+all.other
    :'PARTIAL / UNVERIFIED · Combined totals intentionally withheld'));
  lanes.replaceChildren();
  for(const [name,lane] of Object.entries(state.lanes)){
   const block=make('div','','club-row');
   const title=name==='git'?'Git integrity':'Docker Node tests';
   const detail=lane.counts
      ?'Queued '+lane.counts.queued+' · Uncertain '+lane.counts.runningUncertain+' · Done '+lane.counts.done
      :'COUNTS WITHHELD · '+(lane.reason||'UNVERIFIED');
   block.append(make('strong',title+' · '+lane.health),
     make('small',detail),
     make('small','Worker lock: '+lane.workerLock+' · Not proof of a live process'));
   lanes.append(block);
  }
  jobs.replaceChildren();
  if(!state.jobs.length){jobs.append(make('p','No reportable job receipts.','club-empty'));return;}
  for(const job of state.jobs){
   const row=make('div','','club-row');
   const outcome=job.status==='DONE'?(job.outcome||'UNVERIFIED'):job.status;
   row.append(make('strong',job.repo+' · '+job.lane.toUpperCase()+' · '+outcome),
      make('small',job.commit.slice(0,12)+' · '+job.id+' · LOCAL ONLY'));
   jobs.append(row);
  }
 }catch{
  pulse.replaceChildren(make('p','LOCAL ΦRUNNERS API UNAVAILABLE · No worker claims','club-empty'));
  lanes.replaceChildren(make('p','Run GitPorch locally to read actual queue receipts.','club-empty'));
  jobs.replaceChildren(make('p','No fabricated jobs shown.','club-empty'));
 }
}
refreshPhiRunners();


async function refreshArtifactForge(){
 const pulse=$('artifact-pulse'),rows=$('artifact-rows');
 if(!pulse||!rows)return;
 const el=(tag,s,cl='')=>{const n=document.createElement(tag);n.textContent=String(s);if(cl)n.className=cl;return n;};
 try{
  const response=await fetch('/api/artifacts',{cache:'no-store'});
  if(!response.ok)throw Error('Artifact inventory not verified');
  const state=await response.json();
  if(state.mode!=='LOCAL_READ_ONLY'||state.assurance!=='LOCAL_SHA256_AND_RECEIPT_CHECKSUM_NOT_SIGNED')
     throw Error('Unexpected artifact response');
  pulse.replaceChildren(el('p',state.count+' private source archive(s) · SHA-256 checked · NOT compiled builds'));
  rows.replaceChildren();
  if(!state.artifacts.length){rows.append(el('p','No local bundles yet. Operator CLI approval required.','club-empty'));return;}
  for(const item of state.artifacts.slice(0,12)){
   const row=el('div','','club-row');
   row.append(el('strong',item.repo+' @ '+item.commit.slice(0,12)+' · SOURCE ARCHIVE'),
      el('small',item.bytes+' bytes · SHA-256 '+item.sha256),
      el('small','Docker test job '+item.testJobId+' · '+item.status));
   rows.append(row);
  }
 }catch{
  pulse.replaceChildren(el('p','UNVERIFIED OR UNAVAILABLE · No artifact success reported','club-empty'));
  rows.replaceChildren(el('p','Inspect local data and receipts; malformed/partial bundles are withheld.','club-empty'));
 }
}
refreshArtifactForge();


async function refreshIsolatedBuilds(){
 const pulse=$('build-pulse'),rows=$('build-rows');
 if(!pulse||!rows)return;
 const elem=(tag,content,cls='')=>{const x=document.createElement(tag);x.textContent=String(content);if(cls)x.className=cls;return x};
 try{
  const response=await fetch('/api/builds',{cache:'no-store'});
  if(!response.ok)throw Error('Local build receipts unavailable');
  const value=await response.json();
  if(value.mode!=='LOCAL_READ_ONLY'||value.assurance!=='SHA256_AND_LOCAL_RECEIPT_NOT_ATTESTED')
    throw Error('Unexpected build endpoint response');
  pulse.replaceChildren(elem('p',value.count+' hash-checked local static HTML build(s) · NOT ATTESTED'));
  rows.replaceChildren();
  if(!value.builds.length){rows.append(elem('p','No verified builds yet. Requires approved local Docker execution.','club-empty'));return;}
  for(const build of value.builds.slice(0,12)){
   const row=elem('div','','club-row');
   row.append(elem('strong',build.repo+' · '+build.recipe+' · '+build.status),
     elem('small','Commit '+build.commit.slice(0,12)+' · Source '+build.sourceArtifactId),
     elem('small',build.bytes+' bytes · SHA-256 '+build.sha256));
   rows.append(row);
  }
 }catch{
  pulse.replaceChildren(elem('p','UNVERIFIED / UNAVAILABLE · No green build claims','club-empty'));
  rows.replaceChildren(elem('p','Inspect local storage for partial or tampered output.','club-empty'));
 }
}
refreshIsolatedBuilds();
